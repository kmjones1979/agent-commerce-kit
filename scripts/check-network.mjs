#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();

async function loadConfig() {
  const configPath = join(ROOT, "scaffold.config.ts");
  const netDefsPath = join(ROOT, "network-definitions.ts");

  if (!existsSync(configPath)) {
    console.error("Missing scaffold.config.ts — run from monorepo root.");
    process.exit(1);
  }

  const configRaw = readFileSync(configPath, "utf8");
  const m = configRaw.match(/export\s+const\s+targetNetwork\s*=\s*["']([^"']+)["']/);
  if (!m) {
    console.error("Could not parse targetNetwork from scaffold.config.ts");
    process.exit(1);
  }
  const targetNetwork = m[1];

  const netRaw = readFileSync(netDefsPath, "utf8");
  const chainIdMatch = netRaw.match(
    new RegExp(targetNetwork + ':[\\s\\S]*?chainId:\\s*(\\d+)')
  );
  if (!chainIdMatch) {
    console.error(
      "targetNetwork \"" + targetNetwork + "\" not found in NETWORKS (network-definitions.ts)."
    );
    process.exit(1);
  }
  return { targetNetwork, chainId: Number(chainIdMatch[1]) };
}

async function loadDeployedContracts() {
  const candidates = [
    join(ROOT, "packages/nextjs/contracts/deployedContracts.ts"),
    join(ROOT, "packages/vite/src/contracts/deployedContracts.ts"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const raw = readFileSync(p, "utf8");
    const keys = [];
    const re = /^\s*(\d+)\s*:/gm;
    let match;
    while ((match = re.exec(raw)) !== null) {
      keys.push(Number(match[1]));
    }
    return { path: p, chainIds: keys };
  }
  return { path: null, chainIds: [] };
}

async function main() {
  const { targetNetwork, chainId } = await loadConfig();
  const { path: contractsPath, chainIds } = await loadDeployedContracts();

  if (!contractsPath) {
    console.warn(
      "\u26a0  No deployedContracts.ts found — deploy contracts first (just deploy)."
    );
    process.exit(0);
  }

  if (!chainIds.includes(chainId)) {
    console.error("");
    console.error(
      "  \u2717  targetNetwork is \"" +
        targetNetwork +
        "\" (chainId " +
        chainId +
        ") but deployedContracts has no contracts for chain " +
        chainId +
        "."
    );
    console.error(
      "     Deploy to that network: just deploy " +
        targetNetwork +
        "  — or switch: just use-network <key>"
    );
    console.error("");
    process.exit(1);
  }

  console.log(
    "  \u2714  targetNetwork=\"" +
      targetNetwork +
      "\" (chainId " +
      chainId +
      ") — contracts deployed."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
