import { describe, expect, it, vi } from "vitest";
import type { FoodType, ItemEvent, PantryItem } from "./types";
import { scrubPersonalInfo } from "./drafts";

// A small fixed food table so these tests don't move when the real data changes.
vi.mock("./shelf-life/foods-data", () => {
  const base = {
    pantryDays: null,
    fridgeDays: 7,
    freezerDays: 90,
    openedDays: null,
    defaultQuantity: 1,
  };
  const FOOD_TYPES: FoodType[] = [
    { ...base, id: "milk", name: "Milk", aliases: ["full cream milk", "lite milk"], category: "dairy", aisle: "Dairy, Eggs & Fridge", emoji: "🥛", dateKind: "use-by", defaultLocation: "fridge", defaultUnit: "L", defaultQuantity: 2 },
    { ...base, id: "eggs", name: "Eggs", aliases: ["egg", "free range eggs"], category: "eggs", aisle: "Dairy, Eggs & Fridge", emoji: "🥚", dateKind: "best-before", defaultLocation: "fridge", defaultUnit: "dozen", defaultQuantity: 1 },
    { ...base, id: "tomato", name: "Tomato", aliases: ["tomatoes", "truss tomatoes"], category: "vegetables", aisle: "Fruit & Veg", emoji: "🍅", dateKind: "best-before", defaultLocation: "pantry", defaultUnit: "item", defaultQuantity: 4 },
    { ...base, id: "ginger", name: "Fresh ginger", aliases: ["ginger", "ginger root"], category: "vegetables", aisle: "Fruit & Veg", emoji: "🫚", dateKind: "best-before", defaultLocation: "fridge", defaultUnit: "item", defaultQuantity: 1 },
    { ...base, id: "beef-mince", name: "Beef mince", aliases: ["mince", "beef mince"], category: "meat", aisle: "Meat & Seafood", emoji: "🥩", dateKind: "use-by", defaultLocation: "fridge", defaultUnit: "g", defaultQuantity: 500 },
    { ...base, id: "banana", name: "Bananas", aliases: ["banana", "cavendish"], category: "fruit", aisle: "Fruit & Veg", emoji: "🍌", dateKind: "best-before", defaultLocation: "pantry", defaultUnit: "item", defaultQuantity: 6 },
    { ...base, id: "tinned-tomatoes", name: "Tinned tomatoes", aliases: ["diced tomatoes", "crushed tomatoes"], category: "pantry", aisle: "Pantry", emoji: "🥫", dateKind: "best-before", defaultLocation: "pantry", defaultUnit: "tin", defaultQuantity: 1 },
    { ...base, id: "raspberries", name: "Raspberries", aliases: ["raspberry", "rspbry"], category: "fruit", aisle: "Fruit & Veg", emoji: "🫐", dateKind: "use-by", defaultLocation: "fridge", defaultUnit: "g", defaultQuantity: 125 },
  ];
  return { FOOD_TYPES };
});

const {
  parseLine,
  parseLocalList,
  lineToDraft,
  resolveQuantity,
  looksLikeOrderEmail,
  isLikelyNonFood,
  freeTextDraft,
  applyFoodType,
  offProductToResponse,
  withLastAdded,
  findMergeTarget,
  checkPrintedDate,
} = await import("./drafts");
const { defaultsForUnknown } = await import("./shelf-life/engine");

