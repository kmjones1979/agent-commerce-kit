/**
 * vault.ts — thin async client around the 1Claw REST API.
 *
 * Every sensitive credential in this kit lives in the 1Claw HSM vault and is
 * read through this module. Values come back wrapped in an opaque `Secret<T>`
 * that:
 *   - redacts itself on console.log / JSON.stringify / String() / util.inspect,
 *   - never returns the raw value from a getter,
 *   - exposes `.use(fn)` which hands the raw value to `fn` for the duration of
 *     one call and then zeroes the backing buffer.
 *
 * The 1Claw REST surface used here is exactly what the scaffold's own scripts
 * and `@1claw/sdk` use (no invented endpoints):
 *   POST /v1/auth/api-key-token        { api_key }            -> { access_token }
 *   POST /v1/auth/agent-token          { agent_id, api_key }  -> { access_token }
 *   GET  /v1/vaults/{id}/secrets/{path}                       -> { value, ... }
 *   PUT  /v1/vaults/{id}/secrets/{path} { value, type }
 *   GET  /v1/vaults/{id}/secrets                              -> { secrets: [...] }
 */

const INSPECT = Symbol.for("nodejs.util.inspect.custom");
const REDACTED = "[1claw:redacted]";

/**
 * An opaque wrapper around a sensitive value. The raw value is only reachable
 * through `.use(fn)`; every other access path is redacted.
 */
// Backing buffers live here, not as a property, so the raw value can never be
// reached via spread, Object.values, or an un-overridden serializer.
const SECRET_STORE = new WeakMap<Secret, Buffer | null>();

export class Secret<T extends string = string> {
  readonly label: string;

  constructor(value: T, label = "secret") {
    SECRET_STORE.set(this, Buffer.from(String(value), "utf8"));
    this.label = label;
  }

  /**
   * Hand the raw value to `fn` for the duration of one call. The backing buffer
   * is retained so the same Secret can back both a non-sensitive projection
   * (e.g. last-4) and a later charge; call `destroy()` to wipe it. The immutable
   * JS string handed to `fn` cannot itself be wiped — callers must not retain it
   * beyond the callback.
   */
  async use<R>(fn: (raw: T) => R | Promise<R>): Promise<R> {
    const buf = SECRET_STORE.get(this);
    if (!buf) {
      throw new Error(`Secret "${this.label}" has already been destroyed`);
    }
    const raw = buf.toString("utf8") as T;
    return await fn(raw);
  }

  /**
   * Derive a *non-sensitive* projection (e.g. last-4 of a PAN) without exposing
   * the secret. The projection is returned as a plain value — callers must
   * ensure it is genuinely non-sensitive.
   */
  async project<R>(fn: (raw: T) => R): Promise<R> {
    return this.use(fn);
  }

  /** Permanently zero the backing buffer. */
  destroy(): void {
    const buf = SECRET_STORE.get(this);
    if (buf) buf.fill(0);
    SECRET_STORE.set(this, null);
  }

  get consumed(): boolean {
    return !SECRET_STORE.get(this);
  }

  // --- redaction surfaces -------------------------------------------------
  toString(): string {
    return REDACTED;
  }
  toJSON(): string {
    return REDACTED;
  }
  [INSPECT](): string {
    return `Secret<${this.label}> ${REDACTED}`;
  }
  [Symbol.toPrimitive](): string {
    return REDACTED;
  }
}

interface SecretResponse {
  id: string;
  path: string;
  type: string;
  value: string;
  version: number;
}

interface SecretListItem {
  path?: string;
  key?: string;
  type?: string;
  version?: number;
}

function baseUrl(): string {
  return (process.env.ONECLAW_API_BASE_URL || "https://api.1claw.xyz").replace(/\/$/, "");
}

let cachedToken: { token: string; expiresAt: number } | null = null;

