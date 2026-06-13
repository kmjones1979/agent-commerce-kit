/**
 * duffel.ts — search flights for a fixed route and book the cheapest offer
 * under a per-tx cap, against Duffel's TEST environment.
 *
 * Duffel test orders settle from the test balance (payment type "balance"), so
 * no real card is charged — the PaymentInstrument is the policy-authorized
 * context (Tremendous/Duffel are balance-funded; Domino's is the card path).
 *
 * Default: dry-run (build request, don't submit). Set COMMERCE_DUFFEL_LIVE=true
 * to enable real calls against api.duffel.com with your TEST token.
 */
import { vault, SecretNotFound, type Secret } from "../vault";
import type { OrderResult, PaymentInstrument, PriceQuote, VendorAdapter } from "../types";

const DUFFEL_BASE = "https://api.duffel.com";
const DUFFEL_VERSION = "v2";

const ROUTE = {
  origin: process.env.COMMERCE_DUFFEL_ORIGIN || "JFK",
  destination: process.env.COMMERCE_DUFFEL_DESTINATION || "LAX",
  date: process.env.COMMERCE_DUFFEL_DATE || "2026-09-15",
  cabin: process.env.COMMERCE_DUFFEL_CABIN || "economy",
};
const MAX_USD = Number(process.env.COMMERCE_DUFFEL_MAX_USD || "500");

async function duffelKey(): Promise<Secret | null> {
  try {
    return await vault.read("commerce/vendors/duffel-api-key", "vendor:duffel");
  } catch (e) {
    if (e instanceof SecretNotFound) return null;
    throw e;
  }
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: "Bearer " + token,
    "Duffel-Version": DUFFEL_VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

interface DuffelOffer {
  id: string;
  total_amount: string;
  total_currency: string;
  owner?: { name?: string };
}

/** Create an offer request and return offers sorted cheapest-first (test env). */
async function searchOffers(token: string): Promise<DuffelOffer[]> {
  const reqRes = await fetch(DUFFEL_BASE + "/air/offer_requests?return_offers=true", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      data: {
        cabin_class: ROUTE.cabin,
        passengers: [{ type: "adult" }],
        slices: [
          { origin: ROUTE.origin, destination: ROUTE.destination, departure_date: ROUTE.date },
        ],
      },
    }),
  });
  if (!reqRes.ok) throw new Error(`Duffel offer_requests ${reqRes.status}: ${await reqRes.text()}`);
  const j = (await reqRes.json()) as { data?: { offers?: DuffelOffer[] } };
  const offers = j.data?.offers ?? [];
  return offers
    .slice()
    .sort((a, b) => Number(a.total_amount) - Number(b.total_amount));
}

export const duffel: VendorAdapter = {
  id: "duffel",

  async priceQuote(): Promise<PriceQuote> {
    const key = await duffelKey();
    if (key) {
      try {
        const offers = await key.use((t) => searchOffers(t));
        const cheapest = offers[0];
        if (cheapest) {
          return {
            vendorId: "duffel",
            description: `${ROUTE.origin}→${ROUTE.destination} ${ROUTE.date} (cheapest: ${cheapest.owner?.name ?? "?"})`,
            amountUsd: Number(cheapest.total_amount),
            currency: "USD",
            detail: { offerId: cheapest.id, currency: cheapest.total_currency, route: ROUTE, offers: offers.length },
          };
        }
      } catch (e) {
        return {
          vendorId: "duffel",
          description: `${ROUTE.origin}→${ROUTE.destination} ${ROUTE.date} (estimate — search failed)`,
          amountUsd: 250,
          currency: "USD",
          detail: { route: ROUTE, error: e instanceof Error ? e.message : String(e) },
        };
      }
    }
    return {
      vendorId: "duffel",
      description: `${ROUTE.origin}→${ROUTE.destination} ${ROUTE.date} (estimate — no Duffel key in vault)`,
      amountUsd: 250,
      currency: "USD",
      detail: { route: ROUTE },
    };
  },

  async order(_input, instrument: PaymentInstrument): Promise<OrderResult> {
    const live = (process.env.COMMERCE_DUFFEL_LIVE || "").toLowerCase() === "true";
    const key = await duffelKey();

    if (!live || !key) {
      const quote = await this.priceQuote();
      return {
        vendorId: "duffel",
        submitted: false,
        dryRun: true,
        summary: `DRY-RUN: would book cheapest ${ROUTE.origin}→${ROUTE.destination} on ${ROUTE.date} (~$${quote.amountUsd}, cap $${MAX_USD}) via Duffel TEST balance. Authorized instrument: ${instrument.label} ••••${instrument.last4}. Set COMMERCE_DUFFEL_LIVE=true (+ vault key) to book.`,
        detail: { request: { route: ROUTE, maxUsd: MAX_USD, payment: "balance" } },
      };
    }

    return key.use(async (token) => {
      const offers = await searchOffers(token);
      const cheapest = offers[0];
      if (!cheapest) return { vendorId: "duffel" as const, submitted: false, summary: "No Duffel offers returned for the route." };
      const total = Number(cheapest.total_amount);
      if (total > MAX_USD) {
        return {
          vendorId: "duffel" as const,
          submitted: false,
          summary: `Cheapest offer $${total} exceeds per-tx cap $${MAX_USD}; not booked.`,
          detail: { offerId: cheapest.id, total },
        };
      }
      const orderRes = await fetch(DUFFEL_BASE + "/air/orders", {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          data: {
            type: "instant",
            selected_offers: [cheapest.id],
            payments: [{ type: "balance", amount: cheapest.total_amount, currency: cheapest.total_currency }],
            passengers: [
              {
                phone_number: process.env.COMMERCE_DUFFEL_PHONE || "+14155550100",
                email: process.env.COMMERCE_RECIPIENT_EMAIL || "demo@example.com",
                born_on: "1990-01-01",
                title: "mr",
                gender: "m",
                family_name: process.env.COMMERCE_DUFFEL_FAMILY || "Demo",
                given_name: process.env.COMMERCE_DUFFEL_GIVEN || "Agent",
              },
            ],
          },
        }),
      });
      if (!orderRes.ok) {
        return {
          vendorId: "duffel" as const,
          submitted: false,
          summary: `Duffel order failed (${orderRes.status}).`,
          detail: { error: (await orderRes.text()).slice(0, 800) },
        };
      }
      const oj = (await orderRes.json()) as { data?: { id?: string; booking_reference?: string } };
      return {
        vendorId: "duffel" as const,
        submitted: true,
        orderRef: oj.data?.booking_reference || oj.data?.id,
        summary: `Booked ${ROUTE.origin}→${ROUTE.destination} for $${total} (Duffel TEST, ref ${oj.data?.booking_reference || oj.data?.id}).`,
        detail: { offerId: cheapest.id, total },
      };
    });
  },
};
