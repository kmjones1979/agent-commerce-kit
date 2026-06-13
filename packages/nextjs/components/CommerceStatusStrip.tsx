"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, CreditCard, Wallet, RefreshCw } from "lucide-react";

interface Tx {
  id: number;
  vendor: string;
  description: string;
  amountUsd: number;
  decision: "pending" | "approved" | "denied";
  settlement: string;
  last4: string | null;
  orderRef: string | null;
}

interface Status {
  ampersend: {
    configured: boolean;
    balanceUsd: number | null;
    limits: { perTransactionUsd: number | null; dailyUsd: number | null; monthlyUsd: number | null } | null;
    spentTodayUsd: number;
    dailyRemainingUsd: number | null;
    note?: string;
  };
  instrument: { label: string; last4: string };
  transactions: Tx[];
}

function badgeClass(tx: Tx): string {
  if (tx.decision === "denied") return "bg-destructive/15 text-destructive";
  if (tx.settlement === "submitted") return "bg-green-500/15 text-green-600 dark:text-green-400";
  if (tx.settlement === "dry-run") return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  if (tx.decision === "approved") return "bg-blue-500/15 text-blue-600 dark:text-blue-400";
  return "bg-muted text-muted-foreground";
}

function badgeLabel(tx: Tx): string {
  if (tx.decision === "denied") return "denied";
  if (tx.settlement === "submitted") return "ordered";
  if (tx.settlement === "dry-run") return "dry-run";
  if (tx.decision === "approved") return "approved";
  return tx.decision;
}

export function CommerceStatusStrip() {
  const [s, setS] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/commerce/status", { cache: "no-store" });
      setS((await res.json()) as Status);
    } catch {
      setS(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const a = s?.ampersend;
  return (
    <div className="border-b border-border bg-muted/30 px-4 py-2 text-xs flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="inline-flex items-center gap-1.5 font-medium">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        Ampersend
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            a?.configured ? "bg-green-500" : "bg-muted-foreground/40"
          }`}
          title={a?.configured ? "configured" : a?.note || "not configured"}
        />
      </span>

      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Wallet className="h-3.5 w-3.5" aria-hidden />
        {a?.balanceUsd != null ? `$${a.balanceUsd.toFixed(2)} bal` : "—"}
      </span>

      <span className="text-muted-foreground" title="daily limit / remaining">
        daily:{" "}
        <strong className="text-foreground">
          {a?.dailyRemainingUsd != null ? `$${a.dailyRemainingUsd.toFixed(2)}` : "—"}
        </strong>
        {a?.limits?.dailyUsd != null ? ` / $${a.limits.dailyUsd.toFixed(0)}` : ""} left
      </span>

      <span className="inline-flex items-center gap-1.5 text-muted-foreground" title={s?.instrument.label}>
        <CreditCard className="h-3.5 w-3.5" aria-hidden />
        ••••{s?.instrument.last4 ?? "—"}
      </span>

      <span className="flex-1" />

      <span className="inline-flex items-center gap-1.5 flex-wrap">
        {(s?.transactions ?? []).slice(0, 5).map((tx) => (
          <span
            key={tx.id}
            className={`rounded px-1.5 py-0.5 ${badgeClass(tx)}`}
            title={`${tx.description} — $${tx.amountUsd}${tx.orderRef ? ` (${tx.orderRef})` : ""}`}
          >
            {tx.vendor}: {badgeLabel(tx)}
          </span>
        ))}
        {s && s.transactions.length === 0 && (
          <span className="text-muted-foreground">no transactions yet</span>
        )}
      </span>

      <button
        onClick={load}
        className="inline-flex items-center justify-center h-6 w-6 rounded hover:bg-accent text-muted-foreground"
        title="Refresh"
        aria-label="Refresh status"
        disabled={loading}
      >
        <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} aria-hidden />
      </button>
    </div>
  );
}
