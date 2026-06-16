set dotenv-load

# List available commands
default:
    @just --list

# One-shot bootstrap: prompts for 1Claw key + Ampersend key, creates vault/agent/policy
bootstrap:
    node scripts/bootstrap.mjs

# Enable 1Claw Shroud LLM token billing on the current agent (prompts for human key)
enable-shroud:
    node scripts/enable-shroud.mjs

# Start local Foundry chain
chain:
    cd packages/foundry && anvil

# Fund DEPLOYER + optional AGENT (100 ETH each from Anvil default account #0; chain must be running)
fund:
    node scripts/fund-deployer.mjs

# Compile contracts
compile:
    #!/usr/bin/env bash
    set -euo pipefail
    cd packages/foundry
    if [ ! -f lib/forge-std/src/Script.sol ]; then
      echo "Installing forge-std (first run)..."
      forge install foundry-rs/forge-std --no-git
    fi
    forge build

# Deploy contracts and generate ABI types (prompts for secrets password if .env.secrets.encrypted exists)
# Examples: just deploy   just deploy base   just deploy --network sepolia
deploy *ARGS:
    node scripts/with-secrets.mjs -- node scripts/deploy-foundry.mjs {{ARGS}}

# Verify AgentWallet on a block explorer (set ETHERSCAN_API_KEY / BASESCAN_API_KEY / …)
# Examples: just verify base   just verify --network sepolia   VERIFY_NETWORK=base just verify
verify *ARGS:
    node scripts/with-secrets.mjs -- node scripts/verify-foundry.mjs {{ARGS}}

# Run contract tests
test:
    #!/usr/bin/env bash
    set -euo pipefail
    cd packages/foundry
    if [ ! -f lib/forge-std/src/Script.sol ]; then
      echo "Installing forge-std (first run)..."
      forge install foundry-rs/forge-std --no-git
    fi
    forge test

# Start NextJS frontend (prompts for secrets password if .env.secrets.encrypted exists)
start:
    -node scripts/check-network.mjs
    node scripts/with-secrets.mjs -- sh -c 'cd packages/nextjs && npm run dev'

# List 1Claw vault + agent UUIDs (needs ONECLAW_API_KEY; use with encrypted secrets)
list-1claw:
    node scripts/with-secrets.mjs -- node scripts/list-1claw-ids.mjs

# List + write first vault + first agent UUID into repo-root .env (ONECLAW_VAULT_ID / ONECLAW_AGENT_ID)
sync-1claw-env:
    node scripts/with-secrets.mjs -- node scripts/list-1claw-ids.mjs --write-env

# Re-bootstrap 1Claw (new vault + agent) — WARNING: backup secrets; see script banner
reset *ARGS:
    node scripts/with-secrets.mjs -- node scripts/reset-1claw-setup.mjs {{ARGS}}

# Plain repo-root .env (NEXT_PUBLIC_* for WalletConnect / Reown client bundle)
#   just env MY_KEY my_value   — or: SECRET_VALUE=x just env MY_KEY
env key value:
    node scripts/secret-add.mjs env {{key}} {{value}}

# Encrypted .env.secrets.encrypted (password prompt; creates file if missing)
enc key value:
    node scripts/secret-add.mjs encrypted {{key}} {{value}}

# 1Claw vault secret (ONECLAW_VAULT_ID + ONECLAW_API_KEY; recipe runs with-secrets)
vault path value:
    node scripts/with-secrets.mjs -- node scripts/secret-add.mjs vault {{path}} {{value}}

# Bootstrap commerce creds into the vault (Ampersend agent secret + optional Lasso key).
# Reads ONECLAW_API_KEY from your shell; prompts (hidden) for the rest. See scripts/bootstrap-commerce.mjs
bootstrap-commerce:
    node scripts/bootstrap-commerce.mjs

# Seed vendor + Lasso card credentials into the vault (interactive, hidden input)
seed-vault:
    bash scripts/seed-vault.sh.local

# Reown / WalletConnect Cloud project id → .env
reown project_id:
    node scripts/secret-add.mjs env NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID {{project_id}}

# Register ERC-8004 agent on-chain (AGENT_PRIVATE_KEY pays gas; network from scaffold.config)
register-agent:
    node scripts/with-secrets.mjs -- npx tsx scripts/register-agent.ts

# Add N swarm agent wallets (public/agents.json + SWARM_AGENT_KEYS_JSON); default agents=1
swarm agents='1':
    node scripts/with-secrets.mjs -- node scripts/swarm-agents.mjs agents={{agents}}

# Deploy to Vercel (production by default); just ship   just ship name=my-custom-name   just ship preview
ship *ARGS:
    node scripts/ship.mjs {{ARGS}}

# Push env vars to Vercel; just ship-env KEY VALUE   just ship-env sync (pushes all from .env)
ship-env *ARGS:
    node scripts/with-secrets.mjs -- node scripts/ship-env.mjs {{ARGS}}

# Show deployer + agent address QR codes (reads repo-root .env)
accounts:
    node scripts/show-accounts.mjs

# Generate a deployer wallet (if not already set)
generate:
    node scripts/generate-deployer.mjs

# Validate targetNetwork chainId has contracts in deployedContracts
check-network:
    node scripts/check-network.mjs

# Switch targetNetwork in scaffold.config.ts and validate deployedContracts
use-network key:
    #!/usr/bin/env bash
    set -euo pipefail
    VALID_KEYS="ethereum base sepolia baseSepolia polygon bnb localhost"
    if ! echo "$VALID_KEYS" | grep -qw "{{key}}"; then
      echo "Unknown network key: {{key}}"
      echo "Valid keys: $VALID_KEYS"
      exit 1
    fi
    sed -i.bak 's/export const targetNetwork = "[^"]*"/export const targetNetwork = "{{key}}"/' scaffold.config.ts && rm -f scaffold.config.ts.bak
    echo "  targetNetwork → {{key}}"
    node scripts/check-network.mjs
