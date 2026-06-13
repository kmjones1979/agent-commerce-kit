"use client";

import Link from "next/link";
import { ArrowLeft, Bug, Fingerprint } from "lucide-react";
import type { Abi, Address } from "viem";
import { Contract } from "@scaffold-ui/debug-contracts";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import deployedContracts from "@/contracts/deployedContracts";
import { NETWORKS, type NetworkDefinition } from "@/lib/networks";

function blockExplorerForChain(chainId: number): string | undefined {
  const n = (Object.values(NETWORKS) as NetworkDefinition[]).find(
    (x) => x.chainId === chainId,
  );
  return n?.blockExplorerUrl;
}

export default function DebugPage() {
  const data = deployedContracts as Record<
    string,
    Record<string, { address: string; abi: readonly unknown[] }>
  >;
  const entries = Object.entries(data).filter(
    ([, contracts]) => Object.keys(contracts).length > 0,
  );

  return (
    <div className="flex flex-col min-h-screen">
      <header className="border-b border-border px-6 py-4 flex items-center gap-4">
        <Link
          href="/"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent text-muted-foreground"
          title="Back to chat"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
          <Bug className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold">Debug contracts</h1>
          <p className="text-xs text-muted-foreground">
            Deployed addresses &amp; ABI from{" "}
            <code className="text-xs bg-muted px-1 rounded">deployedContracts.ts</code>{" "}
            via{" "}
            <a
              href="https://github.com/scaffold-eth/scaffold-ui"
              className="underline hover:text-foreground"
              target="_blank"
              rel="noreferrer"
            >
              Scaffold UI
            </a>
          </p>
        </div>
        <Link
          href="/identity"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-accent text-muted-foreground"
          title="Agent identity (ERC-8004)"
        >
          <Fingerprint className="h-4 w-4" />
        </Link>
        <ConnectWalletButton />
      </header>

      <main className="flex-1 py-8 max-w-7xl mx-auto w-full space-y-10 px-4 lg:px-10">
        {entries.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground space-y-2">
            <p>No deployed contracts in <code className="bg-muted px-1 rounded">deployedContracts.ts</code> yet.</p>
            <p>Run: <code className="bg-muted px-1 rounded">just chain</code> → <code className="bg-muted px-1 rounded">just fund</code> → <code className="bg-muted px-1 rounded">just deploy</code></p>
          </div>
        ) : (
          entries.map(([chainIdStr, contracts]) => {
            const chainId = Number(chainIdStr);
            const explorer = blockExplorerForChain(chainId);
            return (
              <section key={chainIdStr} className="space-y-8">
                <h2 className="text-lg font-semibold">Chain {chainIdStr}</h2>
                {Object.entries(contracts).map(([name, meta]) => (
                  <Contract
                    key={name}
                    contractName={name}
                    contract={{
                      address: meta.address as Address,
                      abi: meta.abi as Abi,
                    }}
                    chainId={chainId}
                    blockExplorerBaseUrl={explorer}
                  />
                ))}
              </section>
            );
          })
        )}
        <p className="text-xs text-muted-foreground border-t border-border pt-6">
          Inspired by{" "}
          <a
            href="https://github.com/scaffold-eth/scaffold-eth-2"
            className="underline hover:text-foreground"
            target="_blank"
            rel="noreferrer"
          >
            Scaffold-ETH 2
          </a>{" "}
          and{" "}
          <a
            href="https://github.com/scaffold-eth/scaffold-ui"
            className="underline hover:text-foreground"
            target="_blank"
            rel="noreferrer"
          >
            Scaffold UI
          </a>
          . The chat agent can use server tools (<code className="bg-muted px-1 rounded">list_deployed_contracts</code>,{" "}
          <code className="bg-muted px-1 rounded">contract_read</code>
          ) plus optional 1Claw Intents tools when configured.
        </p>
      </main>
    </div>
  );
}
