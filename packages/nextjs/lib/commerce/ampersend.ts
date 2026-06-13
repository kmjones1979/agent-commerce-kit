/**
 * ampersend.ts — drive the `ampersend` CLI for policy co-approval, spend
 * status, and prepaid-card issuance.
 *
 * The agent's Ampersend credential (`AMPERSEND_AGENT_SECRET` = "key:::account")
 * is read from the 1Claw vault at `commerce/ampersend/agent-key` and injected
 * into the child process environment for exactly one invocation — never written
 * to disk, an rc file, or .env. If no vault credential is present we fall back
 * to the CLI's locally-configured active context (dev convenience).
 *
 * The LLM never sees the credential or raw card data; tools receive only the
 * structured, redacted results returned here.
 */
import { execFile } from "node:child_process";
import { vault, SecretNotFound } from "./vault";

export const AMPERSEND_VAULT_PATH = "commerce/ampersend/agent-key";

export interface Envelope<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

const DOLLAR = 1_000_000; // atomic units per USD (USDC, 6 decimals)

export function atomicToUsd(atomic: number | string | undefined | null): number {
  const n = typeof atomic === "string" ? Number(atomic) : atomic ?? 0;
  return Math.round((Number(n) / DOLLAR) * 100) / 100;
}

// `npm run dev` prepends node_modules/.bin to PATH, where the SDK ships an older
// `ampersend` CLI shim that shadows the globally-installed CLI. Drop those
// segments so we resolve the global CLI (which has `agent`, `card`, `--pay`).
const AMPERSEND_BIN = process.env.AMPERSEND_BIN || "ampersend";

function resolvedPath(): string {
  const sep = process.platform === "win32" ? ";" : ":";
  return (process.env.PATH || "")
    .split(sep)
    .filter((seg) => !seg.replace(/\\/g, "/").includes("node_modules/.bin"))
    .join(sep);
}

function ampersendEnvExtras(): Record<string, string> {
  const extra: Record<string, string> = { PATH: resolvedPath() };
  if (process.env.AMPERSEND_NETWORK) extra.AMPERSEND_NETWORK = process.env.AMPERSEND_NETWORK;
  if (process.env.AMPERSEND_API_URL) extra.AMPERSEND_API_URL = process.env.AMPERSEND_API_URL;
  if (process.env.AMPERSEND_CONTEXT) extra.AMPERSEND_CONTEXT = process.env.AMPERSEND_CONTEXT;
  return extra;
}

function spawnAmpersend(args: string[], env: NodeJS.ProcessEnv): Promise<Envelope> {
  return new Promise((resolve) => {
    execFile(
      AMPERSEND_BIN,
      args,
      { env, timeout: 12 * 60_000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const raw = (stdout || "").trim() || (stderr || "").trim();
        // The CLI emits a JSON envelope and exits 0 even for ok:false. Caller
        // errors (bad flags / missing config) exit 1 but still print JSON.
        try {
          resolve(JSON.parse(raw) as Envelope);
        } catch {
          resolve({
            ok: false,
            error: {
              code: "CLI_ERROR",
              message:
                (err?.message ? err.message + " — " : "") +
                (raw || "ampersend produced no output"),
            },
          });
        }
      },
    );
  });
}

/** Run an ampersend command with the agent secret injected JIT from the vault. */
export async function runAmpersend(args: string[]): Promise<Envelope> {
  const base = { ...process.env, ...ampersendEnvExtras() } as NodeJS.ProcessEnv;
  try {
    const secret = await vault.read(AMPERSEND_VAULT_PATH, "ampersend:" + args[0]);
    return await secret.use((agentSecret) =>
      spawnAmpersend(args, { ...base, AMPERSEND_AGENT_SECRET: agentSecret }),
    );
  } catch (e) {
    if (e instanceof SecretNotFound) {
      // No vaulted credential — fall back to the CLI's local active context.
      return spawnAmpersend(args, base);
    }
    return {
      ok: false,
      error: { code: "VAULT_ERROR", message: e instanceof Error ? e.message : String(e) },
    };
  }
}

// --- reads -----------------------------------------------------------------

export interface SpendConfig {
  perTransactionUsd: number | null;
  dailyUsd: number | null;
  monthlyUsd: number | null;
  autoTopup: boolean;
  raw: unknown;
}

export async function getSpendConfig(): Promise<SpendConfig | { error: string }> {
  const env = await runAmpersend(["agent", "spend-config"]);
  if (!env.ok) return { error: env.error?.message || "spend-config failed" };
  const d = (env.data ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): number | null => {
    for (const k of keys) {
      const v = d[k];
      if (typeof v === "number") return atomicToUsd(v);
      if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return atomicToUsd(Number(v));
    }
    return null;
  };
  return {
    perTransactionUsd: pick("per_transaction_limit", "perTransactionLimit", "per_tx_limit"),
    dailyUsd: pick("daily_limit", "dailyLimit"),
    monthlyUsd: pick("monthly_limit", "monthlyLimit"),
    autoTopup: Boolean(d.auto_topup ?? d.autoTopup ?? false),
    raw: env.data,
  };
}

