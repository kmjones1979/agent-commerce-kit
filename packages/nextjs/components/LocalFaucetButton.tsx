"use client";

import { useEffect, useState } from "react";
import { Droplets, Loader2 } from "lucide-react";
import { useAccount, useChainId } from "wagmi";
import { hardhat } from "wagmi/chains";
import { cn } from "@/lib/utils";
import { targetNetwork } from "@/lib/networks";

/**
 * Localhost-only: send ETH from Anvil account #0 via POST /api/faucet (same dev key as just fund).
 * Wallet state is omitted until mount so SSR + first client paint match (avoids hydration mismatch with wagmi).
 */
export function LocalFaucetButton() {
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const ms = toast.kind === "ok" ? 4500 : 8000;
    const t = window.setTimeout(() => setToast(null), ms);
    return () => window.clearTimeout(t);
  }, [toast]);

  if (targetNetwork !== "localhost") return null;

  if (!mounted) {
    return (
      <div
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted/50 animate-pulse"
        aria-hidden
      />
    );
  }

  const wrongChain = isConnected && chainId !== hardhat.id;
  const disabled = !isConnected || !address || wrongChain || busy;

  async function onFaucet() {
    if (!address || disabled) return;
    setBusy(true);
    setToast(null);
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, chainId: hardhat.id }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; amount?: string; symbol?: string };
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      const amt = data.amount ?? "?";
      const sym = data.symbol ?? "ETH";
      setToast({
        kind: "ok",
        text: "Sent " + amt + " " + sym + " to your wallet (local faucet).",
      });
    } catch (e) {
      setToast({
        kind: "err",
        text: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  const title = wrongChain
    ? "Switch your wallet to Localhost (chain 31337)"
    : !isConnected
      ? "Connect a wallet first"
      : "Mint 10 test ETH from local Anvil account #0";

  return (
    <>
      <button
        type="button"
        onClick={() => void onFaucet()}
        disabled={disabled}
        title={title}
        className={cn(
          "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
          "text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors",
          "disabled:pointer-events-none disabled:opacity-40",
        )}
        aria-label="Local faucet"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Droplets className="h-4 w-4" />}
      </button>
      {toast ? (
        <div
          role="status"
          className={cn(
            "fixed bottom-20 left-1/2 z-50 max-w-md -translate-x-1/2 rounded-lg border px-4 py-2 text-sm shadow-lg",
            toast.kind === "ok"
              ? "border-border bg-card text-foreground"
              : "border-destructive/50 bg-destructive/10 text-destructive",
          )}
        >
          {toast.text}
        </div>
      ) : null}
    </>
  );
}
