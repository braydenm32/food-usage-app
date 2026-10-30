/**
 * Applying rows pulled from the server to the local store. Pure.
 *
 * Rules:
 * - A deleted row removes the record (the profile goes back to defaults).
 * - A row for a record that is still in the outbox is skipped: the local edit hasn't been sent
 *   yet, it will be, and then it wins (last writer wins).
 * - A row identical to what's already here changes nothing (so our own echoes are free).
 * - The cursor always advances past every row seen, applied or not.
 */
import {
  SYNCED_COLLECTIONS,
  applyToCollection,
  emptySynced,
  getRecord,
  isCollection,
  isSafeId,
  parseIncoming,
  recordKey,
  sameRecord,
  type CollectionName,
  type RecordChange,
  type SyncedState,
} from "@/lib/sync/collections";
import { allRecords, type Change, type Outbox } from "@/lib/sync/outbox";

export interface RemoteRow {
  collection: string;
  id: string;
  data: unknown;
  deleted: boolean;
  seq: number;
}

/** One page from the `pull_household_records` RPC. */
export interface PullPage {
  rows: RemoteRow[];
  /** Safe to resume after: never past a row whose write might still commit. */
  cursor: number;
  /** More settled rows may follow straight away. */
  more: boolean;
  /** Rows the server sent (before dropping malformed ones) and the highest seq among them. */
  count: number;
  lastSeq: number;
}

/** Read the RPC's JSON defensively; malformed rows are dropped, a malformed page is an error. */
export function parsePullPage(data: unknown): PullPage {
  const d = data as { rows?: unknown; cursor?: unknown; more?: unknown } | null;
  if (!d || typeof d !== "object" || !Array.isArray(d.rows)) throw new Error("Unexpected reply from the sync server");
  const rows: RemoteRow[] = [];
  let lastSeq = 0;
  for (const r of d.rows as Array<Partial<RemoteRow> | null>) {
    const seq = Number(r?.seq);
    if (!r || !Number.isFinite(seq)) continue;
    lastSeq = Math.max(lastSeq, seq);
    if (typeof r.collection !== "string" || typeof r.id !== "string") continue;
    rows.push({ collection: r.collection, id: r.id, data: r.data ?? null, deleted: r.deleted === true, seq });
  }
  const cursor = Number(d.cursor);
  return { rows, cursor: Number.isFinite(cursor) ? cursor : 0, more: d.more === true, count: d.rows.length, lastSeq };
}

export interface ApplyResult {
  /** Collections to set on the store; empty when nothing changed. */
  patch: Partial<SyncedState>;
  cursor: number;
  /** Records changed locally. */
  applied: number;
  /** Keys of every record the server knows about in these rows (alive or deleted). */
  seen: Set<string>;
}

export function applyRemote(state: SyncedState, rows: RemoteRow[], outbox: Outbox, cursor: number): ApplyResult {
  const byCollection = new Map<CollectionName, RecordChange[]>();
  const seen = new Set<string>();
  let next = cursor;
  let applied = 0;
  for (const row of rows) {
    if (row.seq > next) next = row.seq;
    if (!isCollection(row.collection) || !isSafeId(row.id)) continue;
    const c = row.collection;
    const key = recordKey(c, row.id);
    seen.add(key);
    if (outbox[key]) continue;
    const current = getRecord(state, c, row.id);
    let value: unknown | null;
    if (row.deleted) {
      if (current === undefined) continue;
      value = null;
    } else {
      value = parseIncoming(c, row.id, row.data);
      if (value === null || sameRecord(current, value)) continue;
    }
    const list = byCollection.get(c) ?? [];
    // Rows arrive in seq order; a later row for the same record supersedes an earlier one.
    const existing = list.findIndex((x) => x.id === row.id);
    if (existing >= 0) list.splice(existing, 1);
    list.push({ id: row.id, value });
    byCollection.set(c, list);
  }
  let working: SyncedState = state;
  let patch: Partial<SyncedState> = {};
  for (const c of SYNCED_COLLECTIONS) {
    const changes = byCollection.get(c);
    if (!changes?.length) continue;
    applied += changes.length;
    const p = applyToCollection(working, c, changes);
    working = { ...working, ...p };
    patch = { ...patch, ...p };
  }
  return { patch, cursor: next, applied, seen };
}

/**
 * "Bring the food on this device": after pulling everything the household has (household wins
 * where both have the same record, e.g. the built-in fridge or the profile), these are the
 * local records the household has never seen, to upload.
 */
export function localOnly(state: SyncedState, seen: Set<string>): Change[] {
  return allRecords(state, (c, id) => seen.has(recordKey(c, id)));
}

/** "Start fresh with the household's food": the synced collections, emptied. */
export const replacedState = (): SyncedState => emptySynced();

/** Whether there's anything worth asking about before joining (food, list, history, recipes…). */
export function hasLocalData(state: SyncedState): boolean {
  return (
    state.items.length > 0 ||
    state.shoppingList.length > 0 ||
    state.savedRecipes.length > 0 ||
    state.mealPlan.length > 0 ||
    state.events.length > 0
  );
}
