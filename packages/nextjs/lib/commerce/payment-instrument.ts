/**
 * payment-instrument.ts — resolve the agent's current payment instrument.
 *
 * Resolution order (configurable via COMMERCE_PAYMENT_INSTRUMENT):
 *   1. "ampersend" — a per-order prepaid Visa minted via `ampersend card issue`
 *      (Laso under the hood). The issuance IS the policy-co-signed spend.
 *   2. "lasso"     — a user-provisioned Lasso card whose PAN/exp/CVC/name/zip
 *      live in the 1Claw vault at commerce/lasso/*.
 *   "auto" (default) tries ampersend, then falls back to lasso.
 *
 * Raw card fields are only ever exposed inside `PaymentInstrument.use(fn)`.
 * `last4`/`label`/`kind` are the only details that may be logged or returned to
 * the chat route.
 */
import { vault, Secret, last4 as secretLast4, SecretNotFound } from "./vault";
import { issueCard, waitForCard } from "./ampersend";
import type { CardFields, PaymentInstrument } from "./types";

const LASSO = {
  pan: "commerce/lasso/card-pan",
  exp: "commerce/lasso/card-exp",
  cvc: "commerce/lasso/card-cvc",
  name: "commerce/lasso/card-name",
  zip: "commerce/lasso/billing-zip",
};

function mode(): "auto" | "ampersend" | "lasso" {
  const m = (process.env.COMMERCE_PAYMENT_INSTRUMENT || "auto").toLowerCase();
  return m === "ampersend" || m === "lasso" ? m : "auto";
}

export class InstrumentError extends Error {}

/** A balance-funded "instrument" for vendors paid from an account balance. */
export function balanceInstrument(label: string): PaymentInstrument {
  return {
    kind: "balance",
    last4: "bal",
    label,
    use() {
      throw new InstrumentError(
        `${label} is funded from an account balance, not a card — use() is not available.`,
      );
    },
  };
}

/**
 * A non-spending placeholder used when no real instrument should be minted
 * (default for dry-runs). Charging through it throws, so it can never quietly
 * become a real spend.
 */
function previewInstrument(): PaymentInstrument {
  return {
    kind: "ampersend-card",
    last4: "----",
    label: "Ampersend card (preview — not minted)",
    use() {
      throw new InstrumentError(
        "Preview instrument: no card was minted. Set COMMERCE_ALLOW_CARD_ISSUE=true to mint a real " +
          "Ampersend card (a real spend), or seed a Lasso card in the vault (commerce/lasso/*).",
      );
    },
  };
}

/** Issuing an Ampersend card spends real money — require explicit opt-in. */
function cardIssueAllowed(): boolean {
  return (process.env.COMMERCE_ALLOW_CARD_ISSUE || "").toLowerCase() === "true";
}

async function ampersendCardInstrument(amountUsd: number): Promise<PaymentInstrument> {
  const issued = await issueCard(amountUsd);
  if ("error" in issued) {
    throw new InstrumentError(`Ampersend card issue failed: ${issued.error}`);
  }
  const ready = await waitForCard(issued.cardId);
  if ("error" in ready) {
    throw new InstrumentError(`Ampersend card not ready: ${ready.error}`);
  }
  const panSecret = new Secret(ready.pan, "ampersend-card-pan");
  const cvcSecret = new Secret(ready.cvv, "ampersend-card-cvc");
  const exp = ready.expiry;
  const name = process.env.COMMERCE_CARD_NAME || "Agent Commerce";
  const zip = process.env.COMMERCE_BILLING_ZIP || "";
  const l4 = await secretLast4(panSecret);

  return {
    kind: "ampersend-card",
    last4: l4,
    label: "Ampersend prepaid Visa",
    ref: issued.cardId,
    async use<R>(fn: (card: CardFields) => R | Promise<R>): Promise<R> {
      return panSecret.use((pan) =>
        cvcSecret.use((cvc) => fn({ pan, exp, cvc, name, zip })),
      ) as Promise<R>;
    },
  };
}

async function lassoCardInstrument(): Promise<PaymentInstrument> {
  let panSecret: Secret;
  try {
    panSecret = await vault.read(LASSO.pan, "payment:lasso-card");
  } catch (e) {
    if (e instanceof SecretNotFound) {
      throw new InstrumentError(
        "No Lasso card in the vault (commerce/lasso/card-pan). Seed it with scripts/seed-vault.sh.local.",
      );
    }
    throw e;
  }
  const [expSecret, cvcSecret, nameSecret, zipSecret] = await Promise.all([
    vault.read(LASSO.exp, "payment:lasso-card"),
    vault.read(LASSO.cvc, "payment:lasso-card"),
    vault.read(LASSO.name, "payment:lasso-card").catch(() => new Secret(process.env.COMMERCE_CARD_NAME || "Agent Commerce", "name")),
    vault.read(LASSO.zip, "payment:lasso-card").catch(() => new Secret(process.env.COMMERCE_BILLING_ZIP || "", "zip")),
  ]);
  const l4 = await secretLast4(panSecret);

  return {
    kind: "lasso-card",
    last4: l4,
    label: "Lasso prepaid card (vault)",
    async use<R>(fn: (card: CardFields) => R | Promise<R>): Promise<R> {
      return panSecret.use((pan) =>
        expSecret.use((exp) =>
          cvcSecret.use((cvc) =>
            nameSecret.use((name) =>
              zipSecret.use((zip) => fn({ pan, exp, cvc, name, zip })),
            ),
          ),
        ),
      ) as Promise<R>;
    },
  };
}

export interface ResolveOpts {
  amountUsd: number;
  /** If false, the vendor is balance-funded (e.g. Tremendous) and needs no card. */
  needsCard?: boolean;
}

/**
 * Resolve a PaymentInstrument. For card-issuing vendors this mints/loads the
 * card (the Ampersend path makes this a policy-co-signed spend). For
 * balance-funded vendors pass needsCard:false.
 */
export async function resolvePaymentInstrument(opts: ResolveOpts): Promise<PaymentInstrument> {
  if (opts.needsCard === false) {
    return balanceInstrument("Vendor account balance");
  }
  const m = mode();
  const mayIssue = cardIssueAllowed();

  if (m === "lasso") {
    return lassoCardInstrument();
  }

  if (m === "ampersend") {
    // Explicit ampersend mode: mint only if issuance is allowed, else preview.
    return mayIssue ? ampersendCardInstrument(opts.amountUsd) : previewInstrument();
  }

  // auto: prefer a vault Lasso card (no spend); only mint an Ampersend card when
  // explicitly allowed; otherwise return a non-spending preview instrument.
  try {
    return await lassoCardInstrument();
  } catch {
    if (mayIssue) return ampersendCardInstrument(opts.amountUsd);
    return previewInstrument();
  }
}
