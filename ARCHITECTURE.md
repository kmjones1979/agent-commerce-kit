# Architecture

The Agent Commerce Kit lets an onchain AI agent place real orders against public
vendor APIs, with **policy enforcement in front of every transaction** and **all
secrets held in a 1Claw HSM vault — nothing sensitive on disk and nothing
sensitive in the LLM context**.

Four pieces, stitched together:

| Piece | Role |
|---|---|
| **Scaffold-Agent** | Generated the monorepo: Next.js app, Foundry chain, agent identity, the chat route, and 1Claw as the secrets backend. |
| **1Claw** | HSM vault. Holds the deployer/agent keys, the Ampersend agent secret, the Lasso card fields, and vendor API keys. |
| **Ampersend** | Policy / co-approval / audit layer for agent payments. Two-key model: the agent holds one key, Ampersend holds the other; both must sign. Also issues prepaid Visa cards (`ampersend card issue`). |
| **Lasso** | Consumer crypto→Visa prepaid card. **No public card-issuance API** (confirmed), so it is used two ways: (a) implicitly, *as the rails behind Ampersend's `card issue`*; (b) explicitly, as a user-provisioned card whose PAN/exp/CVC live in the vault (fallback instrument). |

## Order flow

```mermaid
sequenceDiagram
    actor User
    participant UI as Chat UI (/)
    participant Chat as /api/chat (LLM + tools)
    participant Tool as commerce tool<br/>(order_pizza / book_flight / send_gift_card)
    participant Policy as policy.ts
    participant Amp as Ampersend (service + CLI)
    participant PI as payment-instrument.ts
    participant Vault as 1Claw vault
    participant Adapter as vendor adapter
    participant Vendor as Vendor API<br/>(Domino's / Duffel test / Tremendous sandbox)
    participant DB as commerce.db (audit)

    User->>UI: "order me a pepperoni pizza"
    UI->>Chat: messages
    Chat->>Tool: tool call (no secrets in args)
    Tool->>Policy: authorizeOrder({vendor, amount, desc})
    Policy->>DB: record intent (pending)
    Policy->>Amp: agent spend-config + payments (limit pre-check)
    alt over per-tx / daily limit
        Amp-->>Policy: limits
        Policy->>DB: decision = denied (reason)
        Policy-->>Tool: throw PolicyDenied
        Tool-->>Chat: { decision: "denied", reason }
        Chat-->>User: explains denial, no retry
    else within limits
        Policy->>PI: resolvePaymentInstrument(amount)
        PI->>Amp: card issue --amount (co-signed spend)  %% Ampersend-card path
        Amp-->>PI: card_id  (Ampersend + agent both sign)
        PI->>Vault: read commerce/lasso/* (fallback path)
        Vault-->>PI: Secret&lt;…&gt; (opaque)
        PI-->>Policy: PaymentInstrument (last4 only)
        Policy->>DB: decision = approved (instrument last4)
        Policy-->>Tool: { intentId, instrument }
        Tool->>Adapter: order(input, instrument)
        Adapter->>Vault: read vendor API key (Secret)
        Adapter->>Vendor: place order (instrument.use(card => charge))
        Vendor-->>Adapter: order ref / receipt
        Adapter-->>Tool: OrderResult (summary, ref — no card data)
        Tool->>DB: record settlement (submitted / dry-run)
        Tool-->>Chat: { decision: "approved", summary, orderRef }
        Chat-->>User: "ordered — ref …"
    end
```

## Trust model

- **Money** lives in the user's own Ampersend smart account on Base. Spending it
  needs **two signatures** — the agent's key *and* Ampersend's, where Ampersend
  only co-signs if the payment is within the user's dashboard-set limits
  (per-transaction / daily / monthly). Neither the agent nor Ampersend can spend
  alone. The user funds and sets limits in their **own browser** at
  app.ampersend.ai — never a session the agent controls.
- **Signing keys and card PAN** live in the **1Claw HSM vault**. The Ampersend
  agent secret (`commerce/ampersend/agent-key`) is read from the vault and
  injected into the `ampersend` CLI's environment for exactly one invocation,
  then dropped — never written to `.env`, an rc file, or disk. The Lasso card
  fields (`commerce/lasso/*`) and vendor API keys (`commerce/vendors/*`) are read
  the same way.
