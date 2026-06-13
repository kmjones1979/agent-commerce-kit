# Agent Commerce Kit

An onchain AI agent that places **real orders against public vendor APIs**, with
**stablecoin-funded payments**, **policy enforcement in front of every
transaction**, and **all secrets held in a 1Claw HSM vault — nothing sensitive on
disk, nothing sensitive in the LLM context**.

Scaffolded with [`scaffold-agent`](https://scaffoldagent.xyz); commerce layer
added on top. See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the sequence
diagram + trust model and **[DEMO.md](./DEMO.md)** for a 90-second script.

## The four pieces

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
- **[Lasso](https://laso.finance)** — crypto→Visa prepaid card. **It has no public
  card-issuance API** (consumer mobile product only — verified), so it is used
  (a) implicitly, *as the rails behind Ampersend's card issuance*, and (b)
  explicitly, as a user-provisioned card whose PAN/exp/CVC you store in the vault
  (the fallback instrument).

## What got built on top of the scaffold

```
packages/nextjs/lib/commerce/
  vault.ts               opaque Secret<T> + 1Claw REST client (auth/read/write/list)
  ampersend.ts           drives the `ampersend` CLI; injects the agent secret JIT from the vault
  payment-instrument.ts  Ampersend-issued card → vault Lasso card fallback
  policy.ts              Ampersend co-approval gate + SQLite audit (commerce.db)
  db.ts                  node:sqlite audit log
  types.ts               PaymentInstrument, PolicyDenied, OrderIntent, …
  vendors/{domino,duffel,tremendous}.ts
  tools.ts               order_pizza / book_flight / send_gift_card / get_spend_status
packages/nextjs/app/
  api/chat/route.ts      commerce tools merged into the agent's tool set
  api/commerce/status/   server-only status (instrument LAST 4 only)
  commerce/  audit/  vault/   UI pages
scripts/
  bootstrap-commerce.mjs    seed Ampersend (+ optional Lasso) creds into the vault
  seed-vault.sh.template    seed vendor + Lasso card creds (hidden prompts)
```

## Prerequisites

- Node.js ≥ 22 (uses the built-in `node:sqlite`), [just](https://just.systems),
  [Foundry](https://book.getfoundry.sh).
- A 1Claw **human** API key (`1ck_…`) — kept **out of the repo**, in
  `~/.secrets/1claw.env` as `ONE_CLAW_API_KEY`.
- An Ampersend agent (created in your browser at app.ampersend.ai) and a small
  funded balance. The CLI is installed globally:
  `npm install -g @ampersend_ai/ampersend-sdk@latest` (needs ≥ 0.0.27).
- Optional: Duffel **test** key, Tremendous **sandbox** key, a Lasso card, an
  Anthropic key for the chat LLM.

## Run it locally

```bash
# 0) 1Claw human key out-of-band (never committed)
mkdir -p ~/.secrets
printf 'ONE_CLAW_API_KEY=%s\n' '1ck_your_key' > ~/.secrets/1claw.env && chmod 600 ~/.secrets/1claw.env
source ~/.secrets/1claw.env && export ONECLAW_API_KEY="$ONE_CLAW_API_KEY"

# 1) Vault + agent (already done if ONECLAW_VAULT_ID is set in .env)
just reset -- --yes            # creates the vault, stores keys, registers the agent

# 2) Seed commerce credentials into the vault
just bootstrap-commerce        # prompts (hidden) for the Ampersend agent secret + optional Lasso key
just vault llm-api-key 'sk-ant-…'        # Anthropic key for the chat route
cp scripts/seed-vault.sh.template scripts/seed-vault.sh.local
bash scripts/seed-vault.sh.local         # vendor keys + (optional) Lasso card fields — hidden prompts
#  ⚠ after running, clear shell history if you typed any secret on a command line:
#     history -c   (the seed/bootstrap scripts use `read -s`/env so values stay out of history)

# 3) Bring it up (local Foundry only — no public network, no auto-funding)
just chain                     # terminal A: local Anvil chain
just deploy                    # terminal B: deploy contracts + ABI types
just start                     # terminal B: Next.js app at http://localhost:3000
```

Then:
- the **status strip** on the chat page shows the Ampersend account, daily
  remaining, the active instrument (last-4), and recent transactions;
- **/vault** shows every expected vault path green (populated) or red (missing) —
  values are never displayed;
- **/commerce** has "Try it" buttons that seed chat prompts;
- **/audit** shows the full intent → approval → settlement timeline.

Send **"order me a pepperoni pizza"** and approve in the Ampersend app when
prompted. By default it's a **dry-run** (prints the request); flip
`COMMERCE_DOMINO_LIVE` / `COMMERCE_DUFFEL_LIVE` / `COMMERCE_TREMENDOUS_LIVE` in
`.env` to enable real (sandbox/test) ordering.

## Secrets policy

- Plain `.env` holds **only** public IDs (`ONECLAW_VAULT_ID`, `ONECLAW_AGENT_ID`,
  `DEPLOYER_ADDRESS`, `AGENT_ADDRESS`), RPC/network, vendor **sandbox** config,
  and demo recipient fields. No keys, no PAN, no CVC.
- The 1Claw **human** key is never in the repo. It lives in `~/.secrets/1claw.env`
  and, AES-encrypted + gitignored, in `.env.secrets.encrypted` (decrypted into the
  server env only at `just start`).
- The Ampersend agent secret, Lasso card fields, and vendor keys live **only** in
  the 1Claw vault.
- The LLM never sees any vault value, card field, or signing key.

## Configuration knobs (`.env`)

`COMMERCE_PAYMENT_INSTRUMENT` (`auto`|`ampersend`|`lasso`),
`COMMERCE_RECIPIENT_EMAIL`/`_NAME`, `COMMERCE_GIFT_CARD_USD`,
`COMMERCE_DOMINO_*` (delivery address + price), `COMMERCE_DUFFEL_*` (route + cap),
`COMMERCE_*_LIVE` flags, and `AMPERSEND_NETWORK` / `AMPERSEND_API_URL`
(point at `https://api.sandbox.ampersend.ai` to use the sandbox).
