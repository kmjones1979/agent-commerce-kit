#!/usr/bin/env node
import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PKG_DIR = join(ROOT, "packages/nextjs");
const VERCEL_DIR = join(PKG_DIR, ".vercel");

function vercelBin() {
  const r = spawnSync("npx", ["--yes", "vercel", "--version"], {
    stdio: "pipe",
    shell: true,
    timeout: 30_000,
  });
  if (r.status !== 0) {
    console.error("Could not run vercel CLI. Install with: npm i -g vercel");
    process.exit(1);
  }
  return "npx --yes vercel";
}

function loadDotEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (v) out[k] = v;
  }
  return out;
}

const RUNTIME_KEYS = [
  "ONECLAW_AGENT_API_KEY",
  "ONECLAW_AGENT_ID",
  "ONECLAW_API_KEY",
  "ONECLAW_VAULT_ID",
  "SHROUD_BILLING_MODE",
  "SHROUD_LLM_PROVIDER",
  "SHROUD_DEFAULT_MODEL",
  "SHROUD_PROVIDER_API_KEY",
  "SHROUD_PROVIDER_VAULT_PATH",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "ANTHROPIC_API_KEY",
  "NEXT_PUBLIC_AGENT_ADDRESS",
  "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID",
  "VITE_AGENT_ADDRESS",
  "VITE_WALLETCONNECT_PROJECT_ID",
];

function pushEnv(vcl, key, value) {
  console.log("  Setting " + key + " (production + preview)...");
  try {
    execSync(vcl + " env rm " + key + " production --yes", {
      cwd: PKG_DIR, stdio: "pipe", shell: true,
    });
  } catch {}
  try {
    execSync(vcl + " env rm " + key + " preview --yes", {
      cwd: PKG_DIR, stdio: "pipe", shell: true,
    });
  } catch {}
  execSync("echo " + JSON.stringify(value) + " | " + vcl + " env add " + key + " production", {
    cwd: PKG_DIR, stdio: "pipe", shell: true,
  });
  execSync("echo " + JSON.stringify(value) + " | " + vcl + " env add " + key + " preview", {
    cwd: PKG_DIR, stdio: "pipe", shell: true,
  });
}

function main() {
  if (!existsSync(join(VERCEL_DIR, "project.json"))) {
    console.error("No Vercel project linked. Run \"just ship\" first to create and link a project.");
    process.exit(1);
  }

  const vcl = vercelBin();
  const args = process.argv.slice(2);

  if (args[0] === "--sync" || args[0] === "sync") {
    const env = loadDotEnv(join(ROOT, ".env"));
    const keys = RUNTIME_KEYS.filter((k) => env[k]);
    if (keys.length === 0) {
      console.log("  No matching env vars found in .env to sync.");
      process.exit(0);
    }
    console.log("");
    console.log("  Syncing " + keys.length + " env var(s) to Vercel...");
    console.log("");
    for (const k of keys) {
      pushEnv(vcl, k, env[k]);
    }
    console.log("");
    console.log("  Done! " + keys.length + " variable(s) synced.");
    console.log("");
    return;
  }

  if (args.length < 2) {
    console.log("");
    console.log("Usage:");
    console.log("  just ship-env KEY VALUE        # set a single env var on Vercel");
    console.log("  just ship-env sync             # push all known env vars from .env");
    console.log("");
    console.log("Examples:");
    console.log("  just ship-env ONECLAW_AGENT_API_KEY ocv_xxxx");
    console.log("  just ship-env OPENAI_API_KEY sk-xxxx");
    console.log("  just ship-env sync");
    console.log("");
    process.exit(1);
  }

  const key = args[0];
  const value = args.slice(1).join(" ");

  console.log("");
  pushEnv(vcl, key, value);
  console.log("");
  console.log("  Done! " + key + " set on Vercel (production + preview).");
  console.log("  Redeploy with: just ship");
  console.log("");
}

main();
