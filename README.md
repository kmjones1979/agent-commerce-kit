# Agent Commerce Kit

An onchain AI agent that places **real orders against public vendor APIs**, with
**stablecoin-funded payments**, **policy enforcement in front of every
transaction**, and **all secrets held in a 1Claw HSM vault — nothing sensitive on
disk, nothing sensitive in the LLM context**.

Scaffolded with [`scaffold-agent`](https://scaffoldagent.xyz); commerce layer
added on top. See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the sequence
diagram + trust model and **[DEMO.md](./DEMO.md)** for a 90-second script.

## The stack

- **[Scaffold-Agent](https://scaffoldagent.xyz)** — generated this monorepo:
  Next.js chat app, Foundry local chain, an onchain agent identity, and 1Claw as
  the secrets backend.
- **[1Claw](https://1claw.xyz)** — HSM vault holding the deployer/agent keys, the
  Ampersend agent secret, the Lasso card fields, and vendor API keys. The app
  reads secrets via the 1Claw REST API and wraps every value in an opaque
  `Secret` that redacts itself everywhere except a single `.use(fn)` scope.
- **[Ampersend](https://ampersend.ai)** — policy / co-approval / audit layer for
  agent payments (x402 on Base). Two-key model: the agent has one key, Ampersend
  has the other; both must sign, and Ampersend only co-signs within the limits
  you set in its dashboard. Also mints prepaid Visa cards (`ampersend card issue`).
- **[Lasso](https://laso.finance)** — crypto-to-Visa prepaid card rails behind
  Ampersend's card issuance. Cards are non-reloadable; the system checks existing
  card balance before issuing new cards.
- **[Printful](https://www.printful.com)** — print-on-demand vendor for custom
  mugs. The Lasso card is linked once in the Printful billing dashboard; after
  that, orders are fully automated via the API.

## Commerce layer

```
packages/nextjs/lib/commerce/
  vault.ts               opaque Secret<T> + 1Claw REST client (auth/read/write/list)
  ampersend.ts           drives the `ampersend` CLI; injects the agent secret JIT from the vault
  payment-instrument.ts  Ampersend-issued card → vault Lasso card reuse → new card fallback
  policy.ts              Ampersend co-approval gate + SQLite audit (commerce.db)
  db.ts                  node:sqlite audit log
  types.ts               PaymentInstrument, PolicyDenied, OrderIntent, …
  vendors/
    domino.ts            Domino's pizza
    duffel.ts            Duffel flights (test env)
    tremendous.ts        Tremendous gift cards (sandbox)
    printful.ts          Printful print-on-demand mugs (two-phase: draft + confirm)
  tools.ts               order_pizza / book_flight / send_gift_card /
                          order_printful_mug / confirm_printful_order / get_spend_status
packages/nextjs/app/
  api/chat/route.ts      commerce tools merged into the agent's tool set
  api/commerce/status/   server-only status (instrument LAST 4 only)
  commerce/  audit/  vault/   UI pages
scripts/
  bootstrap-commerce.mjs    seed Ampersend (+ optional Lasso) creds into the vault
  show-lasso-card.mjs       display Lasso card details (masked by default, reveal on confirm)
  seed-vault.sh.template    seed vendor + Lasso card creds (hidden prompts)
```

### Printful two-phase order flow

Printful's API does not accept card fields inline with an order. Instead, a
Lasso card is linked once in the Printful billing dashboard, and subsequent
orders are created and confirmed via the API.

1. **Phase 1 — `order_printful_mug`**: Ampersend issues a Lasso card (debiting
   the agent's USDC balance), stores it in the 1Claw vault, calls Printful's
   `/orders/estimate-costs` for the real total (including shipping/tax), and
   creates a draft order. The agent shows masked card info (last 4) and tells
   the user to run the reveal script and add the card to Printful billing.
2. **Phase 2 — `confirm_printful_order`**: After the user confirms they've added
   the card, the agent calls `POST /orders/{id}/confirm` to submit the order for
   fulfillment. Printful charges the linked card.

Card reuse: before issuing a new card, the system checks if a previously issued
card in the vault has sufficient balance. If so, it skips issuance entirely.

## Prerequisites

- Node.js ≥ 22 (uses the built-in `node:sqlite`), npm,
  [just](https://just.systems), [Foundry](https://book.getfoundry.sh).
- A 1Claw **human** API key (`1ck_…`) — kept **out of the repo**.
- An Ampersend agent (created at [app.ampersend.ai](https://app.ampersend.ai))
  with a funded USDC balance. The CLI is installed globally:
  `npm install -g @ampersend_ai/ampersend-sdk@latest` (needs ≥ 0.0.27).
- A Printful API token (from a "Manual order platform / API" store — not a
  "Quick store", which does not support API access).
- Optional: Duffel **test** key, Tremendous **sandbox** key, an Anthropic key
  for the chat LLM (or use 1Claw Shroud for token-billed LLM access).

## Run it locally

```bash
# 0) Install dependencies
npm install

# 1) Export your 1Claw human key (never committed to the repo)
export ONECLAW_API_KEY="1ck_your_key_here"

# 2) Bootstrap vault + agent (creates vault, stores keys, registers agent)
just bootstrap
# When prompted, enter your 1Claw API key and Ampersend signing key

# 3) Seed commerce credentials into the vault
just bootstrap-commerce        # Ampersend agent secret + optional Lasso key
just vault commerce/vendors/printful-api-token 'YOUR_PRINTFUL_TOKEN'

# 4) Configure .env
just env COMMERCE_PRINTFUL_LIVE true
just env PRINTFUL_STORE_ID 'YOUR_STORE_ID'           # from printful.com/dashboard/store
just env COMMERCE_ALLOW_CARD_ISSUE true
just env COMMERCE_PAYMENT_INSTRUMENT ampersend

# 5) Fund your Ampersend agent (~$20+ USDC for a mug order)
ampersend fund     # prints a URL to open in your browser

# 6) Set up the Ampersend CLI context
ampersend config set 'YOUR_SIGNING_KEY'

# 7) Bring it up
just chain                     # terminal A: local Anvil chain
just deploy                    # terminal B: deploy contracts + generate ABI types
just start                     # terminal C: Next.js app at http://localhost:3000
```

## Using the Printful integration

1. Open `http://localhost:3000` and ask the agent:
   *"Order me a black coffee mug with this image: https://example.com/photo.jpg"*
2. The agent will ask for your shipping address, then create a draft order and
   issue a Lasso card. It shows the masked card info (last 4 digits).
3. To see full card details, run in your terminal:
   ```bash
   node scripts/with-secrets.mjs -- node scripts/show-lasso-card.mjs
   ```
4. Add the card at [printful.com/dashboard/wallet](https://printful.com/dashboard/wallet)
   (one-time step).
5. Tell the agent: *"Card added, confirm the order."*
6. The agent confirms the draft and Printful charges the linked card.

For subsequent orders, if the existing card has sufficient balance, the agent
reuses it automatically — no new card issuance, no billing page update needed.

## Other commerce tools

- **`order_pizza`** — Domino's pepperoni pizza to the demo address.
  Dry-run unless `COMMERCE_DOMINO_LIVE=true`.
- **`book_flight`** — cheapest flight on the demo route via Duffel test env.
  Dry-run unless `COMMERCE_DUFFEL_LIVE=true`.
- **`send_gift_card`** — $5 Amazon gift card via Tremendous sandbox.
  Dry-run unless `COMMERCE_TREMENDOUS_LIVE=true`.
- **`get_spend_status`** — read-only report of Ampersend limits, daily remaining,
  balance, and recent payments.

## UI pages

- **`/`** — Chat with the agent. Status strip shows Ampersend account, daily
  remaining, active instrument (last 4), and recent transactions.
- **`/commerce`** — "Try it" buttons that seed chat prompts for each vendor.
- **`/vault`** — Shows every expected vault path green (populated) or red
  (missing). Values are never displayed.
- **`/audit`** — Full intent → approval → settlement timeline.

## Secrets policy

- Plain `.env` holds **only** public IDs (`ONECLAW_VAULT_ID`, `ONECLAW_AGENT_ID`,
  `DEPLOYER_ADDRESS`), RPC/network, vendor config flags, and demo recipient
  fields. No keys, no PAN, no CVC.
- The 1Claw **human** key (`ONECLAW_API_KEY`) is never committed. Export it in
  your shell or store it in `~/.secrets/1claw.env`.
- The Ampersend agent secret, Lasso card fields (PAN/exp/CVC/card-id), and
  vendor API keys live **only** in the 1Claw vault.
- The LLM never sees any vault value, card field, or signing key.

## Configuration reference (`.env`)

| Variable | Description |
|---|---|
| `COMMERCE_PAYMENT_INSTRUMENT` | `auto` (default), `ampersend`, or `lasso` |
| `COMMERCE_ALLOW_CARD_ISSUE` | `true` to enable real Ampersend card issuance |
| `COMMERCE_PRINTFUL_LIVE` | `true` to enable real Printful orders |
| `PRINTFUL_STORE_ID` | Your Printful store ID (from the dashboard URL) |
| `COMMERCE_DOMINO_LIVE` | `true` to enable real Domino's orders |
| `COMMERCE_DUFFEL_LIVE` | `true` to enable real Duffel bookings |
| `COMMERCE_TREMENDOUS_LIVE` | `true` to enable real Tremendous gift cards |
| `COMMERCE_PRINTFUL_PRICE_USD` | Fallback price if cost estimation fails (default `9.95`) |
| `COMMERCE_RECIPIENT_EMAIL` | Demo recipient email for gift cards |
| `AMPERSEND_NETWORK` / `AMPERSEND_API_URL` | Point at sandbox if needed |
