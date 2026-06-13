/**
 * policy.ts — the co-approval gate in front of every order.
 *
 * For each order intent it:
 *   1. records the intent in commerce.db (status: pending),
 *   2. reads the agent's Ampersend spend-config + today's spend and pre-checks
 *      the per-transaction and remaining-daily limits (fast, explicit denial),
 *   3. resolves a PaymentInstrument. With an Ampersend card this issuance is the
 *      policy-co-signed spend, so an over-limit order is rejected on-chain by
 *      Ampersend's CoSignerValidator too; with a vault Lasso card, Ampersend's
 *      limits act as the policy oracle + audit record.
 *   4. on approval returns the instrument + intentId; on denial records the
 *      denial and throws a typed PolicyDenied (no retry).
 *
 * Sensitive data never crosses this boundary: callers get an opaque
 * PaymentInstrument and an integer intentId.
 */
import { recordIntent, setDecision, setSettlement } from "./db";
import { getSpendConfig, getPayments } from "./ampersend";
import { resolvePaymentInstrument } from "./payment-instrument";
import { PolicyDenied, type OrderIntent, type OrderResult, type PaymentInstrument } from "./types";

export interface Authorization {
  intentId: number;
  instrument: PaymentInstrument;
}

export interface AuthorizeOpts {
  /** false for balance-funded vendors (Tremendous) that need no card. */
  needsCard?: boolean;
}

export async function authorizeOrder(
  intent: OrderIntent,
  opts: AuthorizeOpts = {},
): Promise<Authorization> {
  const intentId = recordIntent({
    vendor: intent.vendorId,
    description: intent.description,
    amountUsd: intent.amountUsd,
    currency: intent.currency,
  });

  // 1) Limit pre-check against Ampersend spend-config (best-effort; the server
  //    co-sign is still authoritative for Ampersend-card spends).
  const cfg = await getSpendConfig();
  if (!("error" in cfg)) {
    if (cfg.perTransactionUsd != null && intent.amountUsd > cfg.perTransactionUsd) {
      const reason = `Per-transaction limit $${cfg.perTransactionUsd} < order $${intent.amountUsd}`;
      setDecision(intentId, "denied", { reason });
      throw new PolicyDenied(reason, intentId);
    }
    if (cfg.dailyUsd != null) {
      const spentToday = (await getPayments("1d")).reduce((s, p) => s + p.amountUsd, 0);
      const remaining = Math.max(0, cfg.dailyUsd - spentToday);
      if (intent.amountUsd > remaining) {
        const reason = `Daily limit reached: $${remaining.toFixed(2)} remaining today, order is $${intent.amountUsd}`;
        setDecision(intentId, "denied", { reason });
        throw new PolicyDenied(reason, intentId);
      }
    }
  }

  // 2) Resolve the instrument (Ampersend card issuance co-signs the spend).
  let instrument: PaymentInstrument;
  try {
    instrument = await resolvePaymentInstrument({
      amountUsd: intent.amountUsd,
      needsCard: opts.needsCard,
    });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    // A co-sign rejection from Ampersend surfaces here as an issuance failure.
    setDecision(intentId, "denied", { reason });
    throw new PolicyDenied(reason, intentId);
  }

  setDecision(intentId, "approved", {
    instrumentKind: instrument.kind,
    instrumentLast4: instrument.last4,
  });
  return { intentId, instrument };
}

/** Record the vendor settlement outcome against an approved intent. */
export function recordSettlement(intentId: number, result: OrderResult): void {
  setSettlement(intentId, result.dryRun ? "dry-run" : result.submitted ? "submitted" : "failed", {
    orderRef: result.orderRef,
    detail: result.detail,
  });
}
