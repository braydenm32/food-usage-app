import { beforeEach, describe, expect, it } from "vitest";
import {
  clampOverride,
  DEFAULT_PROFILE,
  DEFAULT_SETTINGS,
  MAX_EVENTS,
  normalisePersisted,
  opensWhenUsed,
  useLarder,
} from "./store";
import { computeExpiry } from "./shelf-life/engine";
import { getFoodType } from "./shelf-life/foods";
import type { DraftItem, ItemEvent } from "./types";

const s = () => useLarder.getState();

function draft(p: Partial<DraftItem> = {}): DraftItem {
  return {
    key: Math.random().toString(36),
    name: "Milk",
    foodTypeId: "milk-full-cream",
    emoji: "🥛",
    locationId: "fridge",
    quantity: 2,
    unit: "L",
    dateKind: "use-by",
    include: true,
    ...p,
  };
}

beforeEach(() => {
  s().resetAll();
});

describe("undo", () => {
  it("reverts only the records the action touched", () => {
    const [a, b] = s().addItems([draft({ name: "A" }), draft({ name: "B" })], "manual");
    s().consumeItem(a.id, "all", "binned");
    // An unrelated edit after the action survives undo.
    s().updateItem(b.id, { quantity: 1 });
    s().performUndo();
    const items = s().items;
    expect(items.map((i) => i.name).sort()).toEqual(["A", "B"]);
    expect(items.find((i) => i.id === b.id)?.quantity).toBe(1);
    expect(s().events.filter((e) => e.type === "binned")).toHaveLength(0);
  });

  it("ignores a stale undo id", () => {
    const [a, b] = s().addItems([draft({ name: "A" }), draft({ name: "B" })], "manual");
    s().consumeItem(a.id, "all", "used");
    const first = s().undo!.id;
    s().consumeItem(b.id, "all", "used");
    s().performUndo(first);
    expect(s().items).toHaveLength(0);
    s().clearUndo(first);
    expect(s().undo).not.toBeNull();
    s().performUndo(s().undo!.id);
    expect(s().items.map((i) => i.name)).toEqual(["B"]);
  });

  it("consumeMany is one undoable step", () => {
    const created = s().addItems([draft({ name: "A" }), draft({ name: "B" }), draft({ name: "C" })], "manual");
    s().consumeMany(created.slice(0, 2).map((i) => i.id), "binned");
    expect(s().items.map((i) => i.name)).toEqual(["C"]);
    expect(s().undo?.label).toBe("Binned 2 items");
    expect(s().events.filter((e) => e.type === "binned")).toHaveLength(2);
    s().performUndo();
    expect(s().items.map((i) => i.name)).toEqual(["A", "B", "C"]);
  });

  it("puts list rows back when undoing Put in the larder", () => {
    s().addToList([{ name: "Mystery sauce", foodTypeId: null }]);
    const row = s().shoppingList[0];
    s().addItems([draft({ name: "Mystery sauce", foodTypeId: null })], "list", { removeListIds: [row.id] });
    expect(s().shoppingList).toHaveLength(0);
    s().performUndo();
    expect(s().shoppingList.map((l) => l.id)).toEqual([row.id]);
    expect(s().items).toHaveLength(0);
  });
});

describe("events", () => {
  it("records location and quantity on added events", () => {
    s().addItems([draft({ locationId: "freezer", quantity: 3 })], "receipt");
    const e = s().events[0];
    expect(e).toMatchObject({ type: "added", locationId: "freezer", quantity: 3, unit: "L", detail: "receipt" });
  });

  it("caps history", () => {
    const many: ItemEvent[] = Array.from({ length: MAX_EVENTS + 50 }, (_, i) => ({
      id: `e${i}`,
      itemId: "x",
      itemName: "x",
      foodTypeId: null,
      type: "used",
      at: new Date().toISOString(),
    }));
    useLarder.setState({ events: many });
    s().addItems([draft()], "manual");
    expect(s().events).toHaveLength(MAX_EVENTS);
    expect(s().events.at(-1)?.type).toBe("added");
  });
});