describe("parseLine", () => {
  it("strips bullets and numbering", () => {
    expect(parseLine("- milk")?.name).toBe("milk");
    expect(parseLine("• eggs")?.name).toBe("eggs");
    expect(parseLine("* bread")?.name).toBe("bread");
    expect(parseLine("3. apples")?.name).toBe("apples");
    expect(parseLine("[ ] coffee")?.name).toBe("coffee");
    expect(parseLine("☐ butter")?.name).toBe("butter");
  });

  it("reads count prefixes and suffixes", () => {
    expect(parseLine("2x milk")).toMatchObject({ name: "milk", count: 2 });
    expect(parseLine("2 x milk")).toMatchObject({ name: "milk", count: 2 });
    expect(parseLine("bananas x6")).toMatchObject({ name: "bananas", count: 6 });
    expect(parseLine("3 apples")).toMatchObject({ name: "apples", count: 3 });
    expect(parseLine("two avocados")).toMatchObject({ name: "avocados", count: 2 });
  });

  it("reads sizes and units", () => {
    expect(parseLine("500g mince")).toMatchObject({ name: "mince", size: { quantity: 500, unit: "g" } });
    expect(parseLine("1kg potatoes")).toMatchObject({ name: "potatoes", size: { quantity: 1, unit: "kg" } });
    expect(parseLine("1.5 kg chicken thighs")).toMatchObject({ name: "chicken thighs", size: { quantity: 1.5, unit: "kg" } });
    expect(parseLine("yoghurt 1L")).toMatchObject({ name: "yoghurt", size: { quantity: 1, unit: "L" } });
    expect(parseLine("coconut milk 400ml")).toMatchObject({ size: { quantity: 400, unit: "ml" } });
  });

  it("handles '2 x milk 2L'", () => {
    expect(parseLine("2 x milk 2L")).toMatchObject({ name: "milk", count: 2, size: { quantity: 2, unit: "L" } });
  });

  it("reads multipacks and prices", () => {
    expect(parseLine("Sparkling water 6 x 330ml $5.50")).toMatchObject({
      name: "Sparkling water",
      size: { quantity: 1980, unit: "ml" },
      price: 5.5,
    });
    expect(parseLine("BANANAS 3.20")).toMatchObject({ name: "BANANAS", price: 3.2 });
  });

  it("returns null for empty or number-only lines", () => {
    expect(parseLine("   ")).toBeNull();
    expect(parseLine("- ")).toBeNull();
    expect(parseLine("12")).toBeNull();
  });
});

describe("resolveQuantity", () => {
  it("multiplies measured foods by count", () => {
    expect(resolveQuantity({ count: 2, size: { quantity: 2, unit: "L" } }, { defaultUnit: "L", defaultQuantity: 2 })).toEqual({
      quantity: 4,
      unit: "L",
    });
  });
  it("converts units to the food's unit", () => {
    expect(resolveQuantity({ size: { quantity: 1, unit: "kg" } }, { defaultUnit: "g", defaultQuantity: 500 })).toEqual({
      quantity: 1000,
      unit: "g",
    });
  });
  it("counts counted foods instead of weighing them", () => {
    expect(resolveQuantity({ count: 3, size: { quantity: 400, unit: "g" } }, { defaultUnit: "tin", defaultQuantity: 1 })).toEqual({
      quantity: 3,
      unit: "tin",
    });
  });
  it("falls back to the food default", () => {
    expect(resolveQuantity({}, { defaultUnit: "item", defaultQuantity: 12 })).toEqual({ quantity: 1, unit: "item" });
    expect(resolveQuantity({}, { defaultUnit: "g", defaultQuantity: 500 })).toEqual({ quantity: 500, unit: "g" });
  });
  it("uses what was read for unknown foods", () => {
    expect(resolveQuantity({ size: { quantity: 250, unit: "g" } })).toEqual({ quantity: 250, unit: "g" });
    expect(resolveQuantity({ count: 2 })).toEqual({ quantity: 2, unit: "item" });
    expect(resolveQuantity({})).toEqual({ quantity: 1, unit: "item" });
  });
});

describe("lineToDraft", () => {
  it("matches known foods with emoji, location and date kind", () => {
    const d = lineToDraft(parseLine("2 x milk 2L")!);
    expect(d).toMatchObject({ foodTypeId: "milk", emoji: "🥛", locationId: "fridge", dateKind: "use-by", quantity: 2, unit: "L", packs: 2, include: true, isFood: true });
  });
  it("gives unknown foods sensible defaults and low confidence", () => {
    const d = lineToDraft({ name: "DRAGON FRUIT JAM" });
    expect(d).toMatchObject({ foodTypeId: null, name: "Dragon fruit jam", emoji: "🛒", quantity: 1, unit: "item", confidence: "low", include: true });
  });
  it("excludes non-food by default", () => {
    const d = lineToDraft({ name: "Reusable bag", price: 0.25 });
    expect(d).toMatchObject({ isFood: false, include: false, foodTypeId: null });
  });
  it("trusts an explicit isFood from the AI", () => {
    expect(lineToDraft({ name: "raspberries", isFood: true, rawText: "WW RSPBRY 125G" })).toMatchObject({ foodTypeId: "raspberries" });
  });
});

