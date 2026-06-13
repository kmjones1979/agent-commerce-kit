#!/usr/bin/env node
/**
 * Re-bootstrap 1Claw: new vault, store deployer (+ optional agent) keys, register agent,
 * update repo-root .env (ONECLAW_VAULT_ID, ONECLAW_AGENT_ID). Prints new ONECLAW_AGENT_API_KEY
 * once — add it with `just enc ONECLAW_AGENT_API_KEY 'ocv_...'` if you use encrypted secrets.
 *
 *   just reset              # warns, then prompts to type YES
 *   just reset -- --yes     # skip confirmation (automation)
 *
 * Requires: ONECLAW_API_KEY, DEPLOYER_PRIVATE_KEY (via with-secrets / .env).
 * Optional: AGENT_PRIVATE_KEY (on-chain agent path). If absent, registers a Shroud-only agent.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readlinePromises from "node:readline/promises";
import { loadPublicEnvFile, upsertEnvLine } from "./secrets-crypto.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DOTENV = join(ROOT, ".env");
const ENC = join(ROOT, ".env.secrets.encrypted");
const PKG = join(ROOT, "package.json");
const BASE = "https://api.1claw.xyz";

function mergePublicDotenv() {
  const pub = loadPublicEnvFile(DOTENV);
  for (const [k, v] of Object.entries(pub)) {
    if (v !== undefined && v !== "" && process.env[k] === undefined) {
      process.env[k] = v;
    }
  }
}

function parseVaultId(json) {
  if (!json || typeof json !== "object") throw new Error("Invalid vault response");
  const o = json;
  if (typeof o.id === "string" && o.id.trim()) return o.id.trim();
  const v = o.vault;
  if (v && typeof v === "object" && typeof v.id === "string") return v.id.trim();
  const d = o.data;
  if (d && typeof d === "object") {
    if (typeof d.id === "string" && d.id.trim()) return d.id.trim();
    const iv = d.vault;
    if (iv && typeof iv === "object" && typeof iv.id === "string") return iv.id.trim();
  }
  throw new Error("Unexpected vault create response");
}

function parseAgentCreated(json) {
  if (!json || typeof json !== "object") throw new Error("Invalid agent response");
  const o = json;
  let id;
  let apiKey;
  const ag = o.agent;
  if (ag && typeof ag === "object" && typeof ag.id === "string") id = ag.id.trim();
  if (!id && typeof o.id === "string") id = o.id.trim();
  if (typeof o.api_key === "string") apiKey = o.api_key.trim();
  const d = o.data;
  if (d && typeof d === "object") {
    const inner = d.agent;
    if (!id && inner && typeof inner === "object" && typeof inner.id === "string") {
      id = inner.id.trim();
    }
    if (!apiKey && typeof d.api_key === "string") apiKey = d.api_key.trim();
  }
  if (!id || !apiKey) throw new Error("Unexpected agent create response (need id + api_key)");
  return { id, apiKey };
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

async function createVault(token, name) {
  const res = await fetch(BASE + "/v1/vaults", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({
      name,
      description: "Vault from just reset (" + name + ")",
    }),
  });
  if (!res.ok) throw new Error("Create vault failed: " + res.status + " " + (await res.text()));
  return parseVaultId(await res.json());
}

async function storeSecret(token, vaultId, path, value, type = "private_key") {
  const enc = encodeURIComponent(path);
  const res = await fetch(BASE + "/v1/vaults/" + vaultId + "/secrets/" + enc, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ value, type }),
  });
  if (!res.ok) {
    throw new Error("Store secret " + path + " failed: " + res.status + " " + (await res.text()));
  }
}

async function registerAgent(token, name) {
  const res = await fetch(BASE + "/v1/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("Register agent failed: " + res.status + " " + (await res.text()));
  return parseAgentCreated(await res.json());
}

function readPkgName() {
  if (!existsSync(PKG)) return "agent-project";
  try {
    const j = JSON.parse(readFileSync(PKG, "utf8"));
    if (typeof j.name === "string" && j.name.trim()) return j.name.trim().replace(/^@[^/]+\//, "");
  } catch {
    /* fall through */
  }
  return "agent-project";
}

