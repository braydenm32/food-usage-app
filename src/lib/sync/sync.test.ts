import { describe, expect, it } from "vitest";
import { DEFAULT_LOCATIONS, DEFAULT_PROFILE, MAX_EVENTS } from "@/lib/store";
import type { ItemEvent, PantryItem, Recipe } from "@/lib/types";
import { applyRemote, hasLocalData, localOnly, parsePullPage, type RemoteRow } from "./apply";
import { emptySynced, parseIncoming, recordKey, type SyncedState } from "./collections";
import {
  MAX_RECORD_BYTES,
  ack,
  allRecords,
  buildRows,
  diffState,
  emptyMeta,
  enqueue,
  nextBatch,
  parseMeta,
  prepareBatch,
  quarantine,
  requeueFailed,
} from "./outbox";

const item = (id: string, p: Partial<PantryItem> = {}): PantryItem => ({
  id,
  name: `Item ${id}`,
  foodTypeId: null,
  emoji: "🥕",
  locationId: "fridge",
  quantity: 1,
  initialQuantity: 1,
  unit: "item",
  addedAt: "2026-10-01T00:00:00.000Z",
  dateKind: "best-before",
  source: "manual",
  ...p,
});

const event = (id: string, at: string): ItemEvent => ({ id, itemId: "x", itemName: "X", foodTypeId: null, type: "used", at });

const state = (p: Partial<SyncedState> = {}): SyncedState => ({ ...emptySynced(), ...p });

const row = (collection: string, id: string, data: unknown, seq: number, deleted = false): RemoteRow => ({
  collection,
  id,
  data: deleted ? null : data,
  deleted,
  seq,
});

describe("diffState", () => {
  it("finds adds, edits and deletes by id", () => {
    const a = item("a");
    const b = item("b");
    const prev = state({ items: [a, b] });
    const next = state({ items: [a, { ...b, quantity: 2 }, item("c")] });
    expect(diffState(prev, next)).toEqual([
      { c: "items", id: "b", op: "upsert" },
      { c: "items", id: "c", op: "upsert" },
    ]);
    expect(diffState(next, state({ items: [a] }))).toEqual([
      { c: "items", id: "b", op: "delete" },
      { c: "items", id: "c", op: "delete" },
    ]);
  });

  it("ignores untouched collections and records rebuilt with the same content", () => {
    const a = item("a");
    const prev = state({ items: [a] });
    expect(diffState(prev, { ...prev })).toEqual([]);
    // Rehydrating from storage rebuilds every object; same JSON means no change.
    expect(diffState(prev, state({ items: [JSON.parse(JSON.stringify(a))] }))).toEqual([]);
  });

  it("keys overrides by food type and the profile as one record", () => {
    const prev = state();
    const next = state({
      overrides: { milk: { foodTypeId: "milk", fridgeDays: 9 } },
      profile: { ...DEFAULT_PROFILE, people: 4 },
    });
    expect(diffState(prev, next)).toEqual([
      { c: "overrides", id: "milk", op: "upsert" },
      { c: "profile", id: "profile", op: "upsert" },
    ]);
    expect(diffState(next, { ...next, overrides: {} })).toEqual([{ c: "overrides", id: "milk", op: "delete" }]);
  });
});

