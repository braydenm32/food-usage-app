/**
 * The engine against an in-memory fake of the Supabase calls it makes: echo suppression,
 * offline retries, outbox-wins, the merge/replace join modes, poison rows and the
 * commit-safe pull cursor.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftItem } from "@/lib/types";

/* ---------- Browser stubs (the engine and store are client code) ---------- */

const mem = new Map<string, string>();
const listeners = new Map<string, Set<(e: unknown) => void>>();
const target = {
  addEventListener: (t: string, f: (e: unknown) => void) => (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(f),
  removeEventListener: (t: string, f: (e: unknown) => void) => listeners.get(t)?.delete(f),
};
let online = true;
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});
vi.stubGlobal("window", target);
vi.stubGlobal("document", { ...target, visibilityState: "visible" });
vi.stubGlobal("navigator", {
  get onLine() {
    return online;
  },
});

/* ---------- Fake server ---------- */

interface Row {
  household_id: string;
  collection: string;
  id: string;
  data: unknown;
  deleted: boolean;
  seq: number;
}

class FakeServer {
  rows = new Map<string, Row>();
  seq = 0;
  failUpserts = 0;
  /** Pulls fail (network) while this is above zero. */
  failPulls = 0;
  upsertCalls = 0;
  /** after_seq of each pull, in order. */
  pullCalls: number[] = [];
  /** Refuse a whole upsert as data (like a check constraint) when any row matches. */
  rejectRow: ((r: Omit<Row, "seq">) => boolean) | null = null;
  /** Rows above this seq count as "not settled yet" (written under a minute ago). */
  settledUpTo = Infinity;
  onChange: (() => void) | null = null;
  write(r: Omit<Row, "seq">) {
    const row = { ...r, data: r.deleted ? null : JSON.parse(JSON.stringify(r.data)), seq: ++this.seq };
    this.rows.set(`${r.household_id}/${r.collection}/${r.id}`, row);
  }
  all(hid: string) {
    return [...this.rows.values()].filter((r) => r.household_id === hid);
  }
}

const USER = { id: "user-1", email: "sam@example.com" };

function fakeClient(server: FakeServer) {
  const session = { user: USER } as never;
  const query = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let limit = Infinity;
    const q = {
      select: () => q,
      eq: (col: string, v: unknown) => (filters.push((r) => (r as unknown as Record<string, unknown>)[col] === v), q),
      gt: (col: string, v: number) => (filters.push((r) => (r as unknown as Record<string, number>)[col] > v), q),
      order: () => q,
      limit: (n: number) => ((limit = n), q),
      maybeSingle: async () => ({ data: { household_id: "h1", households: { name: "The Lees" } }, error: null }),
      upsert: async (rows: Omit<Row, "seq">[]) => {
        server.upsertCalls++;
        if (server.failUpserts > 0) {
          server.failUpserts--;
          throw new TypeError("Failed to fetch");
        }
        if (server.rejectRow && rows.some(server.rejectRow)) {
          return { error: { code: "23514", message: "new row violates check constraint" } };
        }
        rows.forEach((r) => server.write(r));
        server.onChange?.();
        return { error: null };
      },
      then: (resolve: (v: unknown) => void) => {
        const data = [...server.rows.values()]
          .filter((r) => filters.every((f) => f(r)))
          .sort((a, b) => a.seq - b.seq)
          .slice(0, limit);
        resolve({ data: table === "household_records" ? data : [], error: null });
      },
    };
    return q;
  };
  const channel = {
    on: () => channel,
    subscribe: () => channel,
  };
  /** Same contract as `pull_household_records` in the harden migration. */
  const rpc = async (fn: string, args: { hid: string; after_seq: number; max_rows: number }) => {
    if (fn !== "pull_household_records") return { data: null, error: { message: `unknown rpc ${fn}` } };
    if (server.failPulls > 0) {
      server.failPulls--;
      throw new TypeError("Failed to fetch");
    }
    server.pullCalls.push(args.after_seq);
    const page = server
      .all(args.hid)
      .filter((r) => r.seq > args.after_seq)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, args.max_rows);
    const settled = page.filter((r) => r.seq <= server.settledUpTo).map((r) => r.seq);
    const settledMax = settled.length ? Math.max(...settled) : 0;
    const last = page.length ? page[page.length - 1].seq : 0;
    return {
      data: {
        rows: page.map(({ collection, id, data, deleted, seq }) => ({ collection, id, data, deleted, seq })),
        cursor: Math.max(settledMax, args.after_seq),
        more: page.length === args.max_rows && settledMax === last,
        server_time: new Date().toISOString(),
      },
      error: null,
    };
  };
  return {
    rpc,
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session } }),
      signOut: async () => ({ error: null }),
    },
    from: query,
    channel: () => channel,
    removeChannel: async () => "ok",
  };
}

