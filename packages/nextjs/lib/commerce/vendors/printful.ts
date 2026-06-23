/**
 * printful.ts — order a glossy mug (11 oz, white or black) with a custom image
 * from the Printful print-on-demand API.
 *
 * Two-phase flow:
 *   Phase 1 — order() (called by `order_printful_mug` tool):
 *     1. Ampersend policy gates the order (daily/per-tx limits + co-approval).
 *     2. Ampersend issues a Lasso prepaid Visa card (debits the agent's USDC
 *        balance — this is the spend that shows in the Ampersend dashboard).
 *     3. Card details are stored in the 1Claw vault (commerce/lasso/card-*).
 *     4. A draft order is created on Printful (NOT confirmed yet).
 *     5. The agent shows masked card info and instructs the user to add the
 *        card at printful.com/dashboard/wallet, then ask to confirm.
 *
 *   Phase 2 — confirmOrder() (called by `confirm_printful_order` tool):
 *     1. User has added the Lasso card to Printful billing (one-time step).
 *     2. Agent calls POST /orders/{id}/confirm to submit for fulfillment.
 *     3. Printful charges the linked Lasso card.
 *
 * Full (unmasked) card details: run
 *   node scripts/with-secrets.mjs -- node scripts/show-lasso-card.mjs
 *
 * Catalog reference:
 *   Product ID 19  — White Glossy Mug   (variant 1320 = 11 oz, 4830 = 15 oz)
 *   Product ID 300 — Black Glossy Mug   (variant 9323 = 11 oz, 9324 = 15 oz)
 */
import { vault, SecretNotFound, type Secret } from "../vault";
import type { OrderResult, PaymentInstrument, PriceQuote, VendorAdapter } from "../types";

const BASE_URL = process.env.PRINTFUL_BASE_URL || "https://api.printful.com";
const FALLBACK_PRICE = Number(process.env.COMMERCE_PRINTFUL_PRICE_USD || "9.95");
const MUG_VARIANTS: Record<string, { id: number; label: string }> = {
  white: { id: Number(process.env.PRINTFUL_MUG_WHITE_VARIANT_ID || "1320"), label: "White Glossy Mug 11 oz" },
  black: { id: Number(process.env.PRINTFUL_MUG_BLACK_VARIANT_ID || "9323"), label: "Black Glossy Mug 11 oz" },
};
const STORE_ID = process.env.PRINTFUL_STORE_ID || "";