async function main() {
  const argv = process.argv.slice(2);
  const skipConfirm = argv.includes("--yes") || argv.includes("-y");

  mergePublicDotenv();

  console.log(
    "\n" +
      "╔══════════════════════════════════════════════════════════════════════╗\n" +
      "║  WARNING: just reset — 1Claw re-bootstrap                             ║\n" +
      "╠══════════════════════════════════════════════════════════════════════╣\n" +
      "║  • This creates a **new** vault and **new** Shroud/agent credentials. ║\n" +
      "║  • Your **old** vault and agents stay on 1claw.xyz (not deleted).    ║\n" +
      "║  • **Back up** first: copy .env, .env.secrets.encrypted, and export   ║\n" +
      "║    any keys you need. Old ONECLAW_AGENT_API_KEY will **not** work for   ║\n" +
      "║    the new agent — you must save the new key printed below.           ║\n" +
      "║  • Org **tier limits** (vaults/agents) still apply — upgrade or free  ║\n" +
      "║    slots on 1claw.xyz if create/register fails.                       ║\n" +
      "╚══════════════════════════════════════════════════════════════════════╝\n",
  );

  if (!skipConfirm) {
    if (!process.stdin.isTTY) {
      console.error(
        "Non-interactive shell: run: just reset -- --yes   (after backing up), or use a TTY.",
      );
      process.exit(1);
    }
    const rl = readlinePromises.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const ans = (await rl.question("Type YES (all caps) to continue: ")).trim();
    await rl.close();
    if (ans !== "YES") {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  const apiKey = (process.env.ONECLAW_API_KEY || "").trim();
  if (!apiKey) {
    console.error("Missing ONECLAW_API_KEY (add via just enc or .env).");
    process.exit(1);
  }
  const deployerPk = (process.env.DEPLOYER_PRIVATE_KEY || "").trim();
  if (!deployerPk) {
    console.error("Missing DEPLOYER_PRIVATE_KEY (unlock secrets: run via just reset, not bare node).");
    process.exit(1);
  }

  const pkgName = readPkgName();
  const suffix = new Date().toISOString().slice(0, 10);
  const vaultName = pkgName + "-reset-" + suffix;

  const token = await getToken(apiKey);
  console.log("\n  Creating vault: " + vaultName + " ...");
  const vaultId = await createVault(token, vaultName);
  await storeSecret(token, vaultId, "private-keys/deployer", deployerPk, "private_key");

  const agentPk = (process.env.AGENT_PRIVATE_KEY || "").trim();
  let agentInfo;
  if (agentPk) {
    await storeSecret(token, vaultId, "private-keys/agent", agentPk, "private_key");
    agentInfo = await registerAgent(token, pkgName + "-agent");
  } else if ((process.env.RESET_SKIP_SHROUD_AGENT || "").trim() === "1") {
    console.log("  RESET_SKIP_SHROUD_AGENT=1 — skipping agent registration.");
  } else {
    agentInfo = await registerAgent(token, pkgName + "-shroud");
  }

  const llmKey = (process.env.RESET_COPY_LLM_API_KEY || "").trim();
  if (llmKey) {
    await storeSecret(token, vaultId, "llm-api-key", llmKey, "api_key");
    console.log("  Stored llm-api-key in vault (from RESET_COPY_LLM_API_KEY).");
  }

  const shroudPath = (process.env.SHROUD_PROVIDER_VAULT_PATH || "").trim();
  const shroudKey = (process.env.SHROUD_PROVIDER_API_KEY || "").trim();
  if (shroudPath && shroudKey) {
    await storeSecret(token, vaultId, shroudPath, shroudKey, "api_key");
    console.log("  Stored Shroud provider key at " + shroudPath + " in vault.");
  }

  if (!existsSync(DOTENV)) {
    console.error("Missing " + DOTENV + " — create .env first.");
    process.exit(1);
  }
  let raw = readFileSync(DOTENV, "utf8");
  raw = upsertEnvLine(raw, "ONECLAW_VAULT_ID", vaultId);
  if (agentInfo) {
    raw = upsertEnvLine(raw, "ONECLAW_AGENT_ID", agentInfo.id);
  }
  writeFileSync(DOTENV, raw, "utf8");

  console.log("\n  ✓ ONECLAW_VAULT_ID=" + vaultId);
  if (agentInfo) {
    console.log("  ✓ ONECLAW_AGENT_ID=" + agentInfo.id);
    console.log("\n  New ONECLAW_AGENT_API_KEY (save now — shown once):\n");
    console.log("    " + agentInfo.apiKey);
    if (existsSync(ENC)) {
      console.log(
        "\n  Encrypted secrets: add the key with:\n" +
          "    just enc ONECLAW_AGENT_API_KEY '" +
          agentInfo.apiKey +
          "'\n",
      );
    } else {
      let r2 = readFileSync(DOTENV, "utf8");
      r2 = upsertEnvLine(r2, "ONECLAW_AGENT_API_KEY", agentInfo.apiKey);
      writeFileSync(DOTENV, r2, "utf8");
      console.log("\n  Wrote ONECLAW_AGENT_API_KEY to plain .env (no encrypted file).\n");
    }
  } else {
    console.log(
      "\n  No agent registered — set ONECLAW_AGENT_ID / API key manually if you use Shroud.\n",
    );
  }

  console.log(
    "  Old resources remain on 1claw.xyz; you can delete unused vaults/agents in the dashboard.\n",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
