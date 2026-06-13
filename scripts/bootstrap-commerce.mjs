#!/usr/bin/env node
/**
 * bootstrap-commerce.mjs — one-shot setup of the agent's commerce credentials
 * in the 1Claw vault.
 *
 * Takes (via hidden prompt, env var, or stdin — never argv):
 *   - the 1Claw *human* API key      (ONECLAW_API_KEY)   [required]
 *   - the Ampersend agent secret     (AMPERSEND_AGENT_SECRET = "key:::account")
 *                                     or AMPERSEND_SIGNING_KEY (0x… EOA key)
 *   - an optional Lasso API key      (LASSO_API_KEY)      [only if you have one]
 *
 * and writes into the vault (ONECLAW_VAULT_ID, from .env):
 *   commerce/ampersend/agent-key      <- the Ampersend agent secret  (CLI: AMPERSEND_AGENT_SECRET)
 *   private-keys/ampersend-signing    <- the 0x key portion          (SDK x402 path)
 *   commerce/lasso/api-key            <- the Lasso API key            (only if provided)
 *
 * If the secret is in "key:::account" form, the account address is written to
 * .env as AMPERSEND_SMART_ACCOUNT_ADDRESS (a public address, safe in .env).
 *
 * Usage:
 *   export ONECLAW_API_KEY=1ck_...           # or it is read from your shell
 *   just bootstrap-commerce                  # prompts (hidden) for the rest
 *   # non-interactive:
 *   ONECLAW_API_KEY=… AMPERSEND_AGENT_SECRET=… LASSO_API_KEY=… node scripts/bootstrap-commerce.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPublicEnvFile, upsertEnvLine } from "./secrets-crypto.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DOTENV = join(ROOT, ".env");
const BASE = (process.env.ONECLAW_API_BASE_URL || "https://api.1claw.xyz").replace(/\/$/, "");

const CR = 13;
const LF = 10;
const EOT = 4; // Ctrl-D
const ETX = 3; // Ctrl-C
const BS = 8;
const DEL = 127;

function mergeDotenv() {
  const pub = loadPublicEnvFile(DOTENV);
  for (const [k, v] of Object.entries(pub)) {
    if (v !== undefined && v !== "" && process.env[k] === undefined) process.env[k] = v;
  }
}

/** Hidden TTY prompt (no echo). Returns "" if there is no TTY. */
function promptHidden(label) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      resolve("");
      return;
    }
    process.stdout.write(label);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    let buf = "";
    const onData = (ch) => {
      const c = ch.toString();
      const code = c.charCodeAt(0);
      if (c === "\n" || c === "\r" || code === CR || code === LF || code === EOT) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(buf);
      } else if (code === ETX) {
        process.exit(1);
      } else if (code === DEL || code === BS) {
        buf = buf.slice(0, -1);
      } else {
        buf += c;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function resolveValue(name, label, { required = false } = {}) {
  const fromEnv = (process.env[name] || "").trim();
  if (fromEnv) return fromEnv;
  const typed = (await promptHidden(label)).trim();
  if (!typed && required) {
    console.error(`\nMissing ${name} (set the env var or type it at the prompt).`);
    process.exit(1);
  }
  return typed;
}

async function getToken(apiKey) {
  const res = await fetch(BASE + "/v1/auth/api-key-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (!res.ok) throw new Error("1Claw auth failed: " + res.status + " " + (await res.text()));
  return (await res.json()).access_token;
}

async function putSecret(token, vaultId, path, value, type) {
  const url = BASE + "/v1/vaults/" + vaultId + "/secrets/" + encodeURIComponent(path);
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ value, type }),
  });
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status} ${await res.text()}`);
}

async function main() {
  mergeDotenv();

  const apiKey = await resolveValue("ONECLAW_API_KEY", "1Claw human API key (1ck_…): ", { required: true });
  const vaultId = (process.env.ONECLAW_VAULT_ID || "").trim();
  if (!vaultId) {
    console.error("Missing ONECLAW_VAULT_ID in .env — run `just reset -- --yes` (or `just sync-1claw-env`) first.");
    process.exit(1);
  }

  // Ampersend: prefer the combined agent secret; accept a bare 0x signing key.
  let agentSecret = await resolveValue(
    "AMPERSEND_AGENT_SECRET",
    "Ampersend agent secret (key:::account, or 0x… key): ",
  );
  if (!agentSecret) agentSecret = (process.env.AMPERSEND_SIGNING_KEY || "").trim();
  const lassoKey = await resolveValue("LASSO_API_KEY", "Lasso API key (leave blank if none): ");

  if (!agentSecret && !lassoKey) {
    console.error("Nothing to store: provide an Ampersend secret and/or a Lasso API key.");
    process.exit(1);
  }

  const token = await getToken(apiKey);
  const wrote = [];

  if (agentSecret) {
    await putSecret(token, vaultId, "commerce/ampersend/agent-key", agentSecret, "api_key");
    wrote.push("commerce/ampersend/agent-key");

    // Derive the 0x signing-key portion for the existing SDK x402 path.
    const keyPart = agentSecret.includes(":::") ? agentSecret.split(":::")[0] : agentSecret;
    const acctPart = agentSecret.includes(":::") ? agentSecret.split(":::")[1] : "";
    if (/^0x[0-9a-fA-F]{64}$/.test(keyPart)) {
      await putSecret(token, vaultId, "private-keys/ampersend-signing", keyPart, "private_key");
      wrote.push("private-keys/ampersend-signing");
    }
    if (/^0x[0-9a-fA-F]{40}$/.test(acctPart) && existsSync(DOTENV)) {
      let raw = readFileSync(DOTENV, "utf8");
      raw = upsertEnvLine(raw, "AMPERSEND_SMART_ACCOUNT_ADDRESS", acctPart);
      writeFileSync(DOTENV, raw, "utf8");
      wrote.push(".env:AMPERSEND_SMART_ACCOUNT_ADDRESS (public address)");
    }
  }

  if (lassoKey) {
    await putSecret(token, vaultId, "commerce/lasso/api-key", lassoKey, "api_key");
    wrote.push("commerce/lasso/api-key");
  }

  console.log("\n  ✓ Stored in vault " + vaultId + ":");
  for (const w of wrote) console.log("    • " + w);
  console.log("\n  Seed the rest (card fields, vendor keys) with scripts/seed-vault.sh.local.");
  console.log("  Verify at /vault in the app — values are never displayed.\n");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
