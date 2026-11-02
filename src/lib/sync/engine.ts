"use client";

/**
 * The sync engine: the IO around the pure logic in collections/outbox/apply.
 *
 * Push: every local change to a synced collection is diffed by id and queued in a persisted
 * outbox (`larder-sync`). The outbox is flushed ~600 ms after the last change, when the device
 * comes back online and when the app comes to the front, in batches of 200 upserts. Entries
 * leave the outbox only once the server has them, so nothing is lost offline. A record the
 * server can never take (too big, or refused as data) is set aside as "failed" rather than
 * blocking everything behind it.
 *
 * Pull: the `pull_household_records` RPC returns rows with `seq` above the cursor, in seq order,
 * 500 at a time, applied to the store under an `applying` guard so they aren't queued straight
 * back up. Realtime only says "something changed"; each event runs the same incremental pull,
 * which keeps ordering simple.
 *
 * Network work is serialised in this tab and, through the Web Locks API, across tabs, so two
 * tabs never send the same outbox at once.
 */
import type { RealtimeChannel, Session } from "@supabase/supabase-js";
import { DEFAULT_LOCATIONS, isRehydratingFromOtherTab, useLarder, type LarderState } from "@/lib/store";
import { getSupabase, type LarderClient } from "@/lib/supabase/client";
import { applyRemote, localOnly, parsePullPage, replacedState } from "@/lib/sync/apply";
import { sameRecord, type SyncedState } from "@/lib/sync/collections";
import {
  ack,
  allRecords,
  diffState,
  emptyMeta,
  enqueue,
  nextBatch,
  parseMeta,
  pendingCount,
  prepareBatch,
  quarantine,
  requeueFailed,
  type OutboxEntry,
  type RecordRow,
  type SyncMeta,
} from "@/lib/sync/outbox";
import { syncStatusStore, type SyncState } from "@/lib/sync/status";

export const SYNC_STORAGE_KEY = "larder-sync";
const BATCH = 200;
const PAGE = 500;
const FLUSH_DELAY = 600;
/** Web Lock held while a tab talks to the server. */
const LOCK_NAME = "larder-sync";

export type BindMode =
  /** New household: upload everything on this device. */
  | "upload"
  /** Joining: keep this device's food and add the household's (household wins on the same record). */
  | "merge"
  /** Joining: drop this device's synced data and take the household's. */
  | "replace";

class SyncError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly offline = false,
  ) {
    super(message);
  }
}

const isNetworkError = (e: unknown) =>
  e instanceof TypeError || (e instanceof Error && /fetch|network|load failed/i.test(e.message));

function friendly(e: unknown): SyncError {
  if (e instanceof SyncError) return e;
  if (typeof navigator !== "undefined" && !navigator.onLine) return new SyncError("You're offline", undefined, true);
  if (isNetworkError(e)) return new SyncError("Couldn't reach the sync server", undefined, true);
  const err = e as { message?: string; code?: string };
  return new SyncError(err?.message || "Something went wrong while syncing", err?.code);
}

/** Postgres data (22xxx) and integrity (23xxx) errors: the rows are the problem, not the network. */
const isRowError = (e: unknown) => /^2[23]/.test(String((e as { code?: unknown } | null)?.code ?? ""));

/** Run with the cross-tab sync lock where the browser has one; otherwise just run. */
function withSyncLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) return task();
  // The lock is held until the task settles (the callback's promise).
  return new Promise<T>((resolve, reject) => {
    void locks.request(LOCK_NAME, () => task().then(resolve, reject)).catch(reject);
  });
}

function readMeta(): SyncMeta {
  try {
    return parseMeta(localStorage.getItem(SYNC_STORAGE_KEY));
  } catch {
    return emptyMeta();
  }
}

export class SyncEngine {
  private meta: SyncMeta = emptyMeta();
  private session: Session | null = null;
  private applying = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private pullTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private resubscribeTimer: ReturnType<typeof setTimeout> | undefined;
  private retryDelay = 2000;
  private channel: RealtimeChannel | null = null;
  private channelFor: string | null = null;
  private active = 0;
  private lastError: SyncError | null = null;
  private notice: string | null = null;
  private ready = false;
  private verified: string | null = null;
  private cleanups: Array<() => void> = [];
  /** What this tab last wrote to storage, and whether that write worked. */
  private written: string | null = null;
  private writeOk = true;