export interface AgentSnapshot {
  balanceUsd: number | null;
  address: string | null;
  raw: unknown;
}

export async function getAgentSnapshot(): Promise<AgentSnapshot | { error: string }> {
  const env = await runAmpersend(["agent"]);
  if (!env.ok) return { error: env.error?.message || "agent snapshot failed" };
  const d = (env.data ?? {}) as Record<string, unknown>;
  const balRaw = (d.balance ?? d.usdc_balance ?? d.balanceUsd) as unknown;
  let balanceUsd: number | null = null;
  if (typeof balRaw === "number") balanceUsd = balRaw > 100000 ? atomicToUsd(balRaw) : balRaw;
  else if (typeof balRaw === "string" && balRaw.trim()) balanceUsd = Number(balRaw);
  return {
    balanceUsd,
    address: (d.address ?? d.agent_address ?? (d.agent as Record<string, unknown>)?.address ?? null) as string | null,
    raw: env.data,
  };
}

export interface PaymentRecord {
  amountUsd: number;
  description?: string;
  date?: string;
  txHash?: string;
}

export async function getPayments(preset: "1d" | "30d" | "all" = "1d"): Promise<PaymentRecord[]> {
  const env = await runAmpersend(["agent", "payments", "--preset", preset]);
  if (!env.ok) return [];
  const d = env.data as Record<string, unknown> | unknown[];
  const arr = Array.isArray(d) ? d : ((d as Record<string, unknown>)?.payments as unknown[]) ?? [];
  return (arr as Record<string, unknown>[]).map((p) => ({
    amountUsd: atomicToUsd((p.amount as number) ?? 0),
    description: (p.description ?? p.memo) as string | undefined,
    date: (p.date ?? p.created_at) as string | undefined,
    txHash: (p.tx_hash ?? p.txHash) as string | undefined,
  }));
}

// --- card issuance (Laso under the hood) -----------------------------------

export interface IssuedCard {
  cardId: string;
  status: string;
  paymentAmountUsd?: number;
}

export async function issueCard(amountUsd: number): Promise<IssuedCard | { error: string }> {
  const env = await runAmpersend(["card", "issue", "--amount", String(amountUsd)]);
  if (!env.ok) return { error: env.error?.message || env.error?.code || "card issue failed" };
  const d = (env.data ?? {}) as Record<string, unknown>;
  const cardId = (d.card_id ?? d.cardId ?? d.id) as string | undefined;
  if (!cardId) return { error: "card issue returned no card_id" };
  const pay = (d.payment ?? {}) as Record<string, unknown>;
  return {
    cardId,
    status: (d.status as string) ?? "pending",
    paymentAmountUsd: pay.amount !== undefined ? atomicToUsd(pay.amount as number) : undefined,
  };
}

export interface RevealedCard {
  status: string;
  pan: string;
  cvv: string;
  expiry: string;
  balanceUsd?: number;
}

/** Reveal full card data once ready. Caller must treat pan/cvv as secret. */
export async function cardDetailsReveal(
  cardId: string,
  pay = false,
): Promise<RevealedCard | { status: string } | { error: string }> {
  const args = ["card", "details", cardId, "--reveal"];
  if (pay) args.push("--pay");
  const env = await runAmpersend(args);
  if (!env.ok) return { error: env.error?.message || env.error?.code || "card details failed" };
  const d = (env.data ?? {}) as Record<string, unknown>;
  if (d.status !== "ready") return { status: (d.status as string) ?? "pending" };
  return {
    status: "ready",
    pan: String(d.pan ?? ""),
    cvv: String(d.cvv ?? ""),
    expiry: String(d.expiry ?? ""),
    balanceUsd: d.balance !== undefined ? Number(d.balance) : undefined,
  };
}

/** Poll card details until ready (or timeout). Returns revealed card or error. */
export async function waitForCard(
  cardId: string,
  { tries = 20, intervalMs = 3000 } = {},
): Promise<RevealedCard | { error: string }> {
  for (let i = 0; i < tries; i++) {
    const res = await cardDetailsReveal(cardId, i === 0 ? false : true);
    if ("error" in res) return res;
    if ("pan" in res && res.status === "ready") return res;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { error: `card ${cardId} not ready after polling` };
}

/** Whether an Ampersend credential is reachable (vault or local context). */
export async function ampersendConfigured(): Promise<boolean> {
  const env = await runAmpersend(["agent", "owner"]);
  return env.ok;
}