- **The agent process holds neither across requests.** Secrets are fetched
  per-call through `vault.read()`, used inside a single `Secret.use(fn)` /
  `PaymentInstrument.use(fn)` scope, and the backing buffer is held only as long
  as needed (and can be `destroy()`-ed). Card data minted by Ampersend is masked
  unless explicitly revealed, and is never written to disk.
- **The LLM sees none of it.** Tool inputs and outputs carry only vendor ids,
  descriptions, amounts, an instrument **label + last-4**, order refs, and
  decisions. The `Secret` wrapper redacts on `console.log`, `JSON.stringify`,
  `String()`, and `util.inspect`, and never returns a raw string — so a vault
  value cannot accidentally be serialized into a model prompt or a log line.

## The two payment-instrument paths

`COMMERCE_PAYMENT_INSTRUMENT` selects how a card is resolved:

- **`ampersend`** — `payment-instrument.ts` calls `ampersend card issue --amount <total>`.
  That issuance **is** the policy-co-signed spend (Ampersend + agent both sign,
  the on-chain `CoSignerValidator` enforces limits), and yields a real prepaid
  Visa (Laso under the hood). The card is polled until `ready` and its PAN/CVV
  are wrapped in `Secret`s. Requires a funded Ampersend account; card issuance is
  US-IP only.
- **`lasso`** — read a user-provisioned card from `commerce/lasso/*` in the vault.
  Here Ampersend acts as the **policy oracle + audit record** (limit pre-check),
  while the card is the actual instrument.
- **`auto`** (default) — try Ampersend issuance, fall back to the vault Lasso card.

Balance-funded vendors (Tremendous draws from its account balance; Duffel **test**
settles from test balance) need no card — the policy gate is the Ampersend limit
pre-check plus the audit record.

## Why some vendors are dry-run by default

`order_pizza`, `book_flight`, and `send_gift_card` default to a **dry-run** that
builds and returns the request without submitting it. Real submission is behind
per-vendor flags (`COMMERCE_DOMINO_LIVE`, `COMMERCE_DUFFEL_LIVE`,
`COMMERCE_TREMENDOUS_LIVE`). Duffel and Tremendous run only against their
**test/sandbox** environments. **Domino's has no sanctioned public API** — the
popular `dominos` npm package is unofficial/reverse-engineered — so live Domino's
ordering intentionally throws rather than calling a guessed endpoint; the demo
runs Domino's as a dry-run that shows the constructed order + chosen instrument.

## Where each secret lives

| Vault path | What | Seeded by |
|---|---|---|
| `private-keys/deployer` | Foundry deployer key | scaffold / `just reset` |
| `private-keys/agent` | Agent EVM identity key | scaffold / `just reset` |
| `llm-api-key` | Anthropic key for the chat route | you (`just vault llm-api-key …`) |
| `commerce/ampersend/agent-key` | Ampersend agent secret (`key:::account`) | `just bootstrap-commerce` |
| `private-keys/ampersend-signing` | 0x signing key for the SDK x402 path | `just bootstrap-commerce` (derived) |
| `commerce/lasso/card-pan` … `billing-zip` | User-provisioned Lasso card fields | `seed-vault.sh.local` |
| `commerce/lasso/api-key` | Lasso API key *(only if one ever exists)* | `bootstrap-commerce` / seed |
| `commerce/vendors/duffel-api-key` | Duffel TEST key | `seed-vault.sh.local` |
| `commerce/vendors/tremendous-api-key` | Tremendous SANDBOX key | `seed-vault.sh.local` |
| `commerce/vendors/domino-account` | Domino's account (JSON) | `seed-vault.sh.local` |

The plain `.env` holds **only** public values: `ONECLAW_VAULT_ID`,
`ONECLAW_AGENT_ID`, `DEPLOYER_ADDRESS`, `AGENT_ADDRESS`, RPC/network, vendor
sandbox config, and the demo recipient fields. The **human** `ONECLAW_API_KEY`
is not in the repo at all — it is sourced from `~/.secrets/1claw.env` for
bootstrap/seed, and stored AES-encrypted (and gitignored) in
`.env.secrets.encrypted` so `just start` can read the vault at runtime.
