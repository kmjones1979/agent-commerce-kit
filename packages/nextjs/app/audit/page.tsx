/**
 * /audit — the full intent → approval/denial → settlement timeline, read from
 * the local commerce.db audit log. Server component.
 */
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { recentIntents, summary, type IntentRow } from "@/lib/commerce/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function decisionBadge(r: IntentRow): { cls: string; text: string } {
  if (r.decision === "denied") return { cls: "bg-destructive/15 text-destructive", text: "denied" };
  if (r.settlement_status === "submitted") return { cls: "bg-green-500/15 text-green-600 dark:text-green-400", text: "ordered" };
  if (r.settlement_status === "dry-run") return { cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400", text: "dry-run" };
  if (r.decision === "approved") return { cls: "bg-blue-500/15 text-blue-600 dark:text-blue-400", text: "approved" };
  return { cls: "bg-muted text-muted-foreground", text: r.decision };
}

export default async function AuditPage() {
  let rows: IntentRow[] = [];
  let stats = { total: 0, approved: 0, denied: 0, submitted: 0 };
  let error: string | null = null;
  try {
    rows = recentIntents(100);
    stats = summary();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/" className="text-muted-foreground hover:text-foreground" aria-label="Back to chat">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Commerce audit log</h1>
          <p className="text-sm text-muted-foreground">
            intent → Ampersend co-approval → settlement, from commerce.db
          </p>
        </div>
        <div className="text-xs text-muted-foreground flex gap-3">
          <span>{stats.total} total</span>
          <span className="text-blue-600 dark:text-blue-400">{stats.approved} approved</span>
          <span className="text-destructive">{stats.denied} denied</span>
          <span className="text-green-600 dark:text-green-400">{stats.submitted} ordered</span>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 text-destructive text-sm px-4 py-3">{error}</div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No orders yet. Try one from the chat or /commerce.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Time</th>
                <th className="text-left px-3 py-2 font-medium">Vendor</th>
                <th className="text-left px-3 py-2 font-medium">Description</th>
                <th className="text-right px-3 py-2 font-medium">USD</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-left px-3 py-2 font-medium">Instrument</th>
                <th className="text-left px-3 py-2 font-medium">Ref / Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => {
                const b = decisionBadge(r);
                return (
                  <tr key={r.id}>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(r.ts).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">{r.vendor}</td>
                    <td className="px-3 py-2 max-w-[18rem] truncate" title={r.description}>{r.description}</td>
                    <td className="px-3 py-2 text-right tabular-nums">${r.amount_usd.toFixed(2)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${b.cls}`}>{b.text}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {r.instrument_kind ? `${r.instrument_kind} ••••${r.instrument_last4 ?? ""}` : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-[16rem] truncate" title={r.order_ref || r.reason || ""}>
                      {r.order_ref || r.reason || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
