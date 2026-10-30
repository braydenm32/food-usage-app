/**
 * The engine against an in-memory fake of the Supabase calls it makes: echo suppression,
 * offline retries, outbox-wins, and the merge/replace join modes.
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
  upsertCalls = 0;
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
  return {
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
      data: { ...s().items[0], id: "remote-1", name: "Bread", quantity: 1, unit: "loaf", locationId: "pantry" },
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
    server.write({ household_id: "h2", collection: "items", id: "theirs", data: { name: "Their cheese", id: "theirs" }, deleted: false });
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
    server.write({ household_id: "h2", collection: "items", id: "theirs", data: { name: "Their cheese", id: "theirs" }, deleted: false });
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
});
