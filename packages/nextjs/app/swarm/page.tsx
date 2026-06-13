"use client";

import { useCallback, useMemo, useState } from "react";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ArrowLeft, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAgentSwarm } from "@/lib/agent-swarm";
import Link from "next/link";

export default function SwarmPage() {
  const { roster } = useAgentSwarm();
  const [pk, setPk] = useState<string | null>(null);
  const [addr, setAddr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const genLocal = useCallback(() => {
    const hex = generatePrivateKey();
    const acct = privateKeyToAccount(hex);
    setPk(hex);
    setAddr(acct.address);
    setCopied(false);
  }, []);

  const snippet = useMemo(() => {
    if (!pk || !addr) return "";
    return JSON.stringify([{ id: "new-local", privateKey: pk }], null, 0);
  }, [pk, addr]);

  return (
    <div className="flex flex-col min-h-screen">
      <header className="border-b border-border px-6 py-4 flex items-center gap-4 flex-wrap">
        <Link
          href="/"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent text-muted-foreground"
          title="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold">Swarm</h1>
          <p className="text-xs text-muted-foreground">
            On-chain agent wallets — add more with{" "}
            <code className="rounded bg-muted px-1">just swarm agents=N</code>
          </p>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-lg mx-auto w-full space-y-6">
        <section className="rounded-lg border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-medium">Configured agents</h2>
          {roster.length === 0 ? (
            <p className="text-sm text-muted-foreground">No agents.json entries yet.</p>
          ) : (
            <ul className="space-y-2 text-sm font-mono text-xs">
              {roster.map((a) => (
                <li key={a.id} className="flex flex-col gap-0.5 border-b border-border pb-2 last:border-0">
                  <span className="text-foreground">{a.id}</span>
                  <span className="text-muted-foreground break-all">{a.address}</span>
                  {a.preset ? (
                    <span className="text-muted-foreground">preset: {a.preset}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-medium">Generate locally (browser)</h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Creates a key in memory only. To persist, merge the private key into encrypted secrets and
            update <code className="rounded bg-muted px-1">public/agents.json</code> — use{" "}
            <code className="rounded bg-muted px-1">just swarm agents=1</code> for a guided flow, or
            append the JSON below to <code className="rounded bg-muted px-1">SWARM_AGENT_KEYS_JSON</code>.
          </p>
          <Button type="button" size="sm" variant="secondary" onClick={genLocal}>
            Generate wallet
          </Button>
          {addr && pk ? (
            <div className="space-y-2 text-xs">
              <p className="font-mono break-all text-muted-foreground">{addr}</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded bg-muted p-2 text-[10px] leading-snug">
                  {snippet}
                </code>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"
                  title="Copy JSON snippet"
                  onClick={() => {
                    void navigator.clipboard.writeText(snippet).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
