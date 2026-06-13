#!/usr/bin/env node
/**
 * bootstrap.mjs — single-command project setup.
 *
 * Prompts for:
 *   1. 1Claw human API key (1ck_…)
 *   2. Ampersend signing key (0x… or key:::account)
 *
 * Then automatically:
 *   - Generates a deployer wallet
 *   - Creates a 1Claw vault
 *   - Registers a 1Claw agent
 *   - Creates a vault access policy granting the agent read access
 *   - Stores deployer key + Ampersend signing key in the vault
 *   - Writes all public IDs to .env
 *
 * Usage:
 *   just bootstrap
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPublicEnvFile, upsertEnvLine } from "./secrets-crypto.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DOTENV = join(ROOT, ".env");
const PKG = join(ROOT, "package.json");
const BASE = (process.env.ONECLAW_API_BASE_URL || "https://api.1claw.xyz").replace(/\/$/, "");

// ─── Hidden TTY prompt ──────────────────────────────────────────────────────

function promptHidden(label) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      console.error("No TTY — run this in an interactive terminal.");
      process.exit(1);
    }
    process.stdout.write(label);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    let buf = "";
    const onData = (ch) => {
      const c = ch.toString();
      const code = c.charCodeAt(0);
      if (c === "\n" || c === "\r" || code === 13 || code === 10 || code === 4) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(buf);
      } else if (code === 3) {
        process.stdout.write("\n");
        process.exit(1);
      } else if (code === 127 || code === 8) {
        buf = buf.slice(0, -1);
      } else {
        buf += c;
      }
    };
    process.stdin.on("data", onData);
  });
}

// ─── 1Claw API helpers ──────────────────────────────────────────────────────

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
    body: JSON.stringify({ name, description: `Vault for ${name}` }),
  });
  if (!res.ok) throw new Error("Create vault failed: " + res.status + " " + (await res.text()));
  const json = await res.json();
  const id = json?.id || json?.vault?.id || json?.data?.id || json?.data?.vault?.id;
  if (!id) throw new Error("Unexpected vault response — no ID found");
  return id.trim();
}

async function registerAgent(token, name) {
  const res = await fetch(BASE + "/v1/agents", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("Register agent failed: " + res.status + " " + (await res.text()));
  const json = await res.json();
  const id = json?.agent?.id || json?.id || json?.data?.agent?.id || json?.data?.id;
  const apiKey = json?.api_key || json?.data?.api_key;
  if (!id || !apiKey) throw new Error("Agent response missing id or api_key");
  return { id: id.trim(), apiKey: apiKey.trim() };
}

async function createPolicy(token, vaultId, agentId) {
  const res = await fetch(BASE + "/v1/vaults/" + vaultId + "/policies", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({
      secret_path_pattern: "**",
      principal_type: "agent",
      principal_id: agentId,
      permissions: ["read"],
    }),
  });
  if (!res.ok) throw new Error("Create policy failed: " + res.status + " " + (await res.text()));
  return await res.json();
}

async function storeSecret(token, vaultId, path, value, type = "private_key") {
  const url = BASE + "/v1/vaults/" + vaultId + "/secrets/" + encodeURIComponent(path);
  const res = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify({ value, type }),
  });
  if (!res.ok) throw new Error(`Store ${path} failed: ` + res.status + " " + (await res.text()));
}

// ─── Main ───────────────────────────────────────────────────────────────────

function readPkgName() {
  if (!existsSync(PKG)) return "agent-commerce-kit";
  try {
    const j = JSON.parse(readFileSync(PKG, "utf8"));
    if (typeof j.name === "string" && j.name.trim()) return j.name.trim().replace(/^@[^/]+\//, "");
  } catch { /* ignore */ }
  return "agent-commerce-kit";
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Agent Commerce Kit — Bootstrap                              ║
╠══════════════════════════════════════════════════════════════╣
║  This will set up your vault, agent, policy, and secrets.    ║
║  You need two things:                                        ║
║    1. Your 1Claw human API key (1ck_…)                       ║
║    2. Your Ampersend signing key (0x… or key:::account)       ║
╚══════════════════════════════════════════════════════════════╝
`);

  // 1. Collect credentials
  const apiKey = (
    process.env.ONECLAW_API_KEY ||
    (await promptHidden("  1Claw human API key (1ck_…): "))
  ).trim();
  if (!apiKey || !apiKey.startsWith("1ck_")) {
    console.error("\n  ✗ Invalid 1Claw key — must start with 1ck_");
    process.exit(1);
  }

  const ampersendSecret = (
    process.env.AMPERSEND_SIGNING_KEY ||
    process.env.AMPERSEND_AGENT_SECRET ||
    (await promptHidden("  Ampersend signing key (0x… or key:::account): "))
  ).trim();
  if (!ampersendSecret) {
    console.error("\n  ✗ Ampersend signing key is required.");
    process.exit(1);
  }

  // 2. Generate deployer wallet
  console.log("\n  Generating deployer wallet...");
  const { generatePrivateKey, privateKeyToAccount } = await import("viem/accounts");
  const deployerKey = generatePrivateKey();
  const deployer = privateKeyToAccount(deployerKey);

  // 3. Authenticate with 1Claw
  console.log("  Authenticating with 1Claw...");
  const token = await getToken(apiKey);

  // 4. Create vault
  const pkgName = readPkgName();
  const suffix = new Date().toISOString().slice(0, 10);
  const vaultName = `${pkgName}-${suffix}`;
  console.log("  Creating vault: " + vaultName + "...");
  const vaultId = await createVault(token, vaultName);

  // 5. Register agent
  console.log("  Registering agent...");
  const agent = await registerAgent(token, `${pkgName}-agent`);

  // 6. Create policy (agent gets read access to vault)
  console.log("  Creating vault access policy...");
  await createPolicy(token, vaultId, agent.id);

  // 7. Store secrets in vault
  console.log("  Storing deployer key in vault...");
  await storeSecret(token, vaultId, "private-keys/deployer", deployerKey, "private_key");

  console.log("  Storing Ampersend signing key in vault...");
  await storeSecret(token, vaultId, "commerce/ampersend/agent-key", ampersendSecret, "api_key");

  const keyPart = ampersendSecret.includes(":::") ? ampersendSecret.split(":::")[0] : ampersendSecret;
  if (/^0x[0-9a-fA-F]{64}$/.test(keyPart)) {
    await storeSecret(token, vaultId, "private-keys/ampersend-signing", keyPart, "private_key");
  }

  // 8. Write .env
  console.log("  Writing .env...");
  let env = existsSync(DOTENV) ? readFileSync(DOTENV, "utf8") : "";
  env = upsertEnvLine(env, "ONECLAW_VAULT_ID", vaultId);
  env = upsertEnvLine(env, "ONECLAW_AGENT_ID", agent.id);
  env = upsertEnvLine(env, "ONECLAW_AGENT_API_KEY", agent.apiKey);
  env = upsertEnvLine(env, "DEPLOYER_ADDRESS", deployer.address);
  env = upsertEnvLine(env, "DEPLOYER_PRIVATE_KEY", deployerKey);

  const acctPart = ampersendSecret.includes(":::") ? ampersendSecret.split(":::")[1] : "";
  if (/^0x[0-9a-fA-F]{40}$/.test(acctPart)) {
    env = upsertEnvLine(env, "AMPERSEND_SMART_ACCOUNT_ADDRESS", acctPart);
  }

  writeFileSync(DOTENV, env, { mode: 0o600 });

  // Done
  console.log(`
  ╔══════════════════════════════════════════════════════════════╗
  ║  ✓ Bootstrap complete                                        ║
  ╠══════════════════════════════════════════════════════════════╣
  ║  Vault:    ${vaultId.padEnd(46)}║
  ║  Agent:    ${agent.id.padEnd(46)}║
  ║  Deployer: ${deployer.address.padEnd(46)}║
  ╚══════════════════════════════════════════════════════════════╝

  Secrets stored in vault:
    • private-keys/deployer
    • commerce/ampersend/agent-key
    • private-keys/ampersend-signing

  Next steps:
    just chain     # start local Anvil chain
    just deploy    # deploy contracts
    just start     # start the app at http://localhost:3000
`);
}

main().catch((e) => {
  console.error("\n  ✗ " + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
