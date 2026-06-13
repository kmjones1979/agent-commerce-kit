/**
 * tremendous.ts — send a $5 Amazon gift card to an email in .env, against the
 * Tremendous SANDBOX.
 *
 * Tremendous funds rewards from your account balance (via API key), so this is
 * a balance-funded vendor — no card is charged. Policy still gates it via the
 * Ampersend limit pre-check + audit record.
 *
 * Default: dry-run. Set COMMERCE_TREMENDOUS_LIVE=true (+ vault key + funding
 * source + product id) to send for real in the sandbox.
 */
import { vault, SecretNotFound, type Secret } from "../vault";
import type { OrderResult, PaymentInstrument, PriceQuote, VendorAdapter } from "../types";

const SANDBOX_BASE = process.env.TREMENDOUS_BASE_URL || "https://testflight.tremendous.com/api/v2";
const AMOUNT = Number(process.env.COMMERCE_GIFT_CARD_USD || "5");

async function tremendousKey(): Promise<Secret | null> {
  try {
    return await vault.read("commerce/vendors/tremendous-api-key", "vendor:tremendous");
  } catch (e) {
    if (e instanceof SecretNotFound) return null;
    throw e;
  }
}

function recipient() {
  return {
    name: process.env.COMMERCE_RECIPIENT_NAME || "Demo Recipient",
    email: process.env.COMMERCE_RECIPIENT_EMAIL || "demo@example.com",
  };
}

export const tremendous: VendorAdapter = {
  id: "tremendous",

  async priceQuote(): Promise<PriceQuote> {
    return {
      vendorId: "tremendous",
      description: `$${AMOUNT} Amazon gift card → ${recipient().email}`,
      amountUsd: AMOUNT,
      currency: "USD",
      detail: { recipient: recipient() },
    };
  },

  async order(_input, instrument: PaymentInstrument): Promise<OrderResult> {
    const live = (process.env.COMMERCE_TREMENDOUS_LIVE || "").toLowerCase() === "true";
    const key = await tremendousKey();
    const fundingSourceId = process.env.TREMENDOUS_FUNDING_SOURCE_ID || "";
    const productId = process.env.TREMENDOUS_PRODUCT_ID || ""; // Amazon product id in sandbox

    const body = {
      payment: { funding_source_id: fundingSourceId || "<TREMENDOUS_FUNDING_SOURCE_ID>" },
      rewards: [
        {
          value: { denomination: AMOUNT, currency_code: "USD" },
          delivery: { method: "EMAIL" },
          recipient: recipient(),
          products: productId ? [productId] : ["<TREMENDOUS_PRODUCT_ID (Amazon)>"],
        },
      ],
    };

    if (!live || !key || !fundingSourceId || !productId) {
      const missing = [
        !key && "vault key commerce/vendors/tremendous-api-key",
        !fundingSourceId && "TREMENDOUS_FUNDING_SOURCE_ID",
        !productId && "TREMENDOUS_PRODUCT_ID",
      ].filter(Boolean);
      return {
        vendorId: "tremendous",
        submitted: false,
        dryRun: true,
        summary:
          `DRY-RUN: would send a $${AMOUNT} Amazon gift card to ${recipient().email} via Tremendous SANDBOX ` +
          `(policy-authorized; ${instrument.label}). ` +
          (missing.length
            ? `Provide ${missing.join(", ")} and COMMERCE_TREMENDOUS_LIVE=true to send.`
            : `Set COMMERCE_TREMENDOUS_LIVE=true to send.`),
        detail: { request: body },
      };
    }

    return key.use(async (token) => {
      const res = await fetch(SANDBOX_BASE + "/orders", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        return {
          vendorId: "tremendous" as const,
          submitted: false,
          summary: `Tremendous sandbox order failed (${res.status}).`,
          detail: { error: (await res.text()).slice(0, 800) },
        };
      }
      const j = (await res.json()) as { order?: { id?: string } };
      return {
        vendorId: "tremendous" as const,
        submitted: true,
        orderRef: j.order?.id,
        summary: `Sent a $${AMOUNT} Amazon gift card to ${recipient().email} (Tremendous SANDBOX, order ${j.order?.id}).`,
        detail: { orderId: j.order?.id },
      };
    });
  },
};
