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
});

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
  return changed ? { ...meta, outbox } : meta;
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

export const pendingCount = (meta: SyncMeta) => Object.keys(meta.outbox).length;
