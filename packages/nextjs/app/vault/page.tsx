/**
 * /vault — confirm which vault paths are POPULATED, without ever exposing a
 * value. Server component: it lists secret keys via the 1Claw API and renders a
 * green/red indicator per expected path.
 */
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { vault } from "@/lib/commerce/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Expected {
  path: string;
  label: string;
  required: boolean;
  group: string;
}

const EXPECTED: Expected[] = [
  { group: "Agent identity (1Claw)", path: "private-keys/deployer", label: "Deployer private key", required: true },
  { group: "Agent identity (1Claw)", path: "private-keys/agent", label: "Agent private key", required: true },
  { group: "Agent identity (1Claw)", path: "llm-api-key", label: "LLM API key (chat)", required: true },
  { group: "Ampersend", path: "commerce/ampersend/agent-key", label: "Ampersend agent secret", required: true },
  { group: "Ampersend", path: "private-keys/ampersend-signing", label: "Ampersend signing key (x402 SDK)", required: false },
  { group: "Lasso card (fallback instrument)", path: "commerce/lasso/card-pan", label: "Card number (PAN)", required: false },
  { group: "Lasso card (fallback instrument)", path: "commerce/lasso/card-exp", label: "Expiry", required: false },
  { group: "Lasso card (fallback instrument)", path: "commerce/lasso/card-cvc", label: "CVC", required: false },
  { group: "Lasso card (fallback instrument)", path: "commerce/lasso/card-name", label: "Cardholder name", required: false },
  { group: "Lasso card (fallback instrument)", path: "commerce/lasso/billing-zip", label: "Billing ZIP", required: false },
  { group: "Lasso card (fallback instrument)", path: "commerce/lasso/api-key", label: "Lasso API key (if any)", required: false },
  { group: "Vendor keys", path: "commerce/vendors/duffel-api-key", label: "Duffel TEST key", required: false },
  { group: "Vendor keys", path: "commerce/vendors/tremendous-api-key", label: "Tremendous SANDBOX key", required: false },
  { group: "Vendor keys", path: "commerce/vendors/domino-account", label: "Domino's account (JSON)", required: false },
];

export default async function VaultPage() {
  let present: Set<string>;
  let error: string | null = null;
  try {
    present = new Set(await vault.list());
  } catch (e) {
    present = new Set();
    error = e instanceof Error ? e.message : String(e);
  }

  const groups = Array.from(new Set(EXPECTED.map((e) => e.group)));

  return (
    <div className="min-h-screen p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-muted-foreground hover:text-foreground" aria-label="Back to chat">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-lg font-semibold">1Claw vault status</h1>
          <p className="text-sm text-muted-foreground">
            Path existence only — secret values are never read or shown here.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 text-destructive text-sm px-4 py-3">
          Could not list the vault: {error}
        </div>
      )}

      {groups.map((g) => (
        <section key={g} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g}</h2>
          <ul className="rounded-lg border border-border divide-y divide-border">
            {EXPECTED.filter((e) => e.group === g).map((e) => {
              const ok = present.has(e.path);
              return (
                <li key={e.path} className="flex items-center gap-3 px-4 py-2.5">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${
                      ok ? "bg-green-500" : e.required ? "bg-red-500" : "bg-muted-foreground/40"
                    }`}
                    aria-hidden
                  />
                  <span className="flex-1 text-sm">{e.label}</span>
                  <code className="text-xs text-muted-foreground">{e.path}</code>
                  <span className={`text-xs ${ok ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                    {ok ? "populated" : e.required ? "MISSING" : "optional"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <p className="text-xs text-muted-foreground">
        Seed paths with <code>just bootstrap-commerce</code> and{" "}
        <code>bash scripts/seed-vault.sh.local</code>.
      </p>
    </div>
  );
}
