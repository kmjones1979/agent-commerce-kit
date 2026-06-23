import { convertToCoreMessages, streamText, type Message } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";

import { buildAgentOnchainTools } from "@/lib/agent-onchain-tools";
import { buildCommerceTools } from "@/lib/commerce/tools";
import { vault, SecretNotFound } from "@/lib/commerce/vault";

// child_process (ampersend CLI) + node:sqlite (audit log) require the Node runtime.
export const runtime = "nodejs";

const _tools = { ...buildAgentOnchainTools(), ...buildCommerceTools() };

const SHROUD_BASE_URL = "https://shroud.1claw.xyz/v1";
const DEFAULT_MODEL = "gpt-4o";

/**
 * Build the LLM provider. Prefers 1Claw Shroud (token-billed, no key needed)
 * if agent credentials are configured. Falls back to direct Anthropic with a
 * vault-stored key.
 */
async function getModel() {
  const agentId = (process.env.ONECLAW_AGENT_ID || "").trim();
  const agentApiKey = (process.env.ONECLAW_AGENT_API_KEY || "").trim();

  // Shroud path: agent credentials route LLM calls through 1Claw's proxy.
  // Token billing is handled by 1Claw — no LLM API key needed.
  if (agentId && agentApiKey) {
    const shroud = createOpenAI({
      baseURL: SHROUD_BASE_URL,
      apiKey: "unused",
      compatibility: "strict",
      headers: {
        "X-Shroud-Agent-Key": `${agentId}:${agentApiKey}`,
        "X-Shroud-Provider": "openai",
      },
    });
    return shroud(DEFAULT_MODEL);
  }

  // Fallback: direct Anthropic with a key from the vault.
  let key: string;
  try {
    const secret = await vault.read("llm-api-key");
    key = await secret.use((raw) => raw);
  } catch (e) {
    if (e instanceof SecretNotFound) {
      throw new Error(
        "No LLM credentials available. Either set ONECLAW_AGENT_ID + ONECLAW_AGENT_API_KEY " +
          "for Shroud token billing, or store an Anthropic key: just vault llm-api-key YOUR_KEY",
      );
    }
    throw e;
  }
  const provider = createAnthropic({ apiKey: key.trim() });
  return provider("claude-sonnet-4-6-20250217");
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

  let model;
  try {
    model = await getModel();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[api/chat] getModel:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  const result = streamText({
    model,
    system:
      "You are an onchain AI agent that can also place real commerce orders. " +
      "On-chain tools (list_deployed_contracts, contract_read) work against this repo's deployed contracts and RPC; prefer them over guessing addresses or ABIs. If oneclaw_intent_simulate / oneclaw_intent_submit are present they call 1Claw Intents (TEE signing; https://1claw.xyz/intents) — never submit high-value txs without explicit user confirmation. x402_paid_fetch calls APIs behind x402 paywalls. " +
      "COMMERCE: order_pizza (Domino's), book_flight (Duffel test), send_gift_card (Tremendous sandbox) each go through an Ampersend co-approval + policy + audit layer before any money moves; the agent's payment instrument (an Ampersend-issued prepaid card or a vault-stored Lasso card) is resolved server-side — you never see card numbers, keys, or vault values. " +
      "PRINTFUL TWO-PHASE FLOW: order_printful_mug (Phase 1) creates a draft order and issues a Lasso card via Ampersend. After it returns, show the user the masked card info (last 4 from the result), tell them to run `node scripts/with-secrets.mjs -- node scripts/show-lasso-card.mjs` in their terminal for full details, and instruct them to add the card at printful.com/dashboard/wallet (one-time step). Then WAIT — do NOT call confirm_printful_order until the user explicitly says they have added the card. confirm_printful_order (Phase 2) takes the orderId from Phase 1 and confirms the order for fulfillment. " +
      "Call get_spend_status to report the agent's limits, daily-remaining, balance, and recent payments. " +
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