describe("freeTextDraft and applyFoodType", () => {
  it("parses amounts in free text", () => {
    expect(freeTextDraft("500g mince")).toMatchObject({ foodTypeId: "beef-mince", quantity: 500, unit: "g" });
  });
  it("re-points a draft at another food", () => {
    const d = applyFoodType(freeTextDraft("mystery thing"), "eggs");
    expect(d).toMatchObject({ foodTypeId: "eggs", emoji: "🥚", unit: "dozen", confidence: "high" });
  });
});

describe("isLikelyNonFood", () => {
  it("flags bags, cleaning and totals", () => {
    for (const t of ["Reusable shopping bag", "Dishwashing liquid 500ml", "Toilet paper 12pk", "SUBTOTAL", "Delivery fee", "GST included"]) {
      expect(isLikelyNonFood(t), t).toBe(true);
    }
  });
  it("leaves food alone", () => {
    for (const t of ["Full cream milk 2L", "Baby spinach 120g", "Bread rolls"]) expect(isLikelyNonFood(t), t).toBe(false);
  });

  it("does not flag foods whose names contain a non-food word", () => {
    for (const t of ["Lipton tea bags 100pk", "Bag of ice 5kg", "Lolly bag", "Steam bag potatoes", "Sponge cake", "Zucchini flowers"]) {
      expect(isLikelyNonFood(t), t).toBe(false);
    }
    for (const t of ["Reusable bag", "Kitchen sponge 3pk", "Flowers bunch"]) expect(isLikelyNonFood(t), t).toBe(true);
  });
});

describe("parseLocalList", () => {
  it("parses a typed list", () => {
    const r = parseLocalList("- milk\n- 2x eggs\n\n500g mince\n• bananas x6\n");
    expect(r.orderEmail).toBe(false);
    expect(r.lines.map((l) => l.name)).toEqual(["milk", "eggs", "mince", "bananas"]);
    expect(r.lines[1].count).toBe(2);
  });

  it("splits a one-line comma list", () => {
    expect(parseLocalList("milk, eggs, bread").lines.map((l) => l.name)).toEqual(["milk", "eggs", "bread"]);
  });

  it("ignores order-email noise and attaches qty and price lines", () => {
    const email = `Hi Sam,
Thanks for shopping with Woolworths!
Order number: 123456789
Delivery window: Thursday 30 October, 4pm - 7pm
Delivery address: 12 Example Street, Newtown NSW 2042

Your order
Woolworths Full Cream Milk 2L
Qty: 2
$6.20
Woolworths Free Range Eggs 12 Pack
Qty: 1
$6.90
Cavendish Bananas each
Qty: 6
$4.20
Reusable Bag
Qty: 1
$0.25
Fresh Raspberries 125g
Unavailable
Subtotal $17.55
Delivery fee $0.00
Total (incl. GST) $17.55
View in browser | Unsubscribe | Privacy`;
    const r = parseLocalList(email);
    expect(r.orderEmail).toBe(true);
    expect(looksLikeOrderEmail(email)).toBe(true);
    const names = r.lines.map((l) => l.name);
    expect(names).toHaveLength(4);
    expect(names[0]).toMatch(/Full Cream Milk/);
    expect(r.lines[0]).toMatchObject({ count: 2, price: 6.2, size: { quantity: 2, unit: "L" } });
    expect(r.lines[2]).toMatchObject({ count: 6, price: 4.2 });
    expect(r.lines[3].isFood).toBe(false);
    expect(names.join(" ")).not.toMatch(/Raspberr|Subtotal|Delivery|Thanks|Order number/i);

    const drafts = r.lines.map(lineToDraft);
    expect(drafts[0]).toMatchObject({ foodTypeId: "milk", quantity: 2, unit: "L", packs: 2, price: 6.2 });
    expect(drafts[1]).toMatchObject({ foodTypeId: "eggs" });
    expect(drafts[3]).toMatchObject({ include: false, isFood: false });
  });

  it("handles inline quantity and price on one line", () => {
    const r = parseLocalList("Order summary - Coles\n2 x Coles Diced Tomatoes 400g $2.20\nOrder total $2.20\nGST included");
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ count: 2, price: 2.2 });
    expect(lineToDraft(r.lines[0])).toMatchObject({ foodTypeId: "tinned-tomatoes", quantity: 2, unit: "tin" });
  });

  it("swaps substituted items", () => {
    const r = parseLocalList("Lite milk 2L\nSubstituted with: Full cream milk 2L\nEggs");
    expect(r.lines.map((l) => l.name)).toEqual(["Full cream milk", "Eggs"]);
  });
});

