#!/usr/bin/env node
/**
 * enable-shroud.mjs — enable 1Claw Shroud LLM token billing on the current agent.
 *
 * Prompts for the 1Claw human API key (needed because agents can't update themselves),
 * then PATCHes the agent to set shroud_enabled: true.
 *
 * Usage:
 *   just enable-shroud
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPublicEnvFile } from "./secrets-crypto.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DOTENV = join(ROOT, ".env");
const BASE = (process.env.ONECLAW_API_BASE_URL || "https://api.1claw.xyz").replace(/\/$/, "");

function mergeDotenv() {
  const pub = loadPublicEnvFile(DOTENV);
  for (const [k, v] of Object.entries(pub)) {
    if (v !== undefined && v !== "" && process.env[k] === undefined) process.env[k] = v;
  }
}

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

async function main() {
  mergeDotenv();

  const agentId = (process.env.ONECLAW_AGENT_ID || "").trim();
  if (!agentId) {
    console.error("  ONECLAW_AGENT_ID not set in .env — run just bootstrap first.");
    process.exit(1);
  }

  console.log("\n  Enabling 1Claw Shroud on agent: " + agentId);
  console.log("  (Agents cannot update themselves — need your human API key)\n");

  const apiKey = (
    process.env.ONECLAW_API_KEY ||
    (await promptHidden("  1Claw human API key (1ck_...): "))
  ).trim();
  if (!apiKey) {
    console.error("\n  Missing API key.");
    process.exit(1);
  }

  // Auth with human key
  const authRes = await fetch(BASE + "/v1/auth/api-key-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey }),
  });
  if (!authRes.ok) throw new Error("1Claw auth failed: " + authRes.status + " " + (await authRes.text()));
  const { access_token } = await authRes.json();

  // Enable Shroud
  const patchRes = await fetch(BASE + "/v1/agents/" + agentId, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + access_token },
    body: JSON.stringify({ shroud_enabled: true }),
  });

  if (!patchRes.ok) {
    throw new Error("Enable Shroud failed: " + patchRes.status + " " + (await patchRes.text()));
  }

  console.log("\n  ✓ Shroud enabled on agent " + agentId);
  console.log("  LLM calls will be routed through https://shroud.1claw.xyz");
  console.log("  Token usage billed to your 1Claw account — no LLM API key needed.\n");
}

main().catch((e) => {
  console.error("\n  ✗ " + (e instanceof Error ? e.message : String(e)));
  process.exit(1);
});
