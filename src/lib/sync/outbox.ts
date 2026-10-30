/**
 * Local changes waiting to reach the household, plus the pull cursor. Pure functions over
 * plain data; the engine persists the result in localStorage (`larder-sync`).
 *
 * The outbox stores only what changed (collection, id, upsert/delete), never the data: when a
 * batch is sent, each record is read from the store as it is then, so the newest local
 * version always goes up and repeated edits to one record collapse into one row.
 */
import {
  MAX_ID_LENGTH,
  SYNCED_COLLECTIONS,
  getRecord,
  recordKey,
  recordsOf,
  sameRecord,
  type CollectionName,
  type SyncedState,
} from "@/lib/sync/collections";
import type { Json, TablesInsert } from "@/lib/supabase/database.types";

export type ChangeOp = "upsert" | "delete";

export interface Change {
  c: CollectionName;
  id: string;
  op: ChangeOp;
}

export interface OutboxEntry extends Change {
  /** Bumped on every enqueue; a send only clears the entry if it hasn't changed since. */
  rev: number;
}

export type Outbox = Record<string, OutboxEntry>;

export type FailReason =
  /** Bigger than MAX_RECORD_BYTES; never sent. */
  | "too-large"
  /** The server refused the row itself (a data or constraint error). */
  | "rejected";

/** A change taken out of the outbox because it can never go up as it is. */
export interface FailedChange {
  c: CollectionName;
  id: string;
  reason: FailReason;
}

/** Largest record (JSON, in bytes) that goes up. Anything bigger is set aside, not retried. */
export const MAX_RECORD_BYTES = 60_000;

export interface SyncMeta {
  v: 1;
  /** Household this device syncs with; null = not syncing. */
  householdId: string | null;
  householdName: string | null;
  /** Account the binding belongs to. Another account signing in unbinds. */
  userId: string | null;
  /** Highest `seq` applied from the server. */
  cursor: number;
  outbox: Outbox;
  /** Last rev handed out. */
  rev: number;
  lastSyncedAt: string | null;
  /** Changes that couldn't sync and won't be retried until the record changes again. */
  failed: FailedChange[];
  /**
   * Joined with "bring the food on this device": the local-only records go up after the first
   * complete pull. Persisted so a failed first pull (or a closed tab) doesn't lose them.
   */
  pendingMerge: boolean;
}

export const emptyMeta = (): SyncMeta => ({
  v: 1,
  householdId: null,
  householdName: null,
  userId: null,
  cursor: 0,
  outbox: {},
  rev: 0,
  lastSyncedAt: null,
  failed: [],
  pendingMerge: false,
});

const isFailed = (f: unknown): f is FailedChange => {
  const x = f as FailedChange | null;
  return !!x && typeof x.c === "string" && typeof x.id === "string" && (x.reason === "too-large" || x.reason === "rejected");
};

/** Read persisted meta, tolerating anything malformed. */
export function parseMeta(raw: string | null): SyncMeta {
  if (!raw) return emptyMeta();
  try {
    const m = JSON.parse(raw) as Partial<SyncMeta>;
    if (!m || typeof m !== "object" || m.v !== 1) return emptyMeta();
    return {
      ...emptyMeta(),
      ...m,
      cursor: Number.isFinite(m.cursor) ? Number(m.cursor) : 0,
      rev: Number.isFinite(m.rev) ? Number(m.rev) : 0,
      outbox: m.outbox && typeof m.outbox === "object" ? m.outbox : {},
      failed: Array.isArray(m.failed) ? m.failed.filter(isFailed) : [],
      pendingMerge: m.pendingMerge === true,
    };
  } catch {
    return emptyMeta();
  }
}

/** Records that differ between two states, as upserts and deletes. */
export function diffState(prev: SyncedState, next: SyncedState): Change[] {
  const out: Change[] = [];
  for (const c of SYNCED_COLLECTIONS) {
    // The store replaces a collection only when something in it changed.
    if (prev[c] === next[c]) continue;
    const before = recordsOf(prev, c);
    const after = recordsOf(next, c);
    for (const [id, value] of after) {
      if (!sameRecord(before.get(id), value)) out.push({ c, id, op: "upsert" });
    }
    for (const id of before.keys()) if (!after.has(id)) out.push({ c, id, op: "delete" });
  }
  return out.filter((ch) => ch.id.length > 0 && ch.id.length <= MAX_ID_LENGTH);
}