describe("opening on partial use", () => {
  it("opens jars, tins, bottles and dairy, not produce, meat or dry goods", () => {
    expect(opensWhenUsed({ unit: "jar", foodTypeId: "pasta-sauce" })).toBe(true);
    expect(opensWhenUsed({ unit: "L", foodTypeId: "milk-full-cream" })).toBe(true);
    expect(opensWhenUsed({ unit: "kg", foodTypeId: "rice-white" })).toBe(false);
    expect(opensWhenUsed({ unit: "g", foodTypeId: "beef-mince" })).toBe(false);
    expect(opensWhenUsed({ unit: "item", foodTypeId: "apple-red" })).toBe(false);
    expect(opensWhenUsed({ unit: "item", foodTypeId: null })).toBe(false);
    expect(opensWhenUsed({ unit: "bottle", foodTypeId: null })).toBe(true);
  });

  it("doesn't set openedAt when using some rice or cooking with mince", () => {
    const [rice, mince, sauce] = s().addItems(
      [
        draft({ name: "Rice", foodTypeId: "rice-white", unit: "kg", quantity: 1, locationId: "pantry" }),
        draft({ name: "Mince", foodTypeId: "beef-mince", unit: "g", quantity: 500 }),
        draft({ name: "Sauce", foodTypeId: "pasta-sauce", unit: "jar", quantity: 1, locationId: "pantry" }),
      ],
      "manual",
    );
    s().consumeItem(rice.id, 0.25, "used");
    s().cookRecipe({ id: "r", title: "Bolognese", source: "builtin", servings: 2, ingredients: [], steps: [], tags: [] }, [
      { itemId: mince.id, quantity: 250 },
      { itemId: sauce.id, quantity: 0.5 },
    ]);
    const byId = (id: string) => s().items.find((i) => i.id === id)!;
    expect(byId(rice.id).openedAt).toBeUndefined();
    expect(byId(mince.id).openedAt).toBeUndefined();
    expect(byId(sauce.id).openedAt).toBeDefined();
  });
});

describe("freezing", () => {
  it("keeps an expired item expired when it goes in the freezer", () => {
    const [mince] = s().addItems([draft({ name: "Mince", foodTypeId: "beef-mince", unit: "g", quantity: 500 })], "manual");
    const old = new Date(Date.now() - 6 * 86_400_000).toISOString();
    s().updateItem(mince.id, { addedAt: old });
    s().moveItem(mince.id, "freezer");
    const moved = s().items[0];
    expect(moved.expiredWhenFrozen).toBe(true);
    const info = computeExpiry(moved, { food: getFoodType("beef-mince"), location: s().locations.find((l) => l.id === "freezer") });
    expect(info.status).toBe("expired");
  });

  it("keeps the frozen date when moving between freezers", () => {
    s().addLocation("Chest freezer", "freezer");
    const chest = s().locations.find((l) => l.name === "Chest freezer")!;
    const [peas] = s().addItems([draft({ name: "Peas", foodTypeId: null, locationId: "freezer" })], "manual");
    const frozenAt = s().items[0].frozenAt;
    expect(frozenAt).toBeDefined();
    s().moveItem(peas.id, chest.id);
    expect(s().items[0].frozenAt).toBe(frozenAt);
    expect(s().items[0].thawedAt).toBeUndefined();
  });
});

describe("overrides", () => {
  it("caps learned days for use-by and high-risk foods at 1.5× the table", () => {
    expect(clampOverride({ foodTypeId: "beef-mince", fridgeDays: 10 }).fridgeDays).toBe(3);
    expect(clampOverride({ foodTypeId: "milk-full-cream", pantryDays: 20 }).pantryDays).toBeUndefined();
    // Low-risk foods are left alone.
    expect(clampOverride({ foodTypeId: "apple-red", fridgeDays: 60 }).fridgeDays).toBe(60);
    s().setOverride({ foodTypeId: "beef-mince", fridgeDays: 9 });
    expect(s().overrides["beef-mince"].fridgeDays).toBe(3);
  });
});

describe("normalisePersisted", () => {
  it("fills missing arrays, settings and built-in spots", () => {
    const n = normalisePersisted({ profile: { householdName: "Us", people: 3 }, settings: { theme: "dark" }, items: "nope" });
    expect(n.profile).toEqual({ ...DEFAULT_PROFILE, householdName: "Us", people: 3 });
    expect(n.settings).toEqual({ ...DEFAULT_SETTINGS, theme: "dark" });
    expect(n.items).toEqual([]);
    expect(n.locations.map((l) => l.id).sort()).toEqual(["freezer", "fridge", "pantry"]);
    expect(normalisePersisted(null).shoppingList).toEqual([]);
  });
});
