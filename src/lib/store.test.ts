import { beforeEach, describe, expect, it } from "vitest";
import {
  clampOverride,
  DEFAULT_PROFILE,
  DEFAULT_SETTINGS,
  MAX_EVENTS,
  normalisePersisted,
  opensWhenUsed,
  useLarder,
  type UndoSnapshot,
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

  it("keeps an earlier action's undo after a later one", () => {
    const [a, b] = s().addItems([draft({ name: "A" }), draft({ name: "B" })], "manual");
    s().consumeItem(a.id, "all", "used");
    const first = s().undo!.id;
    s().consumeItem(b.id, "all", "used");
    // Undoing the first action leaves the second (unrelated) one alone.
    expect(s().performUndo(first)).toBe(1);
    expect(s().items.map((i) => i.name)).toEqual(["A"]);
    expect(s().performUndo(first)).toBe(0);
    s().performUndo();
    expect(s().items.map((i) => i.name).sort()).toEqual(["A", "B"]);
  });

  it("ignores an undo id that was cleared", () => {
    const [a, b] = s().addItems([draft({ name: "A" }), draft({ name: "B" })], "manual");
    s().consumeItem(a.id, "all", "used");
    const first = s().undo!.id;
    s().consumeItem(b.id, "all", "used");
    s().clearUndo(first);
    expect(s().performUndo(first)).toBe(0);
    expect(s().items).toHaveLength(0);
    expect(s().undo).not.toBeNull();
    s().performUndo(s().undo!.id);
    expect(s().items.map((i) => i.name)).toEqual(["B"]);
  });

  it("undoing an older action also undoes later changes to the same item", () => {
    const [a] = s().addItems([draft({ name: "A", quantity: 3, unit: "item" })], "manual");
    s().consumeItem(a.id, 1, "used");
    const first = s().undo!.id;
    s().consumeItem(a.id, 1, "used");
    expect(s().items[0].quantity).toBe(1);
    expect(s().performUndo(first)).toBe(2);
    expect(s().items[0].quantity).toBe(3);
    expect(s().events.filter((e) => e.type === "used")).toHaveLength(0);
  });

  it("caps the undo chain and forgets it on undo: null", () => {
    const created = s().addItems(Array.from({ length: 12 }, (_, i) => draft({ name: `I${i}` })), "manual");
    for (const c of created) s().consumeItem(c.id, "all", "binned");
    let n = 0;
    for (let u: UndoSnapshot | null | undefined = s().undo; u; u = u.prev) n++;
    expect(n).toBe(8);
    useLarder.setState({ undo: null });
    expect(s().performUndo()).toBe(0);
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

  it("saves meal-prep leftovers in the fridge as portions with a 2-day use-by", () => {
    const recipe = { id: "r", title: "Chilli", source: "builtin" as const, servings: 4, ingredients: [], steps: [], tags: [] };
    const fridge = () => s().locations.find((l) => l.id === "fridge");
    s().cookRecipe(recipe, [], draft({ name: "Leftovers – Chilli", foodTypeId: "leftovers-meal", unit: "item", quantity: 4 }));
    const saved = s().items[0];
    expect(saved).toMatchObject({ locationId: "fridge", quantity: 4, initialQuantity: 4, dateKind: "use-by" });
    expect(saved.printedDate).toBeUndefined();
    const info = computeExpiry(saved, { food: getFoodType("leftovers-meal"), location: fridge() });
    expect(info.daysLeft).toBe(2);

    // A date the cook picked sticks to the item.
    s().cookRecipe(recipe, [], draft({ name: "Leftovers – Chilli", foodTypeId: "leftovers-meal", unit: "item", quantity: 2, printedDate: "2030-01-03" }));
    expect(s().items[1].printedDate).toBe("2030-01-03");
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

  it("splits an item when only some of it moves, sharing the price, and undoes in one step", () => {
    const [chops] = s().addItems([draft({ name: "Lamb chops", foodTypeId: null, unit: "item", quantity: 6, price: 18, locationId: "fridge" })], "manual");
    s().moveItem(chops.id, "freezer", 4);
    const fridge = s().items.find((i) => i.id === chops.id)!;
    const frozen = s().items.find((i) => i.id !== chops.id)!;
    expect(fridge).toMatchObject({ quantity: 2, initialQuantity: 2, price: 6, locationId: "fridge" });
    expect(frozen).toMatchObject({ quantity: 4, initialQuantity: 4, price: 12, locationId: "freezer", addedAt: chops.addedAt });
    expect(frozen.frozenAt).toBeDefined();
    s().performUndo();
    expect(s().items).toHaveLength(1);
    expect(s().items[0]).toMatchObject({ quantity: 6, locationId: "fridge" });
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

describe("addToList merging", () => {
  beforeEach(() => s().resetAll());
  it("adds amounts for the same food from different places", () => {
    s().addToList([{ name: "Eggs", foodTypeId: null, quantity: 2, unit: "item" }]);
    s().addToList([{ name: "Eggs", foodTypeId: null, quantity: 1, unit: "item" }]);
    expect(s().shoppingList).toHaveLength(1);
    expect(s().shoppingList[0].quantity).toBe(3);
  });
  it("doesn't double up when the same recipe adds again", () => {
    const e = { name: "Beef mince", foodTypeId: null, quantity: 500, unit: "g", recipeId: "r1", reason: "recipe" as const };
    s().addToList([e]);
    s().addToList([e]);
    expect(s().shoppingList[0].quantity).toBe(500);
  });
  it("keeps both rows when the units can't be added", () => {
    s().addToList([{ name: "Coriander", foodTypeId: null, quantity: 1, unit: "bunch" }]);
    s().addToList([{ name: "Coriander", foodTypeId: null, quantity: 20, unit: "g" }]);
    expect(s().shoppingList.map((l) => `${l.quantity} ${l.unit}`)).toEqual(["1 bunch", "20 g"]);
  });
  it("removing a row can be undone", () => {
    s().addToList([{ name: "Milk", foodTypeId: null }, { name: "Bread", foodTypeId: null }]);
    const milk = s().shoppingList[0];
    s().removeListItem(milk.id);
    expect(s().shoppingList.map((l) => l.name)).toEqual(["Bread"]);
    s().performUndo();
    expect(s().shoppingList.map((l) => l.name)).toEqual(["Milk", "Bread"]);
  });
});

describe("addItems: amounts, packs and barcodes", () => {
  it("never adds a zero amount", () => {
    const created = s().addItems([draft({ quantity: 0 }), draft({ name: "B", quantity: 1 })], "manual");
    expect(created.map((i) => i.name)).toEqual(["B"]);
  });

  it("adds each pack of a multi-pack line as its own item, sharing the price", () => {
    const created = s().addItems([draft({ quantity: 2, unit: "L", packs: 2, price: 6.2 })], "list");
    expect(created).toHaveLength(2);
    expect(created.every((i) => i.quantity === 2 && i.unit === "L" && i.price === 3.1)).toBe(true);
  });

  it("saves the barcode on the item and remembers it for next time", () => {
    const [item] = s().addItems([draft({ barcode: "9300633000000", name: "Full cream milk", quantity: 2 })], "barcode");
    expect(item.barcode).toBe("9300633000000");
    expect(s().barcodes["9300633000000"]).toMatchObject({ foodTypeId: "milk-full-cream", name: "Full cream milk", unit: "L", quantity: 2 });
    // An unmatched placeholder isn't remembered.
    s().addItems([draft({ barcode: "123", name: "Barcode 123", foodTypeId: null })], "barcode");
    expect(s().barcodes["123"]).toBeUndefined();
  });

  it("keeps remembered barcodes through a save and load", () => {
    s().rememberBarcode("42", { foodTypeId: null, name: "Nana's relish", emoji: "🫙", unit: "jar", quantity: 1 });
    expect(normalisePersisted({ barcodes: s().barcodes }).barcodes["42"]).toMatchObject({ name: "Nana's relish" });
    expect(normalisePersisted({}).barcodes).toEqual({});
  });
});

describe("household staples", () => {
  beforeEach(() => s().resetAll());
  it("marks and unmarks a staple by food type, without duplicates", () => {
    s().setStaple({ name: "Milk", foodTypeId: "milk-full-cream" }, true);
    s().setStaple({ name: "Full cream milk", foodTypeId: "milk-full-cream" }, true);
    expect(s().staples).toHaveLength(1);
    s().setStaple({ name: "Whatever", foodTypeId: "milk-full-cream" }, false);
    expect(s().staples).toHaveLength(0);
  });
  it("matches by name when there is no food type", () => {
    s().setStaple({ name: "Nonna's sauce", foodTypeId: null }, true);
    s().setStaple({ name: "nonna's sauce ", foodTypeId: null }, true);
    expect(s().staples).toHaveLength(1);
  });
  it("survives normalising old saves without staples", () => {
    expect(normalisePersisted({ items: [] }).staples).toEqual([]);
    expect(normalisePersisted({ staples: [{ id: "x", name: "Milk", foodTypeId: null }, null] }).staples).toHaveLength(1);
  });
});

describe("review fixes", () => {
  beforeEach(() => s().resetAll());

  it("dropping a newer snapshot also drops older ones on the same records, so they can't clobber it", () => {
    const [a] = s().addItems([draft({ name: "A", quantity: 3, unit: "item" })], "manual");
    s().consumeItem(a.id, 1, "used");
    const older = s().undo!.id;
    s().consumeItem(a.id, 1, "used");
    const newer = s().undo!.id;
    // The newer toast closes first: its snapshot goes, and the older one on the same item with it.
    s().clearUndo(newer);
    expect(s().performUndo(older)).toBe(0);
    expect(s().items[0].quantity).toBe(1);
  });

  it("dropping a snapshot keeps unrelated older ones", () => {
    const [a, b] = s().addItems([draft({ name: "A" }), draft({ name: "B" })], "manual");
    s().consumeItem(a.id, "all", "used");
    const older = s().undo!.id;
    s().consumeItem(b.id, "all", "used");
    s().clearUndo(s().undo!.id);
    expect(s().performUndo(older)).toBe(1);
    expect(s().items.map((i) => i.name)).toEqual(["A"]);
  });

  it("Undo of an add forgets the barcode it remembered, and restores an older memory", () => {
    s().addItems([draft({ barcode: "777", name: "Oat milk" })], "barcode");
    expect(s().barcodes["777"]?.name).toBe("Oat milk");
    s().performUndo();
    expect(s().barcodes["777"]).toBeUndefined();
    s().rememberBarcode("888", { foodTypeId: null, name: "Old", emoji: "🫙", unit: "jar", quantity: 1 });
    s().addItems([draft({ barcode: "888", name: "New" })], "barcode");
    s().performUndo();
    expect(s().barcodes["888"]?.name).toBe("Old");
  });

  it("matches staples across a recipe family but not across a catch-all id", () => {
    s().setStaple({ name: "Milk", foodTypeId: "milk-full-cream" }, true);
    s().setStaple({ name: "Skim milk", foodTypeId: "milk-skim" }, true);
    expect(s().staples).toHaveLength(1);
    s().setStaple({ name: "Cumin", foodTypeId: "spices" }, true);
    s().setStaple({ name: "Cinnamon", foodTypeId: "spices" }, true);
    expect(s().staples).toHaveLength(3);
  });

  it("keeps both notes when list rows merge", () => {
    s().addToList([{ name: "Bread", foodTypeId: null, quantity: 6, unit: "slice", note: "for French toast" }]);
    s().addToList([{ name: "Bread", foodTypeId: null, quantity: 2, unit: "slice", note: "for sandwiches" }]);
    expect(s().shoppingList[0].note).toBe("for French toast; for sandwiches");
  });

  it("plans keep a recipe copy, and unsaving copies it into older plan entries", () => {
    const r = { id: "ai-1", title: "Fritters", ingredients: [], steps: [], tags: [], servings: 2, source: "ai" } as unknown as import("./types").Recipe;
    s().saveRecipe(r);
    s().planMeal("2026-11-03", r);
    expect(s().mealPlan[0].recipe?.title).toBe("Fritters");
    // An entry from before this change has no copy.
    useLarder.setState({ mealPlan: [{ id: "m1", date: "2026-11-04", recipeId: "ai-1" }] });
    s().unsaveRecipe("ai-1");
    expect(s().savedRecipes).toHaveLength(0);
    expect(s().mealPlan[0].recipe?.title).toBe("Fritters");
  });
});

describe("privacy fields", () => {
  it("keeps a consent timestamp and drops junk values", () => {
    const good = normalisePersisted({ profile: { sensitiveConsentAt: "2026-11-07T00:00:00.000Z" }, settings: { aiIncludeProfile: false } });
    expect(good.profile.sensitiveConsentAt).toBe("2026-11-07T00:00:00.000Z");
    expect(good.settings.aiIncludeProfile).toBe(false);
    const bad = normalisePersisted({ profile: { sensitiveConsentAt: 5 }, settings: { aiIncludeProfile: "no" } });
    expect(bad.profile.sensitiveConsentAt).toBeUndefined();
    expect(bad.settings.aiIncludeProfile).toBeUndefined();
  });
});
