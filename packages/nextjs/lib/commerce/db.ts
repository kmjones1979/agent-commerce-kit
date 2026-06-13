/**
 * db.ts — local SQLite audit log for the commerce layer.
 *
 * Uses Node's built-in `node:sqlite` (Node >= 22) so there is no native
 * dependency to compile. This records the full intent -> approval/denial ->
 * settlement timeline that the /audit page renders, *in addition* to whatever
 * Ampersend logs server-side. It never stores card fields or keys.
 */
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

export type Decision = "pending" | "approved" | "denied";
export type SettlementStatus = "none" | "submitted" | "dry-run" | "failed";

export interface IntentRow {
  id: number;
  ts: string;
  vendor: string;
  description: string;
  amount_usd: number;
  currency: string;
  decision: Decision;
  reason: string | null;
  instrument_kind: string | null;
  instrument_last4: string | null;
  settlement_status: SettlementStatus;
  order_ref: string | null;
  detail_json: string | null;
}

let _db: DatabaseSync | null = null;

function dbPath(): string {
  if (process.env.COMMERCE_DB_PATH) return process.env.COMMERCE_DB_PATH;
  return join(process.cwd(), "commerce.db");
}

function db(): DatabaseSync {
  if (_db) return _db;
  _db = new DatabaseSync(dbPath());
  _db.exec(`
    CREATE TABLE IF NOT EXISTS intents (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      ts                TEXT    NOT NULL,
      vendor            TEXT    NOT NULL,
      description       TEXT    NOT NULL,
      amount_usd        REAL    NOT NULL,
      currency          TEXT    NOT NULL DEFAULT 'USD',
      decision          TEXT    NOT NULL DEFAULT 'pending',
      reason            TEXT,
      instrument_kind   TEXT,
      instrument_last4  TEXT,
      settlement_status TEXT    NOT NULL DEFAULT 'none',
      order_ref         TEXT,
      detail_json       TEXT
    );
  `);
  return _db;
}

export function recordIntent(i: {
  vendor: string;
  description: string;
  amountUsd: number;
  currency?: string;
}): number {
  const stmt = db().prepare(
    `INSERT INTO intents (ts, vendor, description, amount_usd, currency)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const info = stmt.run(
    new Date().toISOString(),
    i.vendor,
    i.description,
    i.amountUsd,
    i.currency ?? "USD",
  );
  return Number(info.lastInsertRowid);
}

export function setDecision(
  id: number,
  decision: Decision,
  opts: { reason?: string; instrumentKind?: string; instrumentLast4?: string } = {},
): void {
  db()
    .prepare(
      `UPDATE intents
         SET decision = ?, reason = ?, instrument_kind = ?, instrument_last4 = ?
       WHERE id = ?`,
    )
    .run(
      decision,
      opts.reason ?? null,
      opts.instrumentKind ?? null,
      opts.instrumentLast4 ?? null,
      id,
    );
}

export function setSettlement(
  id: number,
  status: SettlementStatus,
  opts: { orderRef?: string; detail?: unknown } = {},
): void {
  db()
    .prepare(
      `UPDATE intents SET settlement_status = ?, order_ref = ?, detail_json = ? WHERE id = ?`,
    )
    .run(
      status,
      opts.orderRef ?? null,
      opts.detail !== undefined ? JSON.stringify(opts.detail) : null,
      id,
    );
}

export function recentIntents(limit = 50): IntentRow[] {
  return db()
    .prepare(`SELECT * FROM intents ORDER BY id DESC LIMIT ?`)
    .all(limit) as unknown as IntentRow[];
}

export function getIntent(id: number): IntentRow | undefined {
  return db().prepare(`SELECT * FROM intents WHERE id = ?`).get(id) as
    | IntentRow
    | undefined;
}

export function summary(): { total: number; approved: number; denied: number; submitted: number } {
  const row = db()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN decision='approved' THEN 1 ELSE 0 END) AS approved,
         SUM(CASE WHEN decision='denied' THEN 1 ELSE 0 END) AS denied,
         SUM(CASE WHEN settlement_status='submitted' THEN 1 ELSE 0 END) AS submitted
       FROM intents`,
    )
    .get() as Record<string, number>;
  return {
    total: row.total ?? 0,
    approved: row.approved ?? 0,
    denied: row.denied ?? 0,
    submitted: row.submitted ?? 0,
  };
}
