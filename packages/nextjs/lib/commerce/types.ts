/**
 * Shared types for the commerce layer.
 *
 * Design rule: nothing here that crosses into the LLM/tool boundary may carry a
 * raw card field, signing key, or vault value. Sensitive data only ever flows
 * through `PaymentInstrument.use(fn)` and the `Secret` wrapper in vault.ts.
 */

export type VendorId = "domino" | "duffel" | "tremendous";

export interface OrderIntent {
  vendorId: VendorId;
  /** Human-readable description of the purchase (logged + sent to Ampersend). */
  description: string;
  /** Order total in USD. Used for policy/limit enforcement. */
  amountUsd: number;
  currency: "USD";
  /** Free-form, non-sensitive metadata for the audit log. */
  metadata?: Record<string, string | number>;
}

/** Raw payment card fields — only ever exposed inside PaymentInstrument.use(). */
export interface CardFields {
  pan: string;
  exp: string; // MM/YY
  cvc: string;
  name: string;
  zip: string;
}

export type InstrumentKind = "ampersend-card" | "lasso-card" | "balance";

/**
 * Opaque payment handle returned by policy.ts after Ampersend co-approval.
 * The raw card fields are reachable only inside `use(fn)`; `last4`/`kind` are
 * the only details that may be logged or returned to the chat route.
 */
export interface PaymentInstrument {
  kind: InstrumentKind;
  /** Last 4 of the PAN (or "balance" for balance-funded instruments). */
  last4: string;
  /** Non-sensitive label, e.g. "Ampersend prepaid Visa". */
  label: string;
  /** Ampersend card_id / settlement reference, when applicable. */
  ref?: string;
  /**
   * Hand the raw card fields to `fn` for one charge. Throws for `balance`
   * instruments (which fund the vendor from an account balance, not a card).
   */
  use<R>(fn: (card: CardFields) => R | Promise<R>): Promise<R>;
}

export interface PriceQuote {
  vendorId: VendorId;
  description: string;
  amountUsd: number;
  currency: "USD";
  /** Vendor-specific, non-sensitive detail (e.g. flight offer id, store id). */
  detail?: Record<string, unknown>;
}

export interface OrderResult {
  vendorId: VendorId;
  /** True only if a real order was submitted to the vendor. */
  submitted: boolean;
  /** Vendor order/reference id, when submitted. */
  orderRef?: string;
  /** Short human summary, safe to show in chat. */
  summary: string;
  /** Non-sensitive structured detail for the audit log. */
  detail?: Record<string, unknown>;
  /** Set when COMMERCE_*_LIVE is off and the request was only previewed. */
  dryRun?: boolean;
}

/** Thrown when Ampersend (or local policy) refuses to authorize a purchase. */
export class PolicyDenied extends Error {
  constructor(
    public readonly reason: string,
    public readonly intentId?: number,
  ) {
    super(reason);
    this.name = "PolicyDenied";
  }
}

export interface VendorAdapter {
  id: VendorId;
  priceQuote(input?: Record<string, unknown>): Promise<PriceQuote>;
  order(
    input: Record<string, unknown>,
    instrument: PaymentInstrument,
  ): Promise<OrderResult>;
}
