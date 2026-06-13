import { tool } from "ai";
import { z } from "zod";
import {
  createPublicClient,
  http,
  parseEther,
  type Abi,
  type Address,
} from "viem";
import deployedContracts from "@/contracts/deployedContracts";
import { getActiveNetwork, NETWORKS, rpcOverrides, type NetworkDefinition } from "@/lib/networks";
import { viemChainForNetwork } from "@repo/viem-chain";
import { createClient } from "@1claw/sdk";
import { getPaymentFetch } from "@/lib/ampersend-client";

function networkForChainId(chainId: number): NetworkDefinition | null {
  for (const n of Object.values(NETWORKS) as NetworkDefinition[]) {
    if (n.chainId === chainId) {
      const byChain = rpcOverrides[String(n.chainId)];
      const byKey = rpcOverrides[n.key];
      const override = byChain || byKey;
      return override?.trim() ? { ...n, rpcUrl: override.trim() } : n;
    }
  }
  return null;
}

function getContractMeta(chainId: number, contractName: string) {
  const byChain = (deployedContracts as Record<string, Record<string, { address: string; abi: Abi }>>)[
    String(chainId)
  ];
  if (!byChain) return { error: `No deployments for chainId ${chainId}` as const };
  const meta = byChain[contractName];
  if (!meta) {
    return {
      error: `Unknown contract "${contractName}" on chain ${chainId}. Try list_deployed_contracts.` as const,
    };
  }
  return { meta: { address: meta.address as Address, abi: meta.abi } };
}

function getOneclawAgentClient() {
  const baseUrl = (process.env.ONECLAW_API_BASE_URL || "https://api.1claw.xyz").replace(
    /\/$/,
    "",
  );
  const agentId = (process.env.ONECLAW_AGENT_ID || "").trim();
  const apiKey = (process.env.ONECLAW_AGENT_API_KEY || "").trim();
  if (!agentId || !apiKey) return null;
  return createClient({ baseUrl, apiKey, agentId });
}

const ONECLAW_CHAIN_NAMES: Record<number, string> = {
  1: "ethereum",
  8453: "base",
  11155111: "sepolia",
  84532: "base-sepolia",
  137: "polygon",
  56: "bnb",
  31337: "localhost",
};

function oneclawChainForActive(): string {
  const active = getActiveNetwork();
  return ONECLAW_CHAIN_NAMES[active.chainId] || "ethereum";
}

/**
 * Preset tools for the chat route: read deployed ABIs and eth_call via viem. When ONECLAW_AGENT_ID and ONECLAW_AGENT_API_KEY are set, also exposes 1Claw Intents (simulate + submit). See https://1claw.xyz/intents
 */