describe("offProductToResponse", () => {
  it("matches on product name and reads the pack size", () => {
    const r = offProductToResponse("9300633603294", {
      product_name: "Full Cream Milk",
      brands: "Pauls,Parmalat",
      quantity: "2 L",
      categories_tags: ["en:dairies", "en:milks"],
    });
    expect(r).toMatchObject({ found: true, brand: "Pauls", quantity: "2 L" });
    expect(r.draft).toMatchObject({ foodTypeId: "milk", quantity: 2, unit: "L", rawText: "Pauls · Full Cream Milk · 2 L" });
  });
  it("falls back to categories when the name doesn't match", () => {
    const r = offProductToResponse("123456789", {
      product_name: "Nonna's Rustica Passata Style",
      categories_tags: ["en:plant-based-foods", "en:diced-tomatoes"],
      quantity: "400 g",
    });
    expect(r.draft).toMatchObject({ foodTypeId: "tinned-tomatoes", unit: "tin", quantity: 1 });
  });
  it("keeps the product name when nothing matches", () => {
    const r = offProductToResponse("123456789", { product_name: "ZINGY QUINOA PUFFS", quantity: "150 g" });
    expect(r.draft).toMatchObject({ foodTypeId: null, name: "Zingy quinoa puffs", quantity: 150, unit: "g" });
  });
});

