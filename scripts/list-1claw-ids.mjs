#!/usr/bin/env node
/**
 * Lists agents (UUIDs for ONECLAW_AGENT_ID) and vaults (ONECLAW_VAULT_ID).
 * Auth: your *user* ONECLAW_API_KEY (same as scaffold CLI).
 *
 * Agent API keys are only returned on create or rotate — never listed.
 *
 *   just list-1claw
 *   ONECLAW_API_KEY=1ck_... node scripts/list-1claw-ids.mjs
 *
 * Loads repo-root .env automatically (same keys as `just list-1claw` for plain .env).
 * Optional: append --write-env to set ONECLAW_VAULT_ID / ONECLAW_AGENT_ID from the
 * first vault + first agent returned (does not touch ONECLAW_AGENT_API_KEY).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPublicEnvFile, upsertEnvLine } from "./secrets-crypto.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DOTENV = join(ROOT, ".env");

const BASE = "https://api.1claw.xyz";

/** Merge repo-root .env into process.env without overriding the shell. */
function mergePublicDotenv() {
  const pub = loadPublicEnvFile(DOTENV);
  for (const [k, v] of Object.entries(pub)) {
    if (v !== undefined && v !== "" && process.env[k] === undefined) {
      process.env[k] = v;
    }
  }
}

async function getToken(apiKey) {
  const res = await fetch(BASE + "/v1/auth/api-key-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (!res.ok) {
    throw new Error(
      "1Claw auth failed: " + res.status + " " + (await res.text()),
    );
  }
  const j = await res.json();
  return j.access_token;
}

async function main() {
  const argv = process.argv.slice(2);
  const writeEnv = argv.includes("--write-env");

  mergePublicDotenv();

  const apiKey = (process.env.ONECLAW_API_KEY || "").trim();
  if (!apiKey) {
    console.error(
      "Missing ONECLAW_API_KEY (add to .env, .env.secrets.encrypted via just list-1claw, or export in shell)",
    );
    process.exit(1);
  }

  const t = await getToken(apiKey);
  const auth = { Authorization: "Bearer " + t };

  const [agentsRes, vaultsRes] = await Promise.all([
    fetch(BASE + "/v1/agents", { headers: auth }),
    fetch(BASE + "/v1/vaults", { headers: auth }),
  ]);

  const agentsJson = await agentsRes.json().catch(() => ({}));
  const vaultsJson = await vaultsRes.json().catch(() => ({}));

  if (!agentsRes.ok) {
    console.error("GET /v1/agents", agentsRes.status, agentsJson);
    process.exit(1);
  }
  if (!vaultsRes.ok) {
    console.error("GET /v1/vaults", vaultsRes.status, vaultsJson);
    process.exit(1);
  }

  const agents = agentsJson.agents ?? agentsJson.data?.agents ?? [];
  const vaults = vaultsJson.vaults ?? vaultsJson.data?.vaults ?? [];

  console.log("\n  1Claw IDs for .env:\n");
  console.log("  Vaults → ONECLAW_VAULT_ID");
  if (!vaults.length) console.log("    (none)");
  else for (const v of vaults) {
    const id = v.id ?? v.vault_id;
    const name = v.name ? " (" + v.name + ")" : "";
    console.log("    " + id + name);
  }
  console.log("\n  Agents → ONECLAW_AGENT_ID (UUID from 1Claw, not an ETH address)");
  if (!agents.length) console.log("    (none)");
  else for (const a of agents) {
    const name = a.name ? " (" + a.name + ")" : "";
    console.log("    " + a.id + name);
  }
  console.log(
    "\n  ONECLAW_AGENT_API_KEY is only shown when you create or rotate an agent;\n" +
      "  use the dashboard or @1claw/sdk: client.agents.rotateKey(agentId).\n",
  );
  console.log(
    "  Programmatic listing: @1claw/sdk createClient({ apiKey }).agents.list()\n" +
      "  and .vault.list() — see https://github.com/1clawAI/1claw-sdk\n",
  );

  if (writeEnv) {
    if (!existsSync(DOTENV)) {
      console.error("Cannot --write-env: missing " + DOTENV);
      process.exit(1);
    }
    let raw = readFileSync(DOTENV, "utf8");
    const v0 = vaults[0];
    const a0 = agents[0];
    const vid = v0 ? v0.id ?? v0.vault_id : "";
    const aid = a0 ? a0.id : "";
    if (vid) {
      raw = upsertEnvLine(raw, "ONECLAW_VAULT_ID", vid);
      console.log("\n  Wrote ONECLAW_VAULT_ID=" + vid);
    } else {
      console.log("\n  No vault returned — left ONECLAW_VAULT_ID unchanged");
    }
    if (aid) {
      raw = upsertEnvLine(raw, "ONECLAW_AGENT_ID", aid);
      console.log("  Wrote ONECLAW_AGENT_ID=" + aid);
    } else {
      console.log(
        "  No agent returned — left ONECLAW_AGENT_ID unchanged (create an agent or use scaffold)",
      );
    }
    writeFileSync(DOTENV, raw, "utf8");
    console.log("  Updated " + DOTENV + "\n");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
