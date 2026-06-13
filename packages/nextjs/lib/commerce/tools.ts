/**
 * tools.ts — Vercel AI SDK tools that wrap the commerce layer.
 *
 * order_pizza / book_flight / send_gift_card each: get a price quote, run it
 * through policy.authorizeOrder (Ampersend co-approval + audit), place the
 * order via the vendor adapter, and record settlement. get_spend_status reports
 * the agent's Ampersend limits, daily-remaining, and recent payments.
 *
 * Tool I/O contains NO card fields, NO keys, NO vault values — only ids,
 * descriptions, amounts, instrument label + last4, and order refs.
 */
import { tool } from "ai";
import { z } from "zod";
import { authorizeOrder, recordSettlement } from "./policy";
import { vendors } from "./vendors";
import { getSpendConfig, getPayments, getAgentSnapshot } from "./ampersend";
import { PolicyDenied, type OrderResult, type VendorId } from "./types";

interface ToolOutcome {
  ok: boolean;
  decision: "approved" | "denied" | "error";
  reason?: string;
  instrument?: string;
  summary?: string;
  orderRef?: string;
  dryRun?: boolean;
  requestPreview?: unknown;
}

async function placeOrder(
  vendorId: VendorId,
  description: string,
  amountUsd: number,
  needsCard: boolean,
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  try {
    const { intentId, instrument } = await authorizeOrder(
      { vendorId, description, amountUsd, currency: "USD" },
      { needsCard },
    );
    let result: OrderResult;
    try {
      result = await vendors[vendorId].order(input, instrument);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      recordSettlement(intentId, { vendorId, submitted: false, summary: msg });
      return { ok: false, decision: "error", reason: msg, instrument: `${instrument.label} ••••${instrument.last4}` };
    }
    recordSettlement(intentId, result);
    return {
      ok: true,
      decision: "approved",
      instrument: `${instrument.label} ••••${instrument.last4}`,
      summary: result.summary,
      orderRef: result.orderRef,
      dryRun: result.dryRun,
      requestPreview: result.dryRun ? result.detail : undefined,
    };
  } catch (e) {
    if (e instanceof PolicyDenied) {
      return { ok: false, decision: "denied", reason: e.reason };
    }
    return { ok: false, decision: "error", reason: e instanceof Error ? e.message : String(e) };
  }
}

export function buildCommerceTools() {
  return {
    order_pizza: tool({
      description:
        "Order a medium pepperoni pizza from Domino's to the demo delivery address in .env. Goes through Ampersend co-approval and the policy/audit layer. Pays with the agent's payment instrument (Ampersend-issued or vault Lasso card). Defaults to a dry-run unless COMMERCE_DOMINO_LIVE=true.",
      parameters: z.object({
        note: z.string().optional().describe("Optional note (ignored by the order; for the audit log only)."),
      }),
      execute: async ({ note }) => {
        const quote = await vendors.domino.priceQuote();
        return placeOrder("domino", quote.description, quote.amountUsd, true, { note });
      },
    }),

    book_flight: tool({
      description:
        "Search and book the cheapest flight for the fixed demo route (set in .env) under the per-transaction cap, against Duffel's TEST environment (settles from test balance). Goes through Ampersend co-approval and the audit layer. Defaults to a dry-run unless COMMERCE_DUFFEL_LIVE=true.",
      parameters: z.object({
        maxUsd: z.number().optional().describe("Optional per-tx cap override in USD (also enforced by COMMERCE_DUFFEL_MAX_USD)."),
      }),
      execute: async ({ maxUsd }) => {
        const quote = await vendors.duffel.priceQuote();
        return placeOrder("duffel", quote.description, quote.amountUsd, false, { maxUsd });
      },
    }),

    send_gift_card: tool({
      description:
        "Send a $5 Amazon gift card to the demo recipient email in .env, against the Tremendous SANDBOX (funded from account balance, not a card). Goes through Ampersend co-approval and the audit layer. Defaults to a dry-run unless COMMERCE_TREMENDOUS_LIVE=true.",
      parameters: z.object({
        amountUsd: z.number().optional().describe("Optional gift card amount in USD (default from COMMERCE_GIFT_CARD_USD)."),
      }),
      execute: async ({ amountUsd }) => {
        const quote = await vendors.tremendous.priceQuote();
        const amt = amountUsd ?? quote.amountUsd;
        return placeOrder("tremendous", quote.description, amt, false, { amountUsd: amt });
      },
    }),

    get_spend_status: tool({
      description:
        "Report the agent's Ampersend spending status: per-transaction/daily/monthly limits, USD spent today, daily remaining, USDC balance, and recent payments. Read-only.",
      parameters: z.object({}),
      execute: async () => {
        const cfg = await getSpendConfig();
        const payments1d = await getPayments("1d");
        const snap = await getAgentSnapshot();
        const spentToday = payments1d.reduce((s, p) => s + p.amountUsd, 0);
        const daily = !("error" in cfg) ? cfg.dailyUsd : null;
        return {
          configured: !("error" in cfg),
          limits: "error" in cfg ? null : {
            perTransactionUsd: cfg.perTransactionUsd,
            dailyUsd: cfg.dailyUsd,
            monthlyUsd: cfg.monthlyUsd,
            autoTopup: cfg.autoTopup,
          },
          spentTodayUsd: Math.round(spentToday * 100) / 100,
          dailyRemainingUsd: daily != null ? Math.max(0, Math.round((daily - spentToday) * 100) / 100) : null,
          balanceUsd: !("error" in snap) ? snap.balanceUsd : null,
          recentPayments: payments1d.slice(0, 5),
          note: "error" in cfg ? cfg.error : undefined,
        };
      },
    }),
  };
}
