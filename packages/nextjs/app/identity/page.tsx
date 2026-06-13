"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { ArrowLeft, Check, Copy, Fingerprint, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { getActiveNetwork } from "@/lib/networks";
import { useEffectiveAgentAddress } from "@/lib/agent-swarm";
import Link from "next/link";

type AgentRow = {
  chainId: number;
  agentId: string;
  name: string;
  description: string;
  active: boolean;
  owners?: string[];
  walletAddress?: string;
};

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted text-muted-foreground"
      title="Copy"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1500);
        });
      }}
    >
      {ok ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export default function IdentityPage() {
  const net = getActiveNetwork();
  const chainId = net.chainId;
  const rpcUrl = net.rpcUrl;

  const agentAddress = useEffectiveAgentAddress();
  const { openConnectModal } = useConnectModal();
  const { address: connected, connector } = useAccount();
  const walletChainId = useChainId();
  const { switchChainAsync, isPending: switchingChain } = useSwitchChain();

  const [loading, setLoading] = useState(false);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [registerStatus, setRegisterStatus] = useState<string | null>(null);

  const refreshLookup = useCallback(async () => {
    const addrs: string[] = [];
    if (agentAddress && /^0x[a-fA-F0-9]{40}$/i.test(agentAddress)) {
      addrs.push(agentAddress);
    }
    if (connected && /^0x[a-fA-F0-9]{40}$/i.test(connected)) {
      addrs.push(connected);
    }
    const seen = new Set<string>();
    const addresses = addrs.filter((a) => {
      const k = a.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (addresses.length === 0) {
      setAgents([]);
      setLookupError(null);
      return;
    }
    setLoading(true);
    setLookupError(null);
    try {
      const res = await fetch("/api/agent0/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addresses, chainId }),
      });
      const data = (await res.json()) as { agents?: AgentRow[]; error?: string };
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      setAgents(Array.isArray(data.agents) ? data.agents : []);
    } catch (e) {
      setAgents([]);
      setLookupError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [agentAddress, connected, chainId]);

  useEffect(() => {
    void refreshLookup();
  }, [refreshLookup]);

  const connectWallet = () => {
    setWalletError(null);
    openConnectModal?.();
  };

  /** Align wallet chain with `scaffold.config` / `getActiveNetwork()` before txs. */
  const ensureWalletOnAppChain = async () => {
    if (!connector) return;
    const provider = (await connector.getProvider()) as {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
    const hex = (await provider.request({ method: "eth_chainId" })) as string;
    const current = Number.parseInt(hex, 16);
    if (current === chainId) return;
    if (!switchChainAsync) {
      throw new Error(
        "Cannot switch chain automatically. Use your wallet or RainbowKit to select chain " +
          chainId +
          " (" +
          net.name +
          ").",
      );
    }
    await switchChainAsync({ chainId });
  };

  const switchToAppChain = () => {
    setWalletError(null);
    void (async () => {
      try {
        await ensureWalletOnAppChain();
      } catch (e) {
        setWalletError(e instanceof Error ? e.message : String(e));
      }
    })();
  };

  const registerOnChain = async () => {
    setWalletError(null);
    setRegisterStatus(null);
    setWalletBusy(true);
    try {
      if (!connector) {
        throw new Error("Connect a wallet first (header or Connect wallet below).");
      }
      await ensureWalletOnAppChain();
      const provider = (await connector.getProvider()) as {
        request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      };
      if (!provider?.request) {
        throw new Error("Wallet does not expose a browser provider.");
      }
      const { SDK } = await import("agent0-sdk");
      const sdk = new SDK({
        chainId,
        rpcUrl,
        walletProvider: provider,
      });
      const agent = sdk.createAgent(
        "agent-commerce-kit agent",
        "Onchain AI agent scaffolded with agent-commerce-kit. ERC-8004 registration via Agent0.",
        "",
      );
      if (agentAddress && /^0x[a-fA-F0-9]{40}$/i.test(agentAddress)) {
        agent.setWallet(agentAddress as `0x${string}`);
      }
      agent.setActive(true);
      const tx = await agent.registerOnChain();
      setRegisterStatus("Waiting for confirmation…");
      await tx.waitConfirmed({ timeoutMs: 300_000 });
      setRegisterStatus("Registered. Refreshing…");
      await refreshLookup();
      setRegisterStatus("Done.");
    } catch (e) {
      setWalletError(e instanceof Error ? e.message : String(e));
      setRegisterStatus(null);
    } finally {
      setWalletBusy(false);
    }
  };

  const wrongChain = Boolean(connected && walletChainId !== chainId);

  return (
    <div className="flex flex-col min-h-screen">
      <header className="border-b border-border px-6 py-4 flex items-center gap-4 flex-wrap">
        <Link
          href="/"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent text-muted-foreground"
          title="Back to chat"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
          <Fingerprint className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold">Agent identity</h1>
          <p className="text-xs text-muted-foreground">
            ERC-8004 via{" "}
            <a
              href="https://sdk.ag0.xyz/docs"
              className="underline hover:text-foreground"
              target="_blank"
              rel="noreferrer"
            >
              Agent0 SDK
            </a>
          </p>
        </div>
        <ConnectWalletButton />
      </header>

      <main className="flex-1 p-6 max-w-2xl mx-auto w-full space-y-8">
        <section className="rounded-lg border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-medium">Configured agent wallet</h2>
          {!agentAddress ? (
            <p className="text-sm text-muted-foreground">
              No agent address in env. Generate an agent wallet (scaffold with agent identity, or{" "}
              <code className="rounded bg-muted px-1">just generate</code>) and set{" "}
              <code className="rounded bg-muted px-1">
                NEXT_PUBLIC_AGENT_ADDRESS
              </code>{" "}
              to match <code className="rounded bg-muted px-1">AGENT_ADDRESS</code>.
            </p>
          ) : (
            <div className="flex items-center gap-2 font-mono text-xs break-all bg-muted/50 rounded-md px-3 py-2">
              <span className="flex-1">{agentAddress}</span>
              <CopyBtn text={agentAddress} />
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Network: <span className="font-mono">{net.name}</span> · Chain ID:{" "}
            <span className="font-mono">{chainId}</span>
            {rpcUrl ? (
              <>
                {" "}
                · RPC: <span className="font-mono break-all">{rpcUrl}</span>
              </>
            ) : null}
            {" "}
            (from <code className="rounded bg-muted px-1">scaffold.config.ts</code> /{" "}
            <code className="rounded bg-muted px-1">rpcOverrides</code>)
          </p>
        </section>

        <section className="rounded-lg border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-medium">Registry lookup</h2>
          <p className="text-xs text-muted-foreground">
            Searches Agent0 for agents owned by your{" "}
            <code className="rounded bg-muted px-1">AGENT_ADDRESS</code>{" "}
            <strong>or</strong> your connected wallet (browser registration usually makes the
            connected wallet the NFT owner).
          </p>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Searching subgraph…
            </div>
          ) : lookupError ? (
            <p className="text-sm text-destructive whitespace-pre-wrap">{lookupError}</p>
          ) : agents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No ERC-8004 registration found for the configured agent address or your connected
              wallet on chain {chainId}. Local chains (e.g. 31337) are often not indexed — use
              Sepolia / Base Sepolia for discovery.
            </p>
          ) : (
            <ul className="space-y-3">
              {agents.map((a) => (
                <li
                  key={`${a.chainId}:${a.agentId}`}
                  className="rounded-md border border-border p-3 text-sm space-y-1"
                >
                  <div className="font-medium">{a.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">
                    {a.chainId}:{a.agentId}
                  </div>
                  <div className="text-xs text-muted-foreground line-clamp-2">{a.description}</div>
                  <div className="text-xs">
                    Active: {a.active ? "yes" : "no"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-5 space-y-4">
          <h2 className="text-sm font-medium">Register (browser wallet)</h2>
          <p className="text-xs text-muted-foreground">
            Uses <code className="rounded bg-muted px-1">registerOnChain()</code> (compact on-chain
            registration). Your <strong>connected wallet</strong> pays gas and will{" "}
            <strong>own the agent NFT</strong>. The agent&apos;s operational wallet is set to{" "}
            <code className="rounded bg-muted px-1">AGENT_ADDRESS</code> when configured.
          </p>
          {wrongChain ? (
            <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Your wallet is on chain <span className="font-mono">{walletChainId}</span> but this
                app uses <span className="font-mono">{net.name}</span> (
                <span className="font-mono">{chainId}</span>) from{" "}
                <code className="rounded bg-muted px-1">scaffold.config.ts</code>. Switch before
                registering.
              </p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={switchingChain || walletBusy}
                onClick={switchToAppChain}
              >
                {switchingChain ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Switch wallet to {net.name}
              </Button>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={connectWallet} disabled={walletBusy}>
              {walletBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Connect wallet
            </Button>
            <Button
              type="button"
              onClick={() => void registerOnChain()}
              disabled={walletBusy || !agentAddress || agents.length > 0 || !connected}
            >
              Register on-chain
            </Button>
          </div>
          {connected ? (
            <p className="text-xs text-muted-foreground font-mono">Connected: {connected}</p>
          ) : null}
          {connected && agentAddress ? (
            <p className="text-xs text-muted-foreground">
              You (connected wallet) will own the agent NFT. The agent&apos;s operational wallet is
              set to <span className="font-mono">{agentAddress}</span> (
              <code className="rounded bg-muted px-1">AGENT_ADDRESS</code>).
            </p>
          ) : null}
          {agents.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Already registered — no need to register again.
            </p>
          ) : null}
          {walletError ? (
            <p className="text-xs text-destructive whitespace-pre-wrap">{walletError}</p>
          ) : null}
          {registerStatus ? (
            <p className="text-xs text-muted-foreground">{registerStatus}</p>
          ) : null}
        </section>
      </main>
    </div>
  );
}