describe("parser fixes from review", () => {
  it("reads a multi-buy price line as the line total for the whole count", () => {
    const r = parseLocalList("Beef mince 1kg\n2 x $13.00 / $26.00");
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ count: 2, price: 26, size: { quantity: 1, unit: "kg" } });
    expect(lineToDraft(r.lines[0])).toMatchObject({ foodTypeId: "beef-mince", quantity: 1000, unit: "g", packs: 2, price: 26 });
  });

  it("reads a multi-buy on the same line", () => {
    expect(parseLine("Beef mince 1kg 2 x $13.00 / $26.00")).toMatchObject({
      name: "Beef mince",
      count: 2,
      price: 26,
      size: { quantity: 1, unit: "kg" },
    });
    expect(parseLocalList("Beef mince 1kg\n2 for $26.00").lines[0]).toMatchObject({ count: 2, price: 26 });
  });

  it("reads '12pk eggs' as one dozen", () => {
    expect(lineToDraft(parseLine("12pk eggs")!)).toMatchObject({ foodTypeId: "eggs", quantity: 1, unit: "dozen" });
    expect(lineToDraft(parseLine("free range eggs 12 pack")!)).toMatchObject({ quantity: 1, unit: "dozen" });
    expect(lineToDraft(parseLine("2 x eggs 6pk")!)).toMatchObject({ quantity: 1, unit: "dozen" });
    expect(lineToDraft(parseLine("half a dozen eggs")!)).toMatchObject({ quantity: 0.5, unit: "dozen" });
    // "2 packs" is a count of packs, not a pack of two.
    expect(parseLine("2 packs tortillas")).toMatchObject({ size: { quantity: 2, unit: "pack" } });
  });

  it("keeps the weight for loose produce: 'tomatoes 1kg' is 1 kg", () => {
    expect(lineToDraft(parseLine("tomatoes 1kg")!)).toMatchObject({ foodTypeId: "tomato", quantity: 1, unit: "kg" });
    expect(lineToDraft(parseLine("1kg truss tomatoes")!)).toMatchObject({ quantity: 1, unit: "kg" });
    // Counted when counted.
    expect(lineToDraft(parseLine("4 tomatoes")!)).toMatchObject({ quantity: 4, unit: "item" });
    // Packaged counted foods still count packs, not grams.
    expect(lineToDraft(parseLine("diced tomatoes 400g")!)).toMatchObject({ foodTypeId: "tinned-tomatoes", quantity: 1, unit: "tin" });
  });

  it("drops only the item named in 'Item unavailable: X'", () => {
    const r = parseLocalList(
      "Woolworths order\nOrder number: 123\nFull cream milk 2L\nQty: 1\n$3.10\nItem unavailable: Raspberries 125g\nEggs 12pk\nQty: 1\n$6.90\nSubtotal $10",
    );
    expect(r.lines.map((l) => l.name)).toEqual(["Full cream milk", "Eggs"]);
  });

  it("drops a named unavailable item that was listed earlier, and nothing else", () => {
    const r = parseLocalList("Milk 2L\nRaspberries 125g\nBananas\nItem unavailable: Raspberries 125g\nEggs");
    expect(r.lines.map((l) => l.name)).toEqual(["Milk", "Bananas", "Eggs"]);
  });

  it("skips an 'Unavailable items' section and keeps going after the next heading", () => {
    const r = parseLocalList(
      "Your order from Coles\nOrder number: 9\nMilk 2L\nUnavailable items:\nRaspberries 125g\nBeef mince 500g\nDelivered items\nBananas\nSubtotal $9",
    );
    expect(r.lines.map((l) => l.name)).toEqual(["Milk", "Bananas"]);
  });

  it("skips a line marked unavailable at the end", () => {
    expect(parseLocalList("Milk 2L\nRaspberries 125g - unavailable\nEggs").lines.map((l) => l.name)).toEqual(["Milk", "Eggs"]);
  });

  it("keeps the shopper's own name for a low-confidence match and suggests the food", () => {
    const d = lineToDraft({ name: "gnger root" });
    expect(d).toMatchObject({ name: "Gnger root", foodTypeId: null, confidence: "low" });
    expect(d.suggestion).toMatchObject({ foodTypeId: "ginger", name: "Fresh ginger" });
    // Accepting the suggestion clears it.
    expect(applyFoodType(d, d.suggestion!.foodTypeId)).toMatchObject({ foodTypeId: "ginger", suggestion: undefined });
    // A weak overlap on a generic word is not worth suggesting.
    expect(lineToDraft({ name: "ginger piece" }).foodTypeId).toBe("ginger");
    expect(lineToDraft({ name: "goat curry root" }).suggestion).toBeUndefined();
  });

  it("puts unknown raw meat in the fridge with a short use-by", () => {
    const d = lineToDraft(parseLine("venison sausages 500g")!);
    expect(d).toMatchObject({ foodTypeId: null, locationId: "fridge", dateKind: "use-by", quantity: 500, unit: "g" });
    expect(defaultsForUnknown("goat curry pieces")).toMatchObject({ locationId: "fridge", highRisk: true, days: 2 });
    // Other unknown foods also go to the fridge, but with a gentler estimate.
    expect(lineToDraft({ name: "Dragon fruit jam" })).toMatchObject({ locationId: "fridge", dateKind: "best-before" });
  });
});