/* ---------- Harness ---------- */

type Store = typeof import("@/lib/store");
type Engine = typeof import("./engine");
let store: Store;
let eng: Engine;

beforeAll(async () => {
  store = await import("@/lib/store");
  eng = await import("./engine");
});

const draft = (name: string): DraftItem => ({
  key: name,
  name,
  foodTypeId: null,
  emoji: "🥕",
  locationId: "fridge",
  quantity: 1,
  unit: "item",
  dateKind: "best-before",
  include: true,
});

/** A complete item as another device would have written it. */
const remoteItem = (id: string, name: string) => ({
  id,
  name,
  foodTypeId: null,
  emoji: "🧀",
  locationId: "fridge",
  quantity: 1,
  initialQuantity: 1,
  unit: "item",
  addedAt: "2026-10-01T00:00:00.000Z",
  dateKind: "best-before",
  source: "manual",
});

let server: FakeServer;
let engine: InstanceType<Engine["SyncEngine"]>;
const s = () => store.useLarder.getState();
const meta = () => JSON.parse(mem.get("larder-sync") ?? "{}");
const settle = async (ms = 1000) => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(async () => {
  vi.useFakeTimers();
  online = true;
  mem.clear();
  s().resetAll();
  server = new FakeServer();
  engine = new eng.SyncEngine(fakeClient(server) as never);
  engine.start();
  await settle(10);
});

afterEach(() => {
  engine.stop();
  vi.useRealTimers();
});

