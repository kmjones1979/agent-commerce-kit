#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  parseVerifyNetwork,
  getChainId,
  getForgeChain,
  isLocalNetwork,
  getExplorerApiKey,
} from "./deploy-networks.mjs";

const root = process.cwd();
const foundry = join(root, "packages", "foundry");

const network = parseVerifyNetwork(process.argv.slice(2));

if (isLocalNetwork(network)) {
  console.log("Skipping explorer verification for localhost (chain 31337).");
  process.exit(0);
}

const chainId = getChainId(network);
const broadcastDir = join(
  foundry,
  "broadcast",
  "Deploy.s.sol",
  String(chainId),
);
const runLatest = join(broadcastDir, "run-latest.json");
if (!existsSync(runLatest)) {
  console.error("Missing", runLatest);
  console.error("Deploy first: just deploy " + network);
  process.exit(1);
}

const run = JSON.parse(readFileSync(runLatest, "utf8"));
const txs = run.transactions || [];
const created = txs.find(
  (t) =>
    t.transactionType === "CREATE" &&
    (t.contractName === "AgentWallet" || t.contractName?.includes("AgentWallet")),
);
if (!created?.contractAddress) {
  console.error("Could not find AgentWallet CREATE in run-latest.json");
  process.exit(1);
}

const address = created.contractAddress;
const agentRaw = (process.env.AGENT_ADDRESS || "").trim() || "0x0000000000000000000000000000000000000000";
const agentAddr = agentRaw.startsWith("0x") ? agentRaw : "0x" + agentRaw;

const enc = spawnSync(
  "cast",
  ["abi-encode", "constructor(address)", agentAddr],
  { cwd: foundry, encoding: "utf8" },
);
if (enc.status !== 0) {
  console.error(enc.stderr || "cast abi-encode failed");
  process.exit(1);
}
const constructorArgs = enc.stdout.trim().replace(/^0x/i, "");

const apiKey = getExplorerApiKey(network);
const forgeChain = getForgeChain(network);

console.log("Verifying AgentWallet at", address, "on", network, "(forge --chain", forgeChain + ")");

const r = spawnSync(
  "forge",
  [
    "verify-contract",
    address,
    "src/AgentWallet.sol:AgentWallet",
    "--chain",
    forgeChain,
    "--constructor-args",
    constructorArgs,
    "--etherscan-api-key",
    apiKey,
  ],
  { stdio: "inherit", cwd: foundry, env: process.env },
);
if (r.error) {
  console.error(r.error);
  process.exit(1);
}
process.exit(r.status ?? 1);