describe("smart defaults and duplicates", () => {
  const added = (over: Partial<ItemEvent>): ItemEvent => ({
    id: Math.random().toString(36),
    itemId: "i",
    itemName: "Milk",
    foodTypeId: "milk",
    type: "added",
    at: new Date().toISOString(),
    ...over,
  });

  it("uses the last spot and amount for that food", () => {
    const events = [added({ locationId: "fridge", quantity: 2, unit: "L" }), added({ locationId: "door", quantity: 1, unit: "L" })];
    const d = withLastAdded(lineToDraft({ name: "milk" }), events, ["fridge", "door", "pantry", "freezer"]);
    expect(d).toMatchObject({ locationId: "door", quantity: 1, unit: "L" });
  });

  it("ignores spots that no longer exist", () => {
    const d = withLastAdded(lineToDraft({ name: "milk" }), [added({ locationId: "garage", quantity: 3, unit: "L" })], ["fridge"]);
    expect(d).toMatchObject({ locationId: "fridge", quantity: 3 });
  });

  it("finds an unopened item of the same food in the same spot", () => {
    const item = (over: Partial<PantryItem>): PantryItem => ({
      id: "a",
      name: "Milk",
      foodTypeId: "milk",
      emoji: "🥛",
      locationId: "fridge",
      quantity: 1,
      initialQuantity: 1,
      unit: "L",
      addedAt: new Date().toISOString(),
      dateKind: "use-by",
      source: "manual",
      ...over,
    });
    const draft = { foodTypeId: "milk", locationId: "fridge", unit: "L" as const, printedDate: undefined };
    expect(findMergeTarget(draft, [item({})])?.id).toBe("a");
    expect(findMergeTarget(draft, [item({ openedAt: new Date().toISOString() })])).toBeUndefined();
    expect(findMergeTarget(draft, [item({ locationId: "pantry" })])).toBeUndefined();
    expect(findMergeTarget(draft, [item({ printedDate: "2026-11-02" })])).toBeUndefined();
    expect(findMergeTarget({ ...draft, unit: "ml" }, [item({})])?.id).toBe("a");
    expect(findMergeTarget({ ...draft, unit: "item" }, [item({})])).toBeUndefined();
  });
});

describe("audit fixes: amounts, packaging and packs", () => {
  it("reads 12 eggs as a dozen, not 12 dozen", () => {
    expect(lineToDraft(parseLine("12 eggs")!)).toMatchObject({ foodTypeId: "eggs", quantity: 1, unit: "dozen" });
    expect(lineToDraft(parseLine("10 eggs")!)).toMatchObject({ foodTypeId: "eggs", quantity: 10, unit: "item" });
    expect(lineToDraft(parseLine("2x eggs")!)).toMatchObject({ foodTypeId: "eggs", quantity: 2, unit: "dozen" });
  });

  it("reads a bare trailing count", () => {
    expect(parseLine("bananas 6")).toMatchObject({ name: "bananas", count: 6 });
    expect(lineToDraft(parseLine("bananas 6")!)).toMatchObject({ foodTypeId: "banana", quantity: 6, unit: "item" });
    expect(parseLine("milk 2L")).toMatchObject({ name: "milk", size: { quantity: 2, unit: "L" } });
    expect(parseLine("milk 2L")?.count).toBeUndefined();
  });

  it("drops packaging words and keeps them as the unit when there's no size", () => {
    expect(parseLine("carrots 1kg bag")).toMatchObject({ name: "carrots", size: { quantity: 1, unit: "kg" } });
    expect(parseLine("punnet of raspberries")).toMatchObject({ name: "raspberries", pack: "punnet" });
    expect(parseLine("2 punnets raspberries")).toMatchObject({ name: "raspberries", count: 2, pack: "punnet" });
    expect(lineToDraft(parseLine("bag of tomatoes")!)).toMatchObject({ foodTypeId: "tomato", quantity: 1, unit: "bag" });
    expect(lineToDraft(parseLine("tub of mystery dip")!)).toMatchObject({ foodTypeId: null, quantity: 1, unit: "tub" });
    // The bag is the product.
    expect(parseLine("reusable bag")?.name).toBe("reusable bag");
    expect(parseLine("freezer bags")?.name).toBe("freezer bags");
    expect(isLikelyNonFood(parseLine("carrots 1kg bag")!.name)).toBe(false);
  });

  it("attaches a size-only line in an order email to the product above", () => {
    const r = parseLocalList("Coles Chicken Breast Fillets Large Pack per kg\n1.2kg\n$13.08");
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ size: { quantity: 1.2, unit: "kg" }, price: 13.08 });
    expect(r.lines[0].name).not.toMatch(/per kg|pack/i);
  });

  it("splits measured multi-packs into separate packs", () => {
    expect(lineToDraft(parseLine("2x beef mince 500g")!)).toMatchObject({ foodTypeId: "beef-mince", quantity: 500, unit: "g", packs: 2 });
    // Counted packs stay one line.
    expect(lineToDraft(parseLine("3x diced tomatoes")!).packs).toBeUndefined();
  });

  it("leaves weak partial matches unticked", () => {
    expect(lineToDraft({ name: "ging" })).toMatchObject({ foodTypeId: "ginger", confidence: "medium", include: false });
    expect(lineToDraft({ name: "milk" }).include).toBe(true);
    expect(lineToDraft({ name: "LOL" }).foodTypeId).toBeNull();
  });
});