describe("SyncEngine", () => {
  it("uploads everything when starting a household, then pushes edits", async () => {
    s().addItems([draft("Milk")], "manual");
    await engine.bind("h1", "The Lees", "upload");
    const names = server.all("h1").filter((r) => r.collection === "items").map((r) => (r.data as { name: string }).name);
    expect(names).toEqual(["Milk"]);
    expect(server.all("h1").some((r) => r.collection === "profile")).toBe(true);
    expect(meta().outbox).toEqual({});

    const id = s().items[0].id;
    s().updateItem(id, { quantity: 3 });
    expect(Object.keys(meta().outbox)).toEqual([`items:${id}`]);
    await settle();
    expect((server.rows.get(`h1/items/${id}`)!.data as { quantity: number }).quantity).toBe(3);
    expect(meta().outbox).toEqual({});
  });

  it("applies remote changes without echoing them back", async () => {
    await engine.bind("h1", "The Lees", "upload");
    const calls = server.upsertCalls;
    server.write({
      household_id: "h1",
      collection: "items",
      id: "remote-1",
      data: { ...remoteItem("remote-1", "Bread"), unit: "loaf", locationId: "pantry" },
      deleted: false,
    });
    engine.syncNow();
    await settle();
    expect(s().items.map((i) => i.name)).toContain("Bread");
    expect(meta().outbox).toEqual({});
    expect(server.upsertCalls).toBe(calls);

    // Deleted elsewhere: removed here, still no echo.
    server.write({ household_id: "h1", collection: "items", id: "remote-1", data: null, deleted: true });
    engine.syncNow();
    await settle();
    expect(s().items).toHaveLength(0);
    expect(server.upsertCalls).toBe(calls);
    expect(meta().cursor).toBe(server.seq);
  });

  it("keeps local writes made offline and sends them when back", async () => {
    await engine.bind("h1", "The Lees", "upload");
    online = false;
    server.failUpserts = 1;
    s().addItems([draft("Eggs")], "manual");
    await settle();
    const id = s().items[0].id;
    expect(Object.keys(meta().outbox)).toContain(`items:${id}`);
    // A remote copy of the same record must not overwrite the unsent local one.
    server.write({ household_id: "h1", collection: "items", id, data: { ...s().items[0], name: "Old eggs" }, deleted: false });
    online = true;
    engine.syncNow();
    await settle(3000);
    expect(s().items[0].name).toBe("Eggs");
    expect((server.rows.get(`h1/items/${id}`)!.data as { name: string }).name).toBe("Eggs");
    expect(meta().outbox).toEqual({});
  });

  it("undo produces changes that sync like any other", async () => {
    await engine.bind("h1", "The Lees", "upload");
    s().addItems([draft("Yoghurt")], "manual");
    await settle();
    const id = s().items[0].id;
    s().consumeItem(id, "all", "binned");
    await settle();
    expect(server.rows.get(`h1/items/${id}`)!.deleted).toBe(true);
    s().performUndo();
    await settle();
    expect(server.rows.get(`h1/items/${id}`)!.deleted).toBe(false);
    const binned = server.all("h1").filter((r) => r.collection === "events" && (r.data as { type?: string } | null)?.type === "binned");
    expect(binned).toHaveLength(0);
  });

  it("merge: keeps this device's food, adds the household's, and uploads only what's new", async () => {
    server.write({ household_id: "h2", collection: "items", id: "theirs", data: remoteItem("theirs", "Their cheese"), deleted: false });
    server.write({
      household_id: "h2",
      collection: "profile",
      id: "profile",
      data: { ...store.DEFAULT_PROFILE, householdName: "Their place" },
      deleted: false,
    });
    s().addItems([draft("My apples")], "manual");
    s().setProfile({ householdName: "Mine" });
    await engine.bind("h2", "Their place", "merge");
    expect(s().items.map((i) => i.name).sort()).toEqual(["My apples", "Their cheese"]);
    expect(s().profile.householdName).toBe("Their place");
    const up = server.all("h2").map((r) => `${r.collection}:${(r.data as { name?: string } | null)?.name ?? r.id}`);
    expect(up).toContain("items:My apples");
    expect(up.filter((x) => x.startsWith("profile"))).toHaveLength(1);
    expect((server.rows.get("h2/profile/profile")!.data as { householdName: string }).householdName).toBe("Their place");
  });

  it("replace: drops this device's synced data and takes the household's", async () => {
    server.write({ household_id: "h2", collection: "items", id: "theirs", data: remoteItem("theirs", "Their cheese"), deleted: false });
    s().addItems([draft("My apples")], "manual");
    s().setSettings({ useSoonDays: 5 });
    await engine.bind("h2", "Their place", "replace");
    expect(s().items.map((i) => i.name)).toEqual(["Their cheese"]);
    // Settings are per device and never touched.
    expect(s().settings.useSoonDays).toBe(5);
    expect(server.all("h2").some((r) => (r.data as { name?: string } | null)?.name === "My apples")).toBe(false);
  });

  it("stops syncing on unbind and leaves local data alone", async () => {
    await engine.bind("h1", "The Lees", "upload");
    s().addItems([draft("Rice")], "manual");
    engine.unbind();
    await settle();
    expect(s().items).toHaveLength(1);
    expect(server.all("h1").some((r) => r.collection === "items")).toBe(false);
    expect(meta().householdId).toBeNull();
  });
  it("pulls through the RPC and keeps the cursor behind rows that may not have settled", async () => {
    await engine.bind("h1", "The Lees", "upload");
    const settledSeq = server.seq;
    server.settledUpTo = settledSeq;
    server.write({ household_id: "h1", collection: "items", id: "r1", data: remoteItem("r1", "Bread"), deleted: false });
    engine.syncNow();
    await settle();
    // Applied straight away, but the cursor stays put so the row is read again next time.
    expect(s().items.map((i) => i.name)).toContain("Bread");
    expect(meta().cursor).toBe(settledSeq);
    server.settledUpTo = Infinity;
    server.pullCalls = [];
    engine.syncNow();
    await settle();
    expect(server.pullCalls[0]).toBe(settledSeq);
    expect(meta().cursor).toBe(server.seq);
  });

  it("reads past a full page whose tail hasn't settled, without moving the cursor past it", async () => {
    await engine.bind("h1", "The Lees", "upload");
    const start = server.seq;
    for (let i = 0; i < 600; i++) {
      server.write({ household_id: "h1", collection: "events", id: `e${i}`, data: { id: `e${i}`, itemId: "x", itemName: "X", foodTypeId: null, type: "used", at: "2026-10-01T00:00:00Z" }, deleted: false });
    }
    // Only the first 100 new rows have settled: the first page (500) ends unsettled.
    server.settledUpTo = start + 100;
    engine.syncNow();
    await settle();
    expect(s().events).toHaveLength(600);
    expect(meta().cursor).toBe(start + 100);
  });

  it("sets aside a record that's too large instead of blocking the rest", async () => {
    await engine.bind("h1", "The Lees", "upload");
    s().addItems([draft("Small"), draft("Big")], "manual");
    const big = s().items.find((i) => i.name === "Big")!;
    s().updateItem(big.id, { notes: "x".repeat(70_000) });
    await settle();
    expect(server.all("h1").some((r) => (r.data as { name?: string } | null)?.name === "Small")).toBe(true);
    expect(server.rows.has(`h1/items/${big.id}`)).toBe(false);
    expect(meta().outbox).toEqual({});
    expect(meta().failed).toEqual([{ c: "items", id: big.id, reason: "too-large" }]);
    const { syncStatusStore } = await import("./status");
    expect(syncStatusStore.getState().failed).toHaveLength(1);

    // Trimmed and tried again: it goes up and the failure clears.
    s().updateItem(big.id, { notes: "short" });
    await settle();
    expect(server.rows.has(`h1/items/${big.id}`)).toBe(true);
    expect(meta().failed).toEqual([]);
  });

  it("finds a row the database refuses by halving the batch, and sends the rest", async () => {
    await engine.bind("h1", "The Lees", "upload");
    server.rejectRow = (r) => (r.data as { name?: string } | null)?.name === "Bad";
    s().addItems(["A", "B", "Bad", "C", "D", "E"].map(draft), "manual");
    await settle();
    const names = server.all("h1").map((r) => (r.data as { name?: string } | null)?.name);
    expect(names).toEqual(expect.arrayContaining(["A", "B", "C", "D", "E"]));
    expect(names).not.toContain("Bad");
    expect(meta().outbox).toEqual({});
    expect(meta().failed).toHaveLength(1);
    expect(meta().failed[0]).toMatchObject({ c: "items", reason: "rejected" });
    // Not a network problem: no backoff, no error status.
    const { syncStatusStore } = await import("./status");
    expect(syncStatusStore.getState().state).toBe("synced");
  });

  it("merge: a failed first pull keeps the local-only upload owed until a pull completes", async () => {
    server.write({ household_id: "h2", collection: "items", id: "theirs", data: remoteItem("theirs", "Their cheese"), deleted: false });
    s().addItems([draft("My apples")], "manual");
    server.failPulls = 1;
    await expect(engine.bind("h2", "Their place", "merge")).rejects.toBeTruthy();
    expect(meta().pendingMerge).toBe(true);
    expect(server.all("h2").some((r) => (r.data as { name?: string } | null)?.name === "My apples")).toBe(false);

    // A reload in between must not lose it either.
    engine.stop();
    engine = new eng.SyncEngine(fakeClient(server) as never);
    engine.start();
    await settle(5000);
    expect(meta().pendingMerge).toBe(false);
    expect(s().items.map((i) => i.name).sort()).toEqual(["My apples", "Their cheese"]);
    expect(server.all("h2").some((r) => (r.data as { name?: string } | null)?.name === "My apples")).toBe(true);
  });

  it("skips invalid remote records instead of breaking the store", async () => {
    await engine.bind("h1", "The Lees", "upload");
    server.write({ household_id: "h1", collection: "items", id: "bad", data: { name: 42 }, deleted: false });
    server.write({ household_id: "h1", collection: "overrides", id: "__proto__", data: { fridgeDays: 1 }, deleted: false });
    server.write({ household_id: "h1", collection: "items", id: "ok", data: remoteItem("ok", "Bread"), deleted: false });
    engine.syncNow();
    await settle();
    expect(s().items.map((i) => i.id)).toEqual(["ok"]);
    expect(({} as Record<string, unknown>).fridgeDays).toBeUndefined();
    expect(meta().cursor).toBe(server.seq);
  });

  it("flushPending sends what's queued and reports what's left", async () => {
    await engine.bind("h1", "The Lees", "upload");
    s().addItems([draft("Tea")], "manual");
    expect(await engine.flushPending()).toBe(0);
    expect(server.all("h1").some((r) => (r.data as { name?: string } | null)?.name === "Tea")).toBe(true);
    server.failUpserts = 5;
    s().addItems([draft("Coffee")], "manual");
    // The item and its "added" event are still queued, and the caller is told so.
    const left = await engine.flushPending();
    expect(left).toBeGreaterThan(0);
    expect(left).toBe(Object.keys(meta().outbox).length);
  });
});