async function resolveStoreId(bearerToken: string): Promise<string> {
  if (STORE_ID) return STORE_ID;
  const res = await fetch(`${BASE_URL}/stores`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  if (!res.ok) throw new Error(`Printful /stores failed (${res.status})`);
  const j = (await res.json()) as { result?: Array<{ id?: number }> };
  const first = j.result?.[0]?.id;
  if (!first) throw new Error("No Printful stores found — create one at printful.com/dashboard/store");
  return String(first);
}

function recipientAddress(input?: Record<string, unknown>) {
  return {
    name: str(input?.recipientName) || process.env.COMMERCE_PRINTFUL_RECIPIENT_NAME || "",
    address1: str(input?.address1) || process.env.COMMERCE_PRINTFUL_ADDRESS1 || "",
    city: str(input?.city) || process.env.COMMERCE_PRINTFUL_CITY || "",
    state_code: str(input?.stateCode) || process.env.COMMERCE_PRINTFUL_STATE || "",
    country_code: str(input?.countryCode) || process.env.COMMERCE_PRINTFUL_COUNTRY || "US",
    zip: str(input?.zip) || process.env.COMMERCE_PRINTFUL_ZIP || "",
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function imageUrl(input?: Record<string, unknown>): string {
  if (input?.imageUrl && typeof input.imageUrl === "string") return input.imageUrl;
  return (
    process.env.COMMERCE_PRINTFUL_IMAGE_URL ||
    "https://files.cdn.printful.com/files/ea4/ea44330b887dfec278dbc4626a759547_thumb.png"
  );
}

function resolveVariant(input?: Record<string, unknown>) {
  const color = (typeof input?.color === "string" ? input.color : "").toLowerCase();
  if (color && color in MUG_VARIANTS) return MUG_VARIANTS[color];
  if (color.includes("black")) return MUG_VARIANTS.black;
  return MUG_VARIANTS[process.env.PRINTFUL_MUG_DEFAULT_COLOR?.toLowerCase() || "white"];
}

async function printfulToken(): Promise<Secret | null> {
  try {
    return await vault.read("commerce/vendors/printful-api-token", "vendor:printful");
  } catch (e) {
    if (e instanceof SecretNotFound) return null;
    throw e;
  }
}

export const printful: VendorAdapter = {
  id: "printful",

  async priceQuote(input?: Record<string, unknown>): Promise<PriceQuote> {
    const img = imageUrl(input);
    const variant = resolveVariant(input);
    const recipient = recipientAddress(input);

    let amountUsd = FALLBACK_PRICE;

    const token = await printfulToken();
    if (token && recipient.address1 && recipient.city && recipient.zip) {
      try {
        amountUsd = await token.use(async (bearerToken) => {
          const storeId = await resolveStoreId(bearerToken);
          const res = await fetch(`${BASE_URL}/orders/estimate-costs`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${bearerToken}`,
              "Content-Type": "application/json",
              "X-PF-Store-Id": storeId,
            },
            body: JSON.stringify({
              recipient,
              items: [{
                variant_id: variant.id,
                quantity: 1,
                files: [{ type: "default", url: img }],
              }],
            }),
          });
          if (!res.ok) return FALLBACK_PRICE;
          const j = (await res.json()) as {
            result?: { costs?: { total?: number | string } };
          };
          const total = Number(j.result?.costs?.total);
          return total > 0 ? total : FALLBACK_PRICE;
        });
      } catch {
        // Fall back to hardcoded price if estimation fails.
      }
    }

    return {
      vendorId: "printful",
      description: `${variant.label} with custom print`,
      amountUsd,
      currency: "USD",
      detail: {
        product: variant.label,
        variantId: variant.id,
        imageUrl: img,
        estimatedTotal: amountUsd,
        recipient,
      },
    };
  },

  async order(input, instrument: PaymentInstrument): Promise<OrderResult> {
    const live = (process.env.COMMERCE_PRINTFUL_LIVE || "").toLowerCase() === "true";
    const token = await printfulToken();
    const img = imageUrl(input);
    const recipient = recipientAddress(input);
    const variant = resolveVariant(input);

    const missing = [
      !recipient.name && "recipientName",
      !recipient.address1 && "address1",
      !recipient.city && "city",
      !recipient.zip && "zip",
    ].filter(Boolean);
    if (missing.length) {
      return {
        vendorId: "printful",
        submitted: false,
        summary:
          `Missing shipping address fields: ${missing.join(", ")}. ` +
          `Please ask the user for their full shipping address before ordering.`,
        detail: { missingFields: missing },
      };
    }

    const orderBody = {
      recipient,
      items: [
        {
          variant_id: variant.id,
          quantity: 1,
          files: [
            {
              type: "default" as const,
              url: img,
            },
          ],
        },
      ],
    };

    if (!live || !token) {
      const missing = [
        !token && "vault key commerce/vendors/printful-api-token",
      ].filter(Boolean);
      return {
        vendorId: "printful",
        submitted: false,
        dryRun: true,
        summary:
          `DRY-RUN: would order a ${variant.label} with image "${img}" ` +
          `shipped to ${recipient.name} at ${recipient.address1}, ${recipient.city} ` +
          `(policy-authorized; ${instrument.label}). ` +
          (missing.length
            ? `Provide ${missing.join(", ")} and COMMERCE_PRINTFUL_LIVE=true to create a real draft order.`
            : `Set COMMERCE_PRINTFUL_LIVE=true to create a real draft order.`),
        detail: { request: orderBody },
      };
    }

    // Store the Ampersend-issued card in the 1Claw vault so it persists as the
    // Lasso card that Printful charges. Only writes if the instrument has card
    // fields (Ampersend-issued or Lasso); balance instruments skip this.
    if (instrument.kind !== "balance") {
      try {
        await instrument.use(async (card) => {
          await vault.write("commerce/lasso/card-pan", card.pan, "card_pan");
          await vault.write("commerce/lasso/card-exp", card.exp, "card_exp");
          await vault.write("commerce/lasso/card-cvc", card.cvc, "card_cvc");
          if (card.name) await vault.write("commerce/lasso/card-name", card.name, "generic");
          if (card.zip) await vault.write("commerce/lasso/billing-zip", card.zip, "generic");
        });
        if (instrument.ref) {
          await vault.write("commerce/lasso/card-id", instrument.ref, "generic");
        }
      } catch {
        // Non-fatal: card fields may already be in the vault from a prior order.
      }
    }

    return token.use(async (bearerToken) => {
      const storeId = await resolveStoreId(bearerToken);
      const res = await fetch(`${BASE_URL}/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/json",
          "X-PF-Store-Id": storeId,
        },
        body: JSON.stringify(orderBody),
      });

      if (!res.ok) {
        const errText = (await res.text()).slice(0, 800);
        return {
          vendorId: "printful" as const,
          submitted: false,
          summary: `Printful order failed (${res.status}): ${errText}`,
          detail: { error: errText, request: orderBody },
        };
      }

      const j = (await res.json()) as {
        code?: number;
        result?: { id?: number; status?: string; costs?: { total?: string } };
      };
      const orderId = j.result?.id;
      const total = j.result?.costs?.total;

      if (!orderId) {
        return {
          vendorId: "printful" as const,
          submitted: false,
          summary: "Printful draft created but returned no order ID.",
          detail: { response: j },
        };
      }

      const reused = instrument.kind === "lasso-card";
      const cardNote = reused
        ? `Reusing existing card ••••${instrument.last4} (sufficient balance). ` +
          `If this card is already linked in Printful billing, you can confirm the order now.`
        : `New card issued: ${instrument.label} ••••${instrument.last4}. ` +
          `Card details stored in the vault. ` +
          `To see full card details, run: node scripts/with-secrets.mjs -- node scripts/show-lasso-card.mjs\n` +
          `You MUST update the card at printful.com/dashboard/wallet before confirming (Printful charges one card for the full total).`;

      return {
        vendorId: "printful" as const,
        submitted: false,
        orderRef: String(orderId),
        summary:
          `Printful draft order #${orderId} created for a ${variant.label} ` +
          `with custom image, shipping to ${recipient.name}` +
          (total ? ` (estimated total: $${total})` : "") +
          `. ${cardNote}`,
        detail: { orderId, status: j.result?.status, costs: j.result?.costs, cardReused: reused },
      };
    });
  },
};

/**
 * Confirm a previously created Printful draft order. Called by the
 * `confirm_printful_order` tool after the user has added the Lasso card
 * to Printful's billing page.
 */
export async function confirmPrintfulOrder(orderId: string): Promise<OrderResult> {
  const token = await printfulToken();
  if (!token) {
    return {
      vendorId: "printful",
      submitted: false,
      orderRef: orderId,
      summary: "Cannot confirm: no Printful API token in the vault (commerce/vendors/printful-api-token).",
    };
  }

  return token.use(async (bearerToken) => {
    const storeId = await resolveStoreId(bearerToken);
    const confirmRes = await fetch(`${BASE_URL}/orders/${orderId}/confirm`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        "X-PF-Store-Id": storeId,
      },
    });

    if (!confirmRes.ok) {
      const errText = (await confirmRes.text()).slice(0, 800);
      return {
        vendorId: "printful" as const,
        submitted: false,
        orderRef: orderId,
        summary:
          `Printful order #${orderId} confirmation failed (${confirmRes.status}): ${errText}. ` +
          `Make sure the Lasso card has been added at printful.com/dashboard/wallet.`,
        detail: { orderId, confirmError: errText },
      };
    }

    const confirmed = (await confirmRes.json()) as {
      code?: number;
      result?: { id?: number; status?: string; costs?: { total?: string } };
    };
    const confirmedTotal = confirmed.result?.costs?.total;

    return {
      vendorId: "printful" as const,
      submitted: true,
      orderRef: orderId,
      summary:
        `Printful order #${orderId} confirmed and submitted for fulfillment` +
        (confirmedTotal ? ` (total: $${confirmedTotal})` : "") +
        `. The order is now being produced and will ship to the address on file.`,
      detail: { orderId, status: confirmed.result?.status, costs: confirmed.result?.costs },
    };
  });
}