describe("checkPrintedDate", () => {
  const now = new Date(2026, 10, 2, 12);
  it("flags dates far ahead or long past", () => {
    expect(checkPrintedDate("2026-11-20", now)).toBe("ok");
    expect(checkPrintedDate("2028-06-01", now)).toBe("ok");
    expect(checkPrintedDate("2062-03-04", now)).toBe("far-future");
    expect(checkPrintedDate("2019-05-01", now)).toBe("far-past");
    expect(checkPrintedDate(undefined, now)).toBe("ok");
  });
});

describe("findMergeTarget with a freshness check", () => {
  const now = new Date(2026, 10, 2, 12);
  const daysAgo = (n: number) => new Date(2026, 10, 2 - n, 9).toISOString();
  const item = (over: Partial<PantryItem>): PantryItem => ({
    id: "a",
    name: "Milk",
    foodTypeId: "milk",
    emoji: "🥛",
    locationId: "fridge",
    quantity: 1,
    initialQuantity: 1,
    unit: "L",
    addedAt: daysAgo(0),
    dateKind: "use-by",
    source: "manual",
    ...over,
  });
  const ctx = { locations: [{ id: "fridge", name: "Fridge", kind: "fridge" as const }], now };
  const draft = { foodTypeId: "milk", locationId: "fridge", unit: "L" as const, printedDate: undefined };
  it("never tops up an item that is old, due soon or past its date", () => {
    expect(findMergeTarget(draft, [item({})], ctx)?.id).toBe("a");
    expect(findMergeTarget(draft, [item({ addedAt: daysAgo(3) })], ctx)).toBeUndefined();
    expect(findMergeTarget(draft, [item({ addedAt: daysAgo(10) })], ctx)).toBeUndefined();
    // Same printed date and still fresh: same batch, fine to top up.
    expect(findMergeTarget({ ...draft, printedDate: "2026-11-20" }, [item({ addedAt: daysAgo(3), printedDate: "2026-11-20" })], ctx)?.id).toBe("a");
    expect(findMergeTarget({ ...draft, printedDate: "2026-11-03" }, [item({ printedDate: "2026-11-03" })], ctx)).toBeUndefined();
  });
});

describe("scrubPersonalInfo", () => {
  const email = [
    "Hi Sam Nguyen,",
    "Thanks for your order! Order number: AB12345678",
    "Delivery address: 12 Smith St, Newtown NSW 2042",
    "Unit 4/88 Albert Road",
    "Brisbane QLD 4000",
    "Call us on 1300 123 456 or text 0412 345 678. Your mobile: +61 412 345 678",
    "Contact: sam.nguyen@example.com",
    "Everyday Rewards card 1234 5678 9012 3456",
    "Flybuys: 6008123456789",
    "2 x Full cream milk 2L $5.60",
    "500g beef mince $9.00",
    "1 Place mats set $12.00",
  ].join("\n");
  const out = scrubPersonalInfo(email);

  it("removes names, addresses, contact details and account numbers", () => {
    expect(out).not.toMatch(/Sam|Nguyen|Smith|Albert|Newtown|Brisbane|4000/);
    expect(out).not.toMatch(/@|AB12345678|0412|412 345|1300|1234 5678|6008123456789/);
  });
  it("keeps the items and prices", () => {
    expect(out).toContain("2 x Full cream milk 2L $5.60");
    expect(out).toContain("500g beef mince $9.00");
    expect(out).toContain("1 Place mats set $12.00");
  });
  it("keeps a bare greeting and leaves a plain list alone", () => {
    expect(out).toContain("Hi");
    expect(scrubPersonalInfo("milk 2L\n2x tins tomatoes\nbananas")).toBe("milk 2L\n2x tins tomatoes\nbananas");
  });
});
