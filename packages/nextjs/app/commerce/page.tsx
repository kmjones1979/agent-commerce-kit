"use client";

import Link from "next/link";
import { ArrowLeft, Pizza, Plane, Gift } from "lucide-react";

const VENDORS = [
  {
    id: "domino",
    icon: Pizza,
    title: "Domino's — pizza",
    blurb: "Order a medium pepperoni to the demo address in .env. Pays with the agent's card (Ampersend-issued or vault Lasso). Dry-run unless COMMERCE_DOMINO_LIVE=true.",
    prompt: "Order me a pepperoni pizza.",
  },
  {
    id: "duffel",
    icon: Plane,
    title: "Duffel — flights (TEST)",
    blurb: "Search the demo route and book the cheapest fare under the per-tx cap, against Duffel's test environment. Dry-run unless COMMERCE_DUFFEL_LIVE=true.",
    prompt: "Book me the cheapest flight on my demo route.",
  },
  {
    id: "tremendous",
    icon: Gift,
    title: "Tremendous — gift card (SANDBOX)",
    blurb: "Send a $5 Amazon gift card to the demo recipient email, against the Tremendous sandbox. Dry-run unless COMMERCE_TREMENDOUS_LIVE=true.",
    prompt: "Send a $5 Amazon gift card to the demo recipient.",
  },
];

export default function CommercePage() {
  return (
    <div className="min-h-screen p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-muted-foreground hover:text-foreground" aria-label="Back to chat">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold">Commerce vendors</h1>
          <p className="text-sm text-muted-foreground">
            Every order runs through Ampersend co-approval and the audit log first.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-1">
        {VENDORS.map((v) => {
          const Icon = v.icon;
          return (
            <div key={v.id} className="rounded-lg border border-border p-4 flex gap-4">
              <div className="h-10 w-10 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-center shrink-0">
                <Icon className="h-5 w-5 text-brand" aria-hidden />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="font-medium">{v.title}</h2>
                <p className="text-sm text-muted-foreground mt-1">{v.blurb}</p>
                <div className="mt-3 flex items-center gap-3">
                  <Link
                    href={`/?prompt=${encodeURIComponent(v.prompt)}`}
                    className="inline-flex items-center rounded-md brand-gradient text-white text-sm px-3 py-1.5 hover:brightness-110 transition-[filter]"
                  >
                    Try it
                  </Link>
                  <code className="text-xs text-muted-foreground truncate">“{v.prompt}”</code>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-4 text-sm">
        <Link href="/audit" className="underline text-muted-foreground hover:text-foreground">Audit log →</Link>
        <Link href="/vault" className="underline text-muted-foreground hover:text-foreground">Vault status →</Link>
      </div>
    </div>
  );
}
