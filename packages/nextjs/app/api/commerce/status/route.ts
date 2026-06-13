/**
 * GET /api/commerce/status — server-only status for the chat status strip.
 *
 * Returns the Ampersend account snapshot, spend limits + daily-remaining, the
 * active payment instrument (LAST 4 ONLY — the full PAN never leaves the
 * server), and the last few commerce transactions from the audit DB.
 */
import { vault, last4, SecretNotFound } from "@/lib/commerce/vault";
import { getSpendConfig, getPayments, getAgentSnapshot } from "@/lib/commerce/ampersend";
import { recentIntents } from "@/lib/commerce/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function instrumentSummary(): Promise<{ label: string; last4: string }> {
  const mode = (process.env.COMMERCE_PAYMENT_INSTRUMENT || "auto").toLowerCase();
  // Never issue a card here (that is a spend). Only read a vault Lasso card if present.
  if (mode !== "ampersend") {
    try {
      const pan = await vault.read("commerce/lasso/card-pan", "status:last4");
      return { label: "Lasso prepaid card (vault)", last4: await last4(pan) };
    } catch (e) {
      if (!(e instanceof SecretNotFound)) {
        // fall through to ampersend label on any vault error
      }
    }
  }
  return { label: "Ampersend prepaid Visa (minted per order)", last4: "—" };
}

export async function GET() {
  const [cfg, payments, snap, instrument] = await Promise.all([
    getSpendConfig(),
    getPayments("1d").catch(() => []),
    getAgentSnapshot(),
    instrumentSummary(),
  ]);

  const spentToday = payments.reduce((s, p) => s + p.amountUsd, 0);
  const limits = "error" in cfg ? null : cfg;
  const dailyRemaining =
    limits && limits.dailyUsd != null
      ? Math.max(0, Math.round((limits.dailyUsd - spentToday) * 100) / 100)
      : null;

  const tx = recentIntents(5).map((r) => ({
    id: r.id,
    ts: r.ts,
    vendor: r.vendor,
    description: r.description,
    amountUsd: r.amount_usd,
    decision: r.decision,
    settlement: r.settlement_status,
    last4: r.instrument_last4,
    orderRef: r.order_ref,
  }));

  return Response.json({
    ampersend: {
      configured: !("error" in cfg),
      balanceUsd: !("error" in snap) ? snap.balanceUsd : null,
      address: !("error" in snap) ? snap.address : null,
      limits: limits
        ? {
            perTransactionUsd: limits.perTransactionUsd,
            dailyUsd: limits.dailyUsd,
            monthlyUsd: limits.monthlyUsd,
          }
        : null,
      spentTodayUsd: Math.round(spentToday * 100) / 100,
      dailyRemainingUsd: dailyRemaining,
      note: "error" in cfg ? cfg.error : undefined,
    },
    instrument,
    transactions: tx,
  });
}