/** Every record as an upsert (initial upload when starting a household). */
export function allRecords(state: SyncedState, skip?: (c: CollectionName, id: string) => boolean): Change[] {
  const out: Change[] = [];
  for (const c of SYNCED_COLLECTIONS) {
    for (const id of recordsOf(state, c).keys()) {
      if (id.length === 0 || id.length > MAX_ID_LENGTH) continue;
      if (!skip?.(c, id)) out.push({ c, id, op: "upsert" });
    }
  }
  return out;
}

/** Add changes to the outbox (a newer change to the same record replaces the older one). */
export function enqueue(meta: SyncMeta, changes: Change[]): SyncMeta {
  if (changes.length === 0) return meta;
  let rev = meta.rev;
  const outbox = { ...meta.outbox };
  for (const ch of changes) outbox[recordKey(ch.c, ch.id)] = { ...ch, rev: ++rev };
  return { ...meta, outbox, rev };
}

/** Up to `size` entries to send, oldest first. */
export function nextBatch(meta: SyncMeta, size = 200): OutboxEntry[] {
  return Object.values(meta.outbox)
    .sort((a, b) => a.rev - b.rev)
    .slice(0, size);
}

/** Remove sent entries, unless they were re-queued (edited again) while the send was in flight. */
export function ack(meta: SyncMeta, sent: OutboxEntry[]): SyncMeta {
  let changed = false;
  const outbox = { ...meta.outbox };
  for (const e of sent) {
    const k = recordKey(e.c, e.id);
    if (outbox[k]?.rev === e.rev) {
      delete outbox[k];
      changed = true;
    }
  }
  // A record that once failed and has now gone up is fine again.
  const sentKeys = new Set(sent.map((e) => recordKey(e.c, e.id)));
  const failed = meta.failed.filter((f) => !sentKeys.has(recordKey(f.c, f.id)));
  if (failed.length !== meta.failed.length) return { ...meta, outbox, failed };
  return changed ? { ...meta, outbox } : meta;
}

/**
 * Take entries out of the outbox and remember them as failed, so one bad record can't block
 * everything queued behind it. An entry edited again since is left queued (the new version
 * may be fine).
 */
export function quarantine(meta: SyncMeta, entries: OutboxEntry[], reason: FailReason): SyncMeta {
  if (entries.length === 0) return meta;
  const outbox = { ...meta.outbox };
  const failed = new Map(meta.failed.map((f) => [recordKey(f.c, f.id), f]));
  for (const e of entries) {
    const k = recordKey(e.c, e.id);
    if (outbox[k]?.rev !== e.rev) continue;
    delete outbox[k];
    failed.set(k, { c: e.c, id: e.id, reason });
  }
  return { ...meta, outbox, failed: [...failed.values()] };
}

/** "Try again": put failed changes back in the outbox (each goes up as whatever it is now). */
export function requeueFailed(meta: SyncMeta): SyncMeta {
  const changes = meta.failed.map((f): Change => ({ c: f.c, id: f.id, op: "upsert" }));
  return { ...enqueue(meta, changes), failed: [] };
}

export type RecordRow = TablesInsert<"household_records">;

/**
 * Rows for a batch, reading each record's current value. A record that no longer exists
 * locally goes up as a delete, whatever the entry said.
 */
export function buildRows(entries: OutboxEntry[], state: SyncedState, householdId: string): RecordRow[] {
  return entries.map((e) => {
    const value = e.op === "upsert" ? getRecord(state, e.c, e.id) : undefined;
    return value === undefined
      ? { household_id: householdId, collection: e.c, id: e.id, data: null, deleted: true }
      : { household_id: householdId, collection: e.c, id: e.id, data: value as Json, deleted: false };
  });
}

/** Size of a row's data as sent (UTF-8 bytes of its JSON). */
export function recordBytes(row: RecordRow): number {
  return row.data == null ? 0 : new TextEncoder().encode(JSON.stringify(row.data)).length;
}

export interface PreparedBatch {
  entries: OutboxEntry[];
  /** Same order as entries. */
  rows: RecordRow[];
  /** Entries whose record is too big to send. */
  tooLarge: OutboxEntry[];
}

/** Rows for a batch, with oversized records split off instead of sent. */
export function prepareBatch(entries: OutboxEntry[], state: SyncedState, householdId: string, maxBytes = MAX_RECORD_BYTES): PreparedBatch {
  const out: PreparedBatch = { entries: [], rows: [], tooLarge: [] };
  const rows = buildRows(entries, state, householdId);
  rows.forEach((row, i) => {
    if (recordBytes(row) > maxBytes) out.tooLarge.push(entries[i]);
    else {
      out.entries.push(entries[i]);
      out.rows.push(row);
    }
  });
  return out;
}

export const pendingCount = (meta: SyncMeta) => Object.keys(meta.outbox).length;
