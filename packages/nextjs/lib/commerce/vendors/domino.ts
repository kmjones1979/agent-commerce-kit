/**
 * domino.ts — order a fixed pepperoni medium to an address in .env.
 *
 * IMPORTANT: Domino's has no sanctioned public ordering API. The popular
 * `dominos` npm package is an unofficial, reverse-engineered client. Per the
 * "no invented APIs" rule we do NOT call or guess a Domino's HTTP endpoint here.
 *
 * Default (COMMERCE_DOMINO_LIVE unset/false): build the order request and return
 * it as a dry-run — nothing is submitted. Setting COMMERCE_DOMINO_LIVE=true
 * intentionally throws, because wiring a real submission requires the user to
 * adopt the unofficial client against their own account (a manual, explicit
 * step), not anything this kit can do safely or with a documented API.
 */
import { vault, SecretNotFound } from "../vault";
import type { OrderResult, PaymentInstrument, PriceQuote, VendorAdapter } from "../types";

const PRICE = Number(process.env.COMMERCE_DOMINO_PRICE_USD || "13.99");

function deliveryAddress() {
  return {
    street: process.env.COMMERCE_DOMINO_STREET || "1 Demo Street",
    city: process.env.COMMERCE_DOMINO_CITY || "Brooklyn",
    region: process.env.COMMERCE_DOMINO_REGION || "NY",
    postalCode: process.env.COMMERCE_DOMINO_ZIP || "11211",
  };
}

async function accountBlob(): Promise<Record<string, unknown> | null> {
  try {
    const s = await vault.read("commerce/vendors/domino-account", "vendor:domino");
    return s.use((raw) => {
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return { note: "domino-account present (opaque)" };
      }
    });
  } catch (e) {
    if (e instanceof SecretNotFound) return null;
    throw e;
  }
}

export const domino: VendorAdapter = {
  id: "domino",

  async priceQuote(): Promise<PriceQuote> {
    return {
      vendorId: "domino",
      description: "Medium pepperoni pizza (Domino's)",
      amountUsd: PRICE,
      currency: "USD",
      detail: { item: "14SCREEN — Pepperoni", delivery: deliveryAddress() },
    };
  },

  async order(_input, instrument: PaymentInstrument): Promise<OrderResult> {
    const live = (process.env.COMMERCE_DOMINO_LIVE || "").toLowerCase() === "true";
    const acct = await accountBlob();

    // Build a representative order request (no real endpoint is contacted).
    const request = {
      store: process.env.COMMERCE_DOMINO_STORE_ID || "<nearest-store-by-address>",
      address: deliveryAddress(),
      products: [{ code: "14SCREEN", qty: 1, options: { P: { "1/1": "1" } } }], // pepperoni, whole
      payment: {
        type: "CreditCard",
        instrument: `${instrument.label} ••••${instrument.last4}`,
        // card fields are supplied at charge time via instrument.use(), never logged
      },
      account: acct ? "present" : "missing",
    };

    if (!live) {
      return {
        vendorId: "domino",
        submitted: false,
        dryRun: true,
        summary: `DRY-RUN: would order a medium pepperoni to ${deliveryAddress().street} and pay ${instrument.label} ••••${instrument.last4}. Set COMMERCE_DOMINO_LIVE=true to enable real ordering.`,
        detail: { request },
      };
    }

    // Live path intentionally not implemented against a guessed/unofficial API.
    throw new Error(
      "COMMERCE_DOMINO_LIVE=true but there is no sanctioned Domino's API. " +
        "Real ordering requires adopting the unofficial `dominos` npm client against your own account — " +
        "a manual step this kit will not perform with an undocumented API. Keep COMMERCE_DOMINO_LIVE unset for the demo.",
    );
  },
};