describe("outbox", () => {
  it("collapses repeated changes to one entry with the newest op", () => {
    let m = enqueue(emptyMeta(), [{ c: "items", id: "a", op: "upsert" }]);
    m = enqueue(m, [{ c: "items", id: "a", op: "delete" }]);
    expect(Object.values(m.outbox)).toEqual([{ c: "items", id: "a", op: "delete", rev: 2 }]);
  });

  it("only clears entries that weren't edited again while sending", () => {
    let m = enqueue(emptyMeta(), [
      { c: "items", id: "a", op: "upsert" },
      { c: "items", id: "b", op: "upsert" },
    ]);
    const sent = nextBatch(m);
    m = enqueue(m, [{ c: "items", id: "b", op: "upsert" }]); // edited during the send
    m = ack(m, sent);
    expect(Object.keys(m.outbox)).toEqual([recordKey("items", "b")]);
  });

  it("batches oldest first, capped", () => {
    const changes = Array.from({ length: 450 }, (_, i) => ({ c: "events" as const, id: `e${i}`, op: "upsert" as const }));
    const m = enqueue(emptyMeta(), changes);
    const batch = nextBatch(m, 200);
    expect(batch).toHaveLength(200);
    expect(batch[0].id).toBe("e0");
    expect(batch[199].id).toBe("e199");
  });

  it("builds rows from current values; missing records go up as deletes", () => {
    const a = item("a", { quantity: 5 });
    const m = enqueue(emptyMeta(), [
      { c: "items", id: "a", op: "upsert" },
      { c: "items", id: "gone", op: "upsert" },
      { c: "profile", id: "profile", op: "upsert" },
    ]);
    const rows = buildRows(nextBatch(m), state({ items: [a] }), "h1");
    expect(rows[0]).toMatchObject({ household_id: "h1", collection: "items", id: "a", deleted: false, data: a });
    expect(rows[1]).toMatchObject({ collection: "items", id: "gone", deleted: true, data: null });
    expect(rows[2]).toMatchObject({ collection: "profile", id: "profile", data: DEFAULT_PROFILE });
  });

  it("survives a corrupt saved copy", () => {
    expect(parseMeta("{nope")).toEqual(emptyMeta());
    expect(parseMeta(JSON.stringify({ v: 1, householdId: "h", cursor: 7, outbox: {} })).cursor).toBe(7);
  });

  it("uploads everything for a new household", () => {
    const s = state({ items: [item("a")], events: [event("e1", "2026-10-01")] });
    const keys = allRecords(s).map((c) => `${c.c}:${c.id}`);
    expect(keys).toContain("items:a");
    expect(keys).toContain("events:e1");
    expect(keys).toContain("profile:profile");
    expect(keys).toContain("locations:fridge");
  });
});