  constructor(private readonly client: LarderClient) {}

  /* ---------- Lifecycle ---------- */

  start() {
    this.meta = readMeta();
    this.cleanups.push(useLarder.subscribe((next, prev) => this.onStoreChange(next, prev)));

    const { data } = this.client.auth.onAuthStateChange((event, session) => {
      // Supabase warns against awaiting other calls inside this callback; defer the work.
      setTimeout(() => this.onSession(session), 0);
    });
    this.cleanups.push(() => data.subscription.unsubscribe());
    void this.client.auth.getSession().then(({ data: d }) => this.onSession(d.session));

    const wake = () => {
      if (document.visibilityState === "hidden") return;
      this.kick();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SYNC_STORAGE_KEY) return;
      // Another tab changed the binding or the outbox.
      this.meta = parseMeta(e.newValue);
      this.written = e.newValue;
      this.reconcile();
    };
    window.addEventListener("online", wake);
    window.addEventListener("offline", wake);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("storage", onStorage);
    this.cleanups.push(() => {
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", wake);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("storage", onStorage);
    });
    this.publish();
  }

  stop() {
    this.cleanups.forEach((f) => f());
    this.cleanups = [];
    this.closeChannel();
    clearTimeout(this.flushTimer);
    clearTimeout(this.pullTimer);
    clearTimeout(this.retryTimer);
    clearTimeout(this.resubscribeTimer);
  }

  private get householdId() {
    return this.meta.householdId;
  }

  private get syncing() {
    return Boolean(this.session && this.meta.householdId && this.meta.userId === this.session.user.id);
  }

  private save(meta: SyncMeta) {
    this.meta = meta;
    const raw = JSON.stringify(meta);
    this.written = raw;
    try {
      localStorage.setItem(SYNC_STORAGE_KEY, raw);
      this.writeOk = true;
    } catch {
      /* storage full: the outbox stays in memory for this session */
      this.writeOk = false;
    }
    this.publish();
  }

  /**
   * Pick up what another tab saved while this one waited for the lock (its storage event may
   * not have arrived yet). Skipped when our own last save failed: memory is newer then.
   */
  private refreshMeta() {
    if (!this.writeOk) return;
    try {
      const raw = localStorage.getItem(SYNC_STORAGE_KEY);
      if (raw !== null && raw !== this.written) {
        this.meta = parseMeta(raw);
        this.written = raw;
      }
    } catch {
      /* unreadable: keep what's in memory */
    }
  }

  private onSession(session: Session | null) {
    const prevUser = this.session?.user.id;
    this.session = session;
    this.ready = true;
    if (session && this.meta.householdId && this.meta.userId && this.meta.userId !== session.user.id) {
      // A different account signed in on this device: don't send its changes to the old household.
      // (Signing out through the app flushes and asks first; this only catches other routes.)
      const dropped = pendingCount(this.meta);
      this.save({ ...emptyMeta() });
      if (dropped > 0) {
        this.notice = `A different account signed in, so ${dropped} change${dropped === 1 ? "" : "s"} that hadn't synced to the previous household won't be sent. Your food is still on this device.`;
      }
    }
    if (session?.user.id !== prevUser) this.verified = null;
    this.reconcile();
  }

  /** Bring realtime and timers in line with the current session and binding. */
  private reconcile() {
    if (!this.syncing) {
      this.closeChannel();
      this.publish();
      return;
    }
    const hid = this.householdId!;
    if (this.verified !== hid) {
      this.verified = hid;
      void this.verifyMembership(hid);
    }
    if (this.channelFor !== hid) this.openChannel(hid);
    this.kick();
  }

  /** Flush and pull now (coming online, focus, start). */
  kick() {
    if (!this.syncing || !navigator.onLine) return this.publish();
    clearTimeout(this.retryTimer);
    void this.run(() => this.flushAll());
    void this.run(() => this.pullNow());
  }

  /* ---------- Local changes ---------- */

  private onStoreChange(next: LarderState, prev: LarderState) {
    if (this.applying > 0 || isRehydratingFromOtherTab()) return;
    if (!this.meta.householdId) return;
    const changes = diffState(prev, next);
    if (changes.length === 0) return;
    this.save(enqueue(this.meta, changes));
    this.scheduleFlush();
  }

  private scheduleFlush() {
    clearTimeout(this.flushTimer);
    if (!this.syncing) return;
    this.flushTimer = setTimeout(() => void this.run(() => this.flushAll()), FLUSH_DELAY);
  }

  private applyToStore(patch: Partial<SyncedState>) {
    if (Object.keys(patch).length === 0) return;
    this.applying++;
    try {
      useLarder.setState(patch);
    } finally {
      this.applying--;
    }
  }

  /* ---------- Serialised network work ---------- */

  private run<T>(task: () => Promise<T>): Promise<T | undefined> {
    const p = this.queue.then(async () => {
      this.active++;
      this.publish();
      try {
        const r = await withSyncLock(() => {
          this.refreshMeta();
          return task();
        });
        this.onSuccess();
        return r;
      } catch (e) {
        this.onFailure(friendly(e));
        return undefined;
      } finally {
        this.active--;
        this.publish();
      }
    });
    this.queue = p.catch(() => undefined);
    return p;
  }

  private onSuccess() {
    this.lastError = null;
    this.retryDelay = 2000;
  }

  private onFailure(err: SyncError) {
    this.lastError = err;
    if (err.code === "42501" && this.householdId) void this.verifyMembership(this.householdId);
    clearTimeout(this.retryTimer);
    if (!this.syncing) return;
    // Offline: wait for the `online` event (plus a slow retry in case it never fires).
    const delay = err.offline ? Math.max(this.retryDelay, 30_000) : this.retryDelay;
    this.retryDelay = Math.min(this.retryDelay * 2, 60_000);
    this.retryTimer = setTimeout(() => this.kick(), delay);
  }

  private async flushAll() {
    while (this.syncing && pendingCount(this.meta) > 0) {
      const hid = this.householdId!;
      const batch = prepareBatch(nextBatch(this.meta, BATCH), useLarder.getState(), hid);
      if (batch.tooLarge.length) this.save(quarantine(this.meta, batch.tooLarge, "too-large"));
      if (!(await this.send(hid, batch.entries, batch.rows))) return;
    }
  }

  /**
   * Upsert one batch. When the database refuses it as data (22xxx/23xxx), halve it until the bad
   * rows are found, set those aside, and send the rest. Anything else (offline, 5xx, limits)
   * throws for the usual backoff. False when the binding changed while a request was out.
   */
  private async send(hid: string, entries: OutboxEntry[], rows: RecordRow[]): Promise<boolean> {
    if (rows.length === 0) return true;
    const { error } = await this.client.from("household_records").upsert(rows, {
      onConflict: "household_id,collection,id",
    });
    if (this.householdId !== hid) return false;
    if (error) {
      if (!isRowError(error)) throw error;
      if (rows.length === 1) {
        this.save(quarantine(this.meta, entries, "rejected"));
        return true;
      }
      const mid = Math.ceil(rows.length / 2);
      return (await this.send(hid, entries.slice(0, mid), rows.slice(0, mid))) && this.send(hid, entries.slice(mid), rows.slice(mid));
    }
    this.save({ ...ack(this.meta, entries), lastSyncedAt: new Date().toISOString() });
    return true;
  }

  /**
   * Pull everything after the cursor, a page at a time. The RPC's cursor never moves past a row
   * whose write might still be joined by an earlier, slower one, so recent rows come back on the
   * next pull (applying a row twice changes nothing).
   *
   * A full page whose tail isn't settled yet still reads on (from the last row seen) so the pull
   * reaches the end, but the saved cursor stays at the last settled point.
   *
   * While a merge is owed, it reads from the start; once it reaches the end, the local-only
   * records are queued to go up.
   */
  private async pullNow() {
    if (!this.syncing) return;
    const hid = this.householdId!;
    const merging = this.meta.pendingMerge;
    const seen = merging ? new Set<string>() : undefined;
    let after = merging ? 0 : this.meta.cursor;
    let cursor = this.meta.cursor;
    let settled = true;
    for (;;) {
      const { data, error } = await this.client.rpc("pull_household_records", { hid, after_seq: after, max_rows: PAGE });
      if (error) throw error;
      if (this.householdId !== hid) return;
      const page = parsePullPage(data);
      const result = applyRemote(useLarder.getState(), page.rows, this.meta.outbox, after);
      this.applyToStore(result.patch);
      result.seen.forEach((k) => seen?.add(k));
      if (settled) cursor = Math.max(cursor, page.cursor);
      if (page.cursor < page.lastSeq) settled = false;
      this.save({ ...this.meta, cursor, lastSyncedAt: new Date().toISOString() });
      if (!page.more && page.count < PAGE) break;
      if (page.lastSeq <= after) break; // Nothing new: don't spin.
      after = page.lastSeq;
    }
    if (seen && this.meta.pendingMerge) this.finishMerge(seen);
  }

  /** The household's records are all here: queue what only this device has. */
  private finishMerge(seen: Set<string>) {
    const state = useLarder.getState();
    // Built-in spots the household doesn't have yet are identical everywhere; skip them.
    const fresh = localOnly(state, seen).filter(
      (ch) =>
        !(ch.c === "locations" && DEFAULT_LOCATIONS.some((d) => d.id === ch.id && sameRecord(d, state.locations.find((l) => l.id === ch.id)))),
    );
    this.save({ ...enqueue(this.meta, fresh), pendingMerge: false });
    this.scheduleFlush();
  }

  private schedulePull() {
    clearTimeout(this.pullTimer);
    this.pullTimer = setTimeout(() => void this.run(() => this.pullNow()), 150);
  }

  /* ---------- Realtime ---------- */

  private openChannel(hid: string) {
    this.closeChannel();
    this.channelFor = hid;
    const channel = this.client
      .channel(`household-records:${hid}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "household_records", filter: `household_id=eq.${hid}` },
        () => this.schedulePull(),
      );
    channel.subscribe((status) => {
      if (this.channel !== channel) return;
      if (status === "SUBSCRIBED") {
        // Catch up on anything missed while disconnected.
        this.schedulePull();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        clearTimeout(this.resubscribeTimer);
        this.resubscribeTimer = setTimeout(() => {
          if (this.channel === channel && this.syncing) this.openChannel(hid);
        }, 5000);
      }
    });
    this.channel = channel;
  }

  private closeChannel() {
    clearTimeout(this.resubscribeTimer);
    const ch = this.channel;
    this.channel = null;
    this.channelFor = null;
    if (ch) void this.client.removeChannel(ch);
  }

  /* ---------- Membership ---------- */

  /** If this account is no longer in the bound household (left elsewhere, removed), stop syncing. */
  private async verifyMembership(hid: string) {
    const uid = this.session?.user.id;
    if (!uid) return;
    const { data, error } = await this.client
      .from("household_members")
      .select("household_id, households(name)")
      .eq("household_id", hid)
      .eq("user_id", uid)
      .maybeSingle();
    if (error || this.householdId !== hid) return; // Offline or changed: try again later.
    if (!data) {
      const name = this.meta.householdName;
      this.unbind();
      this.notice = `You're no longer in ${name ? `“${name}”` : "that household"}, so this device has stopped syncing. Your food is still here.`;
      this.publish();
      return;
    }
    const name = (data.households as { name: string } | null)?.name ?? null;
    if (name && name !== this.meta.householdName) this.save({ ...this.meta, householdName: name });
  }

  /* ---------- Binding (account screen) ---------- */

  /**
   * Start syncing this device with a household.
   * - upload: everything here goes up (a brand-new household).
   * - merge: pull everything the household has (it wins on shared records such as the built-in
   *   spots and the household profile), then upload what only this device has. The owed merge
   *   is persisted (`pendingMerge`), so if the first pull fails a later one finishes it.
   * - replace: clear this device's synced data, then pull everything.
   */
  async bind(householdId: string, householdName: string | null, mode: BindMode) {
    const uid = this.session?.user.id;
    if (!uid) throw new SyncError("Sign in first");
    clearTimeout(this.flushTimer);
    this.notice = null;
    this.verified = householdId;
    if (mode === "replace") this.applyToStore(replacedState());
    this.save({ ...emptyMeta(), householdId, householdName, userId: uid, pendingMerge: mode === "merge" });
    if (mode === "upload") {
      this.save(enqueue(this.meta, allRecords(useLarder.getState())));
    }
    if (this.channelFor !== householdId) this.openChannel(householdId);
    let failure: SyncError | null = null;
    const task = async () => {
      try {
        // The cursor starts at 0, so this reads everything (and finishes a merge).
        if (mode !== "upload") await this.pullNow();
        await this.flushAll();
        if (mode === "upload") await this.pullNow();
      } catch (e) {
        failure = friendly(e);
        throw e;
      }
    };
    await this.run(task);
    // The binding stands either way; the outbox and cursor make a retry pick up where it stopped.
    if (failure) throw failure;
  }

  /**
   * Try to send queued changes now, before something that would drop them (signing out,
   * leaving, switching household). Resolves to how many are still unsent.
   */
  async flushPending(): Promise<number> {
    if (this.syncing && navigator.onLine && pendingCount(this.meta) > 0) await this.run(() => this.flushAll());
    return this.syncing ? pendingCount(this.meta) : 0;
  }

  /** Put changes that failed back in the queue (after the record was trimmed, say). */
  retryFailed() {
    if (!this.meta.failed.length) return;
    this.save(requeueFailed(this.meta));
    this.scheduleFlush();
  }

  /** Forget about changes that failed; they stay on this device only. */
  clearFailed() {
    if (!this.meta.failed.length) return;
    this.save({ ...this.meta, failed: [] });
  }

  /** Stop syncing on this device. Local data stays; queued changes are dropped. */
  unbind() {
    clearTimeout(this.flushTimer);
    clearTimeout(this.retryTimer);
    this.closeChannel();
    this.verified = null;
    this.lastError = null;
    this.save(emptyMeta());
  }

  async signOut() {
    this.unbind();
    // Local scope: other devices signed in to this account stay signed in.
    await this.client.auth.signOut({ scope: "local" });
  }

  /**
   * Keep the household's name (shown on invites and to members) in step with the name in
   * Settings. Only the person who started the household can rename it; for others this is a
   * no-op (row-level security matches no rows).
   */
  async renameHousehold(name: string) {
    const hid = this.householdId;
    const trimmed = name.trim().slice(0, 80);
    if (!this.syncing || !hid || !trimmed || trimmed === this.meta.householdName) return;
    const { data, error } = await this.client.from("households").update({ name: trimmed }).eq("id", hid).select("name");
    if (!error && data?.length && this.householdId === hid) this.save({ ...this.meta, householdName: data[0].name });
  }

  clearNotice() {
    this.notice = null;
    this.publish();
  }

  /** Try again now (the "Sync now" button). */
  syncNow() {
    this.retryDelay = 2000;
    this.kick();
  }

  /* ---------- Status ---------- */

  private publish() {
    const pending = pendingCount(this.meta);
    const online = typeof navigator === "undefined" || navigator.onLine;
    let state: SyncState;
    if (!this.session) state = "signed-out";
    else if (!this.syncing) state = "no-household";
    else if (!online || this.lastError?.offline) state = "offline";
    else if (this.lastError) state = "error";
    // Background pulls don't flip the status; only unsent changes or the first sync do.
    else if (pending > 0 || (this.active > 0 && !this.meta.lastSyncedAt)) state = "syncing";
    else state = "synced";
    syncStatusStore.setState({
      state,
      ready: this.ready,
      pending,
      lastSyncedAt: this.meta.lastSyncedAt,
      error: this.lastError?.message ?? null,
      userId: this.session?.user.id ?? null,
      email: this.session?.user.email ?? null,
      householdId: this.syncing ? this.meta.householdId : null,
      householdName: this.syncing ? this.meta.householdName : null,
      failed: this.syncing ? this.meta.failed : [],
      notice: this.notice,
    });
  }
}

let engine: SyncEngine | null = null;

/** The running engine for this tab, or null when Supabase isn't configured. */
export function getSyncEngine(): SyncEngine | null {
  if (engine) return engine;
  const client = getSupabase();
  if (!client) return null;
  engine = new SyncEngine(client);
  engine.start();
  return engine;
}
