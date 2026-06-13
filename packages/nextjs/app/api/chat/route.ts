import { convertToCoreMessages, streamText, type Message } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createClient } from "@1claw/sdk";

import { buildAgentOnchainTools } from "@/lib/agent-onchain-tools";
import { buildCommerceTools } from "@/lib/commerce/tools";

// child_process (ampersend CLI) + node:sqlite (audit log) require the Node runtime.
export const runtime = "nodejs";

const _tools = { ...buildAgentOnchainTools(), ...buildCommerceTools() };

const client = createClient({
  baseUrl: "https://api.1claw.xyz",
  apiKey: process.env.ONECLAW_API_KEY!,
});

let cachedKey: string | null = null;

async function getLlmKey(): Promise<string> {
  if (cachedKey) return cachedKey;
  const vaultId = (process.env.ONECLAW_VAULT_ID || "").trim();
  const apiKey = (process.env.ONECLAW_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error(
      "ONECLAW_API_KEY is missing. Set it in .env so the server can read the vault.",
    );
  }
  if (!vaultId) {
    throw new Error(
      "ONECLAW_VAULT_ID is missing. Copy your vault id from 1claw.xyz into .env.",
    );
  }
  const res = await client.secrets.get(vaultId, "llm-api-key");
  if (res.error) {
    throw new Error(
      "1Claw vault read failed: " +
        res.error.message +
        ". Check ONECLAW_API_KEY and ONECLAW_VAULT_ID.",
    );
  }
  const value = res.data?.value;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      'No secret at vault path "llm-api-key". Add your LLM API key in the 1Claw dashboard (same path the scaffold uses) or set it via the API, then restart next dev.',
    );
  }
  cachedKey = value.trim();
  return cachedKey;
}

export async function POST(req: Request) {
  let messages: Message[];
  try {
    const body = await req.json();
    messages = body.messages as Message[];
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "Missing messages" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  let key: string;
  try {
    key = await getLlmKey();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/chat] getLlmKey:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
  const provider = createAnthropic({ apiKey: key });

  const result = streamText({
    model: provider("claude-sonnet-4-6-20250217"),
    system:
      "You are an onchain AI agent that can also place real commerce orders. " +
      "On-chain tools (list_deployed_contracts, contract_read) work against this repo's deployed contracts and RPC; prefer them over guessing addresses or ABIs. If oneclaw_intent_simulate / oneclaw_intent_submit are present they call 1Claw Intents (TEE signing; https://1claw.xyz/intents) — never submit high-value txs without explicit user confirmation. x402_paid_fetch calls APIs behind x402 paywalls. " +
      "COMMERCE: order_pizza (Domino's), book_flight (Duffel test), and send_gift_card (Tremendous sandbox) each go through an Ampersend co-approval + policy + audit layer before any money moves; the agent's payment instrument (an Ampersend-issued prepaid card or a vault-stored Lasso card) is resolved server-side — you never see card numbers, keys, or vault values. Call get_spend_status to report the agent's limits, daily-remaining, balance, and recent payments. " +
      "When a tool returns decision:\"denied\", report the reason plainly and do NOT retry the same order. When a result has dryRun:true, tell the user it was a preview (no real order) and mention the relevant COMMERCE_*_LIVE flag.",
    messages: convertToCoreMessages(messages),
    tools: _tools,
    maxSteps: 8,
    onError({ error }) {
      console.error("[api/chat] streamText error:", error);
    },
  });

  return result.toDataStreamResponse();
}