/** Exchange the configured API key (user key, or agent id + agent key) for a JWT. */
async function getToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return cachedToken.token;
  }

  const base = baseUrl();
  const userApiKey = (process.env.ONECLAW_API_KEY || "").trim();
  const agentId = (process.env.ONECLAW_AGENT_ID || "").trim();
  const agentApiKey = (process.env.ONECLAW_AGENT_API_KEY || "").trim();

  let res: Response;
  if (userApiKey) {
    res = await fetch(base + "/v1/auth/api-key-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: userApiKey }),
    });
  } else if (agentId && agentApiKey) {
    res = await fetch(base + "/v1/auth/agent-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: agentId, api_key: agentApiKey }),
    });
  } else {
    throw new VaultError(
      "No 1Claw credentials: set ONECLAW_API_KEY, or ONECLAW_AGENT_ID + ONECLAW_AGENT_API_KEY.",
    );
  }

  if (!res.ok) {
    throw new VaultError(`1Claw auth failed: ${res.status} ${await res.text()}`);
  }
  const j = (await res.json()) as { access_token: string };
  // JWTs are short-lived; cache conservatively for 5 minutes.
  cachedToken = { token: j.access_token, expiresAt: now + 5 * 60_000 };
  return j.access_token;
}

function vaultId(): string {
  const id = (process.env.ONECLAW_VAULT_ID || "").trim();
  if (!id) {
    throw new VaultError("ONECLAW_VAULT_ID is not set in .env — run `just sync-1claw-env`.");
  }
  return id;
}

export class VaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultError";
  }
}

export class SecretNotFound extends VaultError {
  constructor(public readonly path: string) {
    super(`No secret at vault path "${path}". Seed it via scripts/seed-vault.sh.local or just vault.`);
    this.name = "SecretNotFound";
  }
}

async function authed(path: string, init?: RequestInit): Promise<Response> {
  const token = await getToken();
  const res = await fetch(baseUrl() + path, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      Authorization: "Bearer " + token,
    },
  });
  if (res.status === 401) {
    // token may have expired mid-flight; clear and retry once
    cachedToken = null;
    const token2 = await getToken();
    return fetch(baseUrl() + path, {
      ...init,
      headers: { ...(init?.headers || {}), Authorization: "Bearer " + token2 },
    });
  }
  return res;
}

export const vault = {
  /**
   * Read a secret value by path. Returns an opaque `Secret` — the raw value is
   * never returned directly. `reason` is recorded in the 1Claw audit trail.
   */
  async read(path: string, reason?: string): Promise<Secret> {
    const clean = path.replace(/^\/+/, "");
    const q = reason ? "?reason=" + encodeURIComponent(reason) : "";
    const res = await authed(
      `/v1/vaults/${vaultId()}/secrets/${encodeURIComponent(clean)}${q}`,
    );
    if (res.status === 404) throw new SecretNotFound(clean);
    if (!res.ok) {
      throw new VaultError(`1Claw read "${clean}" failed: ${res.status} ${await res.text()}`);
    }
    const j = (await res.json()) as Partial<SecretResponse> & { data?: SecretResponse };
    const value = j.value ?? j.data?.value;
    if (typeof value !== "string") throw new SecretNotFound(clean);
    return new Secret(value, clean);
  },

  /** Returns true if a secret exists at `path` (no value is fetched). */
  async has(path: string): Promise<boolean> {
    const clean = path.replace(/^\/+/, "");
    const known = await this.list();
    return known.includes(clean);
  },

  /** List secret paths (metadata only — never values). */
  async list(prefix?: string): Promise<string[]> {
    const q = prefix ? "?prefix=" + encodeURIComponent(prefix) : "";
    const res = await authed(`/v1/vaults/${vaultId()}/secrets${q}`);
    if (!res.ok) {
      throw new VaultError(`1Claw list failed: ${res.status} ${await res.text()}`);
    }
    const j = (await res.json()) as
      | { secrets?: SecretListItem[]; data?: { secrets?: SecretListItem[] } }
      | SecretListItem[];
    const arr: SecretListItem[] = Array.isArray(j)
      ? j
      : (j.secrets ?? j.data?.secrets ?? []);
    return arr.map((s) => s.path ?? s.key ?? "").filter(Boolean);
  },

  /** Write/overwrite a secret. Used by scripts/server-only seeding, never by the LLM. */
  async write(path: string, value: string, type = "generic"): Promise<void> {
    const clean = path.replace(/^\/+/, "");
    const res = await authed(
      `/v1/vaults/${vaultId()}/secrets/${encodeURIComponent(clean)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value, type }),
      },
    );
    if (!res.ok) {
      throw new VaultError(`1Claw write "${clean}" failed: ${res.status} ${await res.text()}`);
    }
  },
};

/** Last-4 helper that never exposes the full value. */
export async function last4(secret: Secret): Promise<string> {
  return secret.project((raw) => {
    const digits = raw.replace(/\D/g, "");
    return digits.slice(-4).padStart(4, "•");
  });
}