describe("applyRemote", () => {
  it("adds, edits and deletes records and advances the cursor", () => {
    const a = item("a");
    const s = state({ items: [a, item("b")] });
    const r = applyRemote(
      s,
      [
        row("items", "a", { ...a, quantity: 3 }, 11),
        row("items", "b", null, 12, true),
        row("items", "c", item("c"), 13),
        row("shoppingList", "l1", { name: "Milk", foodTypeId: null, aisle: "Dairy, Eggs & Fridge", checked: false, addedAt: "2026-10-01T00:00:00Z" }, 14),
      ],
      {},
      10,
    );
    expect(r.cursor).toBe(14);
    expect(r.applied).toBe(4);
    expect(r.patch.items?.map((i) => [i.id, i.quantity])).toEqual([
      ["a", 3],
      ["c", 1],
    ]);
    expect(r.patch.shoppingList?.[0]).toMatchObject({ id: "l1", name: "Milk" });
  });

  it("keeps a local edit that is still waiting to go up (outbox wins)", () => {
    const local = item("a", { quantity: 9 });
    const outbox = enqueue(emptyMeta(), [{ c: "items", id: "a", op: "upsert" }]).outbox;
    const r = applyRemote(state({ items: [local] }), [row("items", "a", item("a", { quantity: 1 }), 20)], outbox, 19);
    expect(r.patch).toEqual({});
    expect(r.cursor).toBe(20);
    // A pending local delete isn't undone by an older remote copy either.
    const del = enqueue(emptyMeta(), [{ c: "items", id: "z", op: "delete" }]).outbox;
    expect(applyRemote(state(), [row("items", "z", item("z"), 21)], del, 20).patch).toEqual({});
  });

  it("does nothing for echoes of records it already has", () => {
    const a = item("a");
    const r = applyRemote(state({ items: [a] }), [row("items", "a", JSON.parse(JSON.stringify(a)), 5)], {}, 0);
    expect(r.patch).toEqual({});
    expect(r.applied).toBe(0);
    expect(r.cursor).toBe(5);
  });

  it("uses the last row when a record appears twice, and skips unknown collections", () => {
    const r = applyRemote(
      state(),
      [row("items", "a", item("a", { quantity: 1 }), 1), row("settings", "x", {}, 2), row("items", "a", item("a", { quantity: 2 }), 3)],
      {},
      0,
    );
    expect(r.patch.items).toHaveLength(1);
    expect(r.patch.items?.[0].quantity).toBe(2);
    expect(r.cursor).toBe(3);
  });

  it("keeps events in time order and within the cap", () => {
    const events = Array.from({ length: MAX_EVENTS }, (_, i) => event(`e${i}`, `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.${String(i).padStart(4, "0")}Z`));
    const r = applyRemote(state({ events }), [row("events", "new", event("new", "2027-01-01T00:00:00Z"), 1), row("events", "old", event("old", "2020-01-01T00:00:00Z"), 2)], {}, 0);
    expect(r.patch.events).toHaveLength(MAX_EVENTS);
    expect(r.patch.events?.at(-1)?.id).toBe("new");
    expect(r.patch.events?.some((e) => e.id === "old")).toBe(false);
  });

  it("orders saved recipes newest first", () => {
    const recipe = (id: string, savedAt: string) =>
      ({ id, title: id, source: "saved", servings: 2, ingredients: [], steps: [], tags: [], savedAt }) as Recipe;
    const r = applyRemote(state({ savedRecipes: [recipe("a", "2026-01-02")] }), [row("savedRecipes", "b", recipe("b", "2026-03-01"), 1)], {}, 0);
    expect(r.patch.savedRecipes?.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("tidies the profile and keeps the built-in spots", () => {
    const r = applyRemote(
      state(),
      [row("profile", "profile", { householdName: "The Lees", people: 3, diets: "junk" }, 1), row("locations", "fridge", null, 2, true)],
      {},
      0,
    );
    expect(r.patch.profile).toMatchObject({ householdName: "The Lees", people: 3, diets: [], allergies: [] });
    expect(r.patch.locations?.map((l) => l.id).sort()).toEqual(DEFAULT_LOCATIONS.map((l) => l.id).sort());
  });

  it("applies overrides by food type", () => {
    const r = applyRemote(state(), [row("overrides", "milk", { fridgeDays: 8 }, 1)], {}, 0);
    expect(r.patch.overrides).toEqual({ milk: { foodTypeId: "milk", fridgeDays: 8 } });
  });
});

describe("joining with food on this device", () => {
  it("merge: the household wins shared records, and only local-only records go up", () => {
    const mine = item("mine");
    const local = state({ items: [mine], profile: { ...DEFAULT_PROFILE, householdName: "Mine" } });
    const remote = [
      row("items", "theirs", item("theirs"), 1),
      row("profile", "profile", { ...DEFAULT_PROFILE, householdName: "Theirs" }, 2),
      row("items", "binned", null, 3, true),
    ];
    const r = applyRemote(local, remote, {}, 0);
    const merged = { ...local, ...r.patch };
    expect(merged.items.map((i) => i.id).sort()).toEqual(["mine", "theirs"]);
    expect(merged.profile.householdName).toBe("Theirs");
    const up = localOnly(merged, r.seen).map((c) => `${c.c}:${c.id}`);
    expect(up).toContain("items:mine");
    expect(up).not.toContain("items:theirs");
    expect(up).not.toContain("profile:profile");
  });

  it("replace: starts from empty and takes only the household's records", () => {
    const fresh = emptySynced();
    expect(hasLocalData(fresh)).toBe(false);
    const r = applyRemote(fresh, [row("items", "theirs", item("theirs"), 1)], {}, 0);
    expect({ ...fresh, ...r.patch }.items.map((i) => i.id)).toEqual(["theirs"]);
  });
});

describe("validating records from the server", () => {
  const at = "2026-10-01T00:00:00.000Z";

  it("drops items missing required fields or with the wrong types", () => {
    const good = item("a");
    expect(parseIncoming("items", "a", good)).toEqual(good);
    for (const bad of [
      { ...good, name: 7 },
      { ...good, locationId: undefined },
      { ...good, quantity: "2" },
      { ...good, quantity: Infinity },
      { ...good, unit: null },
      { ...good, addedAt: "not a date" },
      { ...good, dateKind: "eat-by" },
      { ...good, source: "magic" },
      "a string",
      [good],
      null,
    ]) {
      expect(parseIncoming("items", "a", bad)).toBeNull();
    }
  });

  it("keeps the record but drops optional fields with the wrong type", () => {
    const r = parseIncoming("items", "a", { ...item("a"), notes: { evil: true }, price: "free", printedDate: 12 }) as PantryItem;
    expect(r).not.toBeNull();
    expect(r.notes).toBeUndefined();
    expect(r.price).toBeUndefined();
    expect(r.printedDate).toBeUndefined();
  });

  it("takes the id from the row, not the data", () => {
    expect((parseIncoming("items", "a", { ...item("a"), id: "other" }) as PantryItem).id).toBe("a");
  });

  it("checks every collection", () => {
    expect(parseIncoming("events", "e", event("e", at))).not.toBeNull();
    expect(parseIncoming("events", "e", { ...event("e", at), type: "exploded" })).toBeNull();
    expect(parseIncoming("events", "e", { ...event("e", at), at: undefined })).toBeNull();

    expect(parseIncoming("locations", "shed", { name: "Shed", kind: "pantry" })).toEqual({ id: "shed", name: "Shed", kind: "pantry" });
    expect(parseIncoming("locations", "shed", { name: "Shed", kind: "garage" })).toBeNull();

    expect(parseIncoming("overrides", "milk", { fridgeDays: "lots", freezerDays: 30, foodTypeId: "cheese" })).toEqual({
      foodTypeId: "milk",
      freezerDays: 30,
    });

    expect(parseIncoming("profile", "profile", { householdName: 5, people: -1, diets: ["vegan", "carnivore", 3] })).toEqual({
      ...DEFAULT_PROFILE,
      diets: ["vegan"],
    });
    expect(parseIncoming("profile", "not-profile", DEFAULT_PROFILE)).toBeNull();

    const recipe = { title: "Soup", source: "saved", servings: 2, ingredients: [{ name: "Leek" }, { nope: 1 }], steps: ["Cook", 4], tags: [] };
    expect(parseIncoming("savedRecipes", "r", recipe)).toMatchObject({ id: "r", ingredients: [{ name: "Leek" }], steps: ["Cook"] });
    expect(parseIncoming("savedRecipes", "r", { ...recipe, ingredients: "leek" })).toBeNull();
    expect(parseIncoming("savedRecipes", "r", { ...recipe, sourceUrl: "javascript:alert(1)" })).not.toHaveProperty("sourceUrl");

    const line = { name: "Milk", foodTypeId: null, aisle: "Dairy, Eggs & Fridge", checked: false, addedAt: at };
    expect(parseIncoming("shoppingList", "l", line)).toMatchObject({ id: "l", name: "Milk" });
    expect(parseIncoming("shoppingList", "l", { ...line, checked: "no" })).toBeNull();

    expect(parseIncoming("mealPlan", "m", { date: "2026-10-30", recipeId: "r" })).toEqual({ id: "m", date: "2026-10-30", recipeId: "r" });
    expect(parseIncoming("mealPlan", "m", { date: "someday", recipeId: "r" })).toBeNull();
  });

  it("refuses ids that could reach Object.prototype", () => {
    for (const id of ["__proto__", "constructor", "prototype"]) {
      expect(parseIncoming("overrides", id, { fridgeDays: 1 })).toBeNull();
      expect(parseIncoming("items", id, item(id))).toBeNull();
    }
    const r = applyRemote(
      state(),
      [row("overrides", "__proto__", { fridgeDays: 1 }, 1), row("overrides", "constructor", null, 2, true), row("overrides", "milk", { fridgeDays: 3 }, 3)],
      {},
      0,
    );
    expect(Object.keys(r.patch.overrides ?? {})).toEqual(["milk"]);
    expect(Object.getPrototypeOf(r.patch.overrides)).toBeNull();
    expect(({} as Record<string, unknown>).fridgeDays).toBeUndefined();
    expect(r.cursor).toBe(3);
  });

  it("skips bad rows in a batch and applies the good ones", () => {
    const r = applyRemote(state(), [row("items", "x", { name: "Half a record" }, 1), row("items", "ok", item("ok"), 2)], {}, 0);
    expect(r.patch.items?.map((i) => i.id)).toEqual(["ok"]);
    expect(r.applied).toBe(1);
    expect(r.cursor).toBe(2);
  });
});

describe("pull pages", () => {
  it("reads the RPC reply and drops malformed rows", () => {
    const page = parsePullPage({
      rows: [
        { collection: "items", id: "a", data: { x: 1 }, deleted: false, seq: 4 },
        { collection: 5, id: "b", seq: 5 },
        null,
        { collection: "items", id: "c", data: null, deleted: true, seq: "6" },
      ],
      cursor: 4,
      more: false,
    });
    expect(page.rows.map((r) => r.id)).toEqual(["a", "c"]);
    expect(page.rows[1]).toMatchObject({ deleted: true, seq: 6 });
    expect(page).toMatchObject({ cursor: 4, more: false, count: 4, lastSeq: 6 });
  });

  it("treats a reply without rows as an error", () => {
    expect(() => parsePullPage(null)).toThrow();
    expect(() => parsePullPage({ cursor: 1 })).toThrow();
  });
});

describe("failed changes", () => {
  it("splits off records too large to send", () => {
    const big = item("big", { notes: "x".repeat(MAX_RECORD_BYTES) });
    const m = enqueue(emptyMeta(), [
      { c: "items", id: "a", op: "upsert" },
      { c: "items", id: "big", op: "upsert" },
    ]);
    const b = prepareBatch(nextBatch(m), state({ items: [item("a"), big] }), "h1");
    expect(b.rows.map((r) => r.id)).toEqual(["a"]);
    expect(b.entries.map((e) => e.id)).toEqual(["a"]);
    expect(b.tooLarge.map((e) => e.id)).toEqual(["big"]);
  });

  it("counts bytes, not characters", () => {
    const emoji = item("e", { notes: "🥕".repeat(MAX_RECORD_BYTES / 3) });
    const m = enqueue(emptyMeta(), [{ c: "items", id: "e", op: "upsert" }]);
    expect(prepareBatch(nextBatch(m), state({ items: [emoji] }), "h1").tooLarge).toHaveLength(1);
  });

  it("moves quarantined entries out of the outbox, unless edited again since", () => {
    let m = enqueue(emptyMeta(), [
      { c: "items", id: "a", op: "upsert" },
      { c: "items", id: "b", op: "upsert" },
    ]);
    const sent = nextBatch(m);
    m = enqueue(m, [{ c: "items", id: "b", op: "upsert" }]);
    m = quarantine(m, sent, "rejected");
    expect(Object.keys(m.outbox)).toEqual(["items:b"]);
    expect(m.failed).toEqual([{ c: "items", id: "a", reason: "rejected" }]);
    // Quarantined twice: listed once.
    m = enqueue(m, [{ c: "items", id: "a", op: "upsert" }]);
    m = quarantine(m, nextBatch(m).filter((e) => e.id === "a"), "too-large");
    expect(m.failed).toEqual([{ c: "items", id: "a", reason: "too-large" }]);
  });

  it("clears a failure once the record goes up, and can requeue them all", () => {
    let m = enqueue(emptyMeta(), [{ c: "items", id: "a", op: "upsert" }]);
    m = quarantine(m, nextBatch(m), "too-large");
    expect(m.failed).toHaveLength(1);
    m = requeueFailed(m);
    expect(m.failed).toEqual([]);
    expect(Object.keys(m.outbox)).toEqual(["items:a"]);
    m = quarantine(m, nextBatch(m), "too-large");
    m = enqueue(m, [{ c: "items", id: "a", op: "upsert" }]);
    m = ack(m, nextBatch(m));
    expect(m.failed).toEqual([]);
    expect(m.outbox).toEqual({});
  });

  it("persists failures and an owed merge, tolerating junk", () => {
    const raw = JSON.stringify({ v: 1, failed: [{ c: "items", id: "a", reason: "too-large" }, { c: 1 }, "x"], pendingMerge: true });
    expect(parseMeta(raw)).toMatchObject({ failed: [{ c: "items", id: "a", reason: "too-large" }], pendingMerge: true });
    expect(parseMeta(JSON.stringify({ v: 1, failed: "nope", pendingMerge: "yes" }))).toMatchObject({ failed: [], pendingMerge: false });
  });
});