export function buildAgentOnchainTools() {
  const active = getActiveNetwork();

  return {
    list_deployed_contracts: tool({
      description:
        "List contracts from deployedContracts.ts (addresses + names per chain). Use before contract_read.",
      parameters: z.object({}),
      execute: async () => {
        const data = deployedContracts as Record<
          string,
          Record<string, { address: string; abi: readonly unknown[] }>
        >;
        const out: { chainId: number; contracts: { name: string; address: string }[] }[] =
          [];
        for (const [cid, contracts] of Object.entries(data)) {
          const names = Object.keys(contracts);
          if (names.length === 0) continue;
          out.push({
            chainId: Number(cid),
            contracts: names.map((name) => ({
              name,
              address: contracts[name].address,
            })),
          });
        }
        return { activeChainId: active.chainId, activeNetwork: active.key, deployments: out };
      },
    }),
    contract_read: tool({
      description:
        "Call a read-only (view/pure) contract function via RPC using the deployed ABI from deployedContracts.ts. chainId defaults to the active network.",
      parameters: z.object({
        chainId: z.number().optional().describe("EVM chain id, e.g. 31337, 11155111, 8453. Defaults to active network."),
        contractName: z.string().describe("Contract key in deployedContracts, e.g. YourContract"),
        functionName: z.string(),
        argsJson: z
          .string()
          .optional()
          .describe('JSON array of arguments, e.g. [] or ["0xabc..."]'),
      }),
      execute: async ({ chainId, contractName, functionName, argsJson }) => {
        const resolvedChainId = chainId ?? active.chainId;
        const got = getContractMeta(resolvedChainId, contractName);
        if ("error" in got) return { error: got.error };
        const net = networkForChainId(resolvedChainId);
        if (!net) {
          return {
            error: `chainId ${resolvedChainId} is not in scaffold NETWORKS — add it or switch targetNetwork.`,
          };
        }
        let args: readonly unknown[] = [];
        if (argsJson && argsJson.trim()) {
          try {
            const parsed = JSON.parse(argsJson) as unknown;
            if (!Array.isArray(parsed)) {
              return { error: "argsJson must be a JSON array" };
            }
            args = parsed;
          } catch {
            return { error: "Invalid argsJson — must be valid JSON array" };
          }
        }
        const client = createPublicClient({
          chain: viemChainForNetwork(net),
          transport: http(net.rpcUrl),
        });
        try {
          const result = await client.readContract({
            address: got.meta.address,
            abi: got.meta.abi,
            functionName,
            ...(args.length ? { args } : {}),
          });
          return { result: result as unknown };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { error: msg };
        }
      },
    }),
    oneclaw_intent_simulate: tool({
      description:
        "Simulate an EVM transaction via 1Claw Intents + Tenderly (no signing). Requires ONECLAW_AGENT_ID, ONECLAW_AGENT_API_KEY, and intents enabled for the agent. See https://1claw.xyz/intents",
      parameters: z.object({
        chain: z
          .string()
          .optional()
          .describe("1Claw chain name, e.g. base, sepolia, ethereum. Defaults to active network."),
        to: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
        valueEther: z
          .string()
          .describe("ETH value as a decimal string, e.g. 0 or 0.01"),
        data: z
          .string()
          .regex(/^0x[a-fA-F0-9]*$/i)
          .optional()
          .describe("Optional contract calldata (0x-prefixed hex)"),
      }),
      execute: async ({ chain, to, valueEther, data }) => {
        const client = getOneclawAgentClient();
        const agentId = (process.env.ONECLAW_AGENT_ID || "").trim();
        if (!client || !agentId) {
          return {
            error:
              "Missing ONECLAW_AGENT_ID or ONECLAW_AGENT_API_KEY — cannot call Intents API.",
          };
        }
        const resolvedChain = chain || oneclawChainForActive();
        const valueWei = parseEther(valueEther || "0").toString();
        const res = await client.agents.simulateTransaction(agentId, {
          chain: resolvedChain,
          to,
          value: valueWei,
          data: data || "0x",
        });
        if (res.error) {
          return { error: res.error.message, type: res.error.type };
        }
        return res.data;
      },
    }),
    oneclaw_intent_submit: tool({
      description:
        "Submit a transaction intent to 1Claw — signing and optional broadcast happen in the TEE (keys never in the model). Requires ONECLAW_AGENT_ID, ONECLAW_AGENT_API_KEY, and intents_api_enabled on the agent. See https://1claw.xyz/intents",
      parameters: z.object({
        chain: z
          .string()
          .optional()
          .describe("1Claw chain name. Defaults to active network."),
        to: z.string().regex(/^0x[a-fA-F0-9]{40}$/i),
        valueEther: z.string().describe("ETH value as a decimal string, e.g. 0 or 0.05"),
        data: z
          .string()
          .regex(/^0x[a-fA-F0-9]*$/i)
          .optional(),
        simulate_first: z.boolean().optional().describe("If true, simulate before signing"),
      }),
      execute: async ({ chain, to, valueEther, data, simulate_first }) => {
        const client = getOneclawAgentClient();
        const agentId = (process.env.ONECLAW_AGENT_ID || "").trim();
        if (!client || !agentId) {
          return {
            error:
              "Missing ONECLAW_AGENT_ID or ONECLAW_AGENT_API_KEY — cannot call Intents API.",
          };
        }
        const resolvedChain = chain || oneclawChainForActive();
        const valueWei = parseEther(valueEther || "0").toString();
        const res = await client.agents.submitTransaction(
          agentId,
          {
            chain: resolvedChain,
            to,
            value: valueWei,
            data: data || "0x",
            simulate_first: simulate_first ?? true,
          },
        );
        if (res.error) {
          return { error: res.error.message, type: res.error.type };
        }
        return res.data;
      },
    }),
    x402_paid_fetch: tool({
      description:
        "Fetch a URL that requires x402 payment. Automatically handles the 402 Payment Required flow: signs a USDC payment via the Ampersend wallet and retries the request. Use for any API behind an x402 paywall (e.g. https://httpay.xyz/api/market-mood). Requires AMPERSEND_SIGNING_KEY.",
      parameters: z.object({
        url: z.string().url().describe("The full URL to fetch (must be HTTPS)"),
        method: z
          .enum(["GET", "POST", "PUT", "DELETE"])
          .optional()
          .describe("HTTP method. Defaults to GET."),
        body: z
          .string()
          .optional()
          .describe("Request body as JSON string (for POST/PUT)"),
        headers: z
          .record(z.string())
          .optional()
          .describe("Extra headers to include"),
      }),
      execute: async ({ url, method, body, headers }) => {
        try {
          const payFetch = await getPaymentFetch();
          const init: RequestInit = { method: method || "GET" };
          if (body) {
            init.body = body;
            init.headers = { "Content-Type": "application/json", ...headers };
          } else if (headers) {
            init.headers = headers;
          }
          const res = await payFetch(url, init);
          const contentType = res.headers.get("content-type") || "";
          const text = await res.text();
          if (!res.ok) {
            return {
              error: `HTTP ${res.status} ${res.statusText}`,
              body: text.slice(0, 4000),
            };
          }
          if (contentType.includes("application/json")) {
            try {
              return { status: res.status, data: JSON.parse(text) };
            } catch {
              return { status: res.status, data: text.slice(0, 4000) };
            }
          }
          return { status: res.status, data: text.slice(0, 4000) };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { error: msg };
        }
      },
    }),
  };
}
