#!/usr/bin/env node
/**
 * Reads the Lasso card details from the 1Claw vault and prints them to the
 * terminal. Shows masked values by default; prompts for confirmation before
 * revealing full details.
 *
 * Usage:
 *   node scripts/with-secrets.mjs -- node scripts/show-lasso-card.mjs
 *   node scripts/with-secrets.mjs -- node scripts/show-lasso-card.mjs --reveal
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DOTENV = join(ROOT, ".env");

if (existsSync(DOTENV)) {
  for (const line of readFileSync(DOTENV, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let val = m[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      val = val.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
}

const BASE = (process.env.ONECLAW_API_BASE_URL || "https://api.1claw.xyz").replace(/\/$/, "");

async function getToken() {
  const apiKey = (process.env.ONECLAW_API_KEY || "").trim();
  if (!apiKey) throw new Error("Missing ONECLAW_API_KEY");
  const res = await fetch(BASE + "/v1/auth/api-key-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (!res.ok) throw new Error("1Claw auth failed: " + res.status);
  return (await res.json()).access_token;
}

async function readSecret(token, path) {
  const vaultId = process.env.ONECLAW_VAULT_ID;
  if (!vaultId) throw new Error("Missing ONECLAW_VAULT_ID");
  const res = await fetch(
    `${BASE}/v1/vaults/${encodeURIComponent(vaultId)}/secrets/${encodeURIComponent(path)}`,
    { headers: { Authorization: "Bearer " + token } },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const j = await res.json();
  return j.value ?? j.data?.value ?? null;
}

function mask(value, visibleTail = 4) {
  if (!value) return "—";
  const s = String(value);
  if (s.length <= visibleTail) return s;
  return "••••" + s.slice(-visibleTail);
}

function maskCvc(value) {
  if (!value) return "—";
  return "•".repeat(String(value).length);
}

async function confirm(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function printCard(pan, exp, cvc, name, zip, revealed) {
  const fmtPan  = revealed ? pan  : mask(pan);
  const fmtExp  = revealed ? exp  : (exp || "—");
  const fmtCvc  = revealed ? cvc  : maskCvc(cvc);
  const fmtName = name || "—";
  const fmtZip  = zip || "—";
  const mode    = revealed ? "REVEALED" : "MASKED";

  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║           Lasso Card (from 1Claw Vault) [${mode}]     ║`);
  console.log(`╠══════════════════════════════════════════════════════════╣`);
  console.log(`║                                                        ║`);
  console.log(`║  Name on card:  ${fmtName.padEnd(38)}║`);
  console.log(`║  Card number:   ${fmtPan.padEnd(38)}║`);
  console.log(`║  Expiry:        ${fmtExp.padEnd(38)}║`);
  console.log(`║  CVC:           ${fmtCvc.padEnd(38)}║`);
  console.log(`║  Billing ZIP:   ${fmtZip.padEnd(38)}║`);
  console.log(`║                                                        ║`);
  console.log(`╠══════════════════════════════════════════════════════════╣`);
  console.log(`║  Enter these at:                                       ║`);
  console.log(`║  printful.com/dashboard/wallet > Add card               ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝\n`);
}

async function main() {
  const skipPrompt = process.argv.includes("--reveal");
  const token = await getToken();

  const pan  = await readSecret(token, "commerce/lasso/card-pan");
  const exp  = await readSecret(token, "commerce/lasso/card-exp");
  const cvc  = await readSecret(token, "commerce/lasso/card-cvc");
  const name = await readSecret(token, "commerce/lasso/card-name");
  const zip  = await readSecret(token, "commerce/lasso/billing-zip");

  if (!pan) {
    console.error(
      "\n  No Lasso card found in the vault.\n" +
      "  A card is issued when you place your first order via Ampersend.\n" +
      "  Try ordering a mug first, then re-run this script.\n",
    );
    process.exit(1);
  }

  printCard(pan, exp, cvc, name, zip, false);

  if (skipPrompt) {
    printCard(pan, exp, cvc, name, zip, true);
    return;
  }

  const answer = await confirm("Reveal full card details? (y/N): ");
  if (answer === "y" || answer === "yes") {
    printCard(pan, exp, cvc, name, zip, true);
  } else {
    console.log("  Card details remain masked. Re-run with --reveal to skip the prompt.\n");
  }
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
