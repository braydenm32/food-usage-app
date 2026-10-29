import { describe, expect, it, vi } from "vitest";
import type { FoodType } from "./types";

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
    { ...base, id: "eggs", name: "Eggs", aliases: ["egg", "free range eggs"], category: "eggs", aisle: "Dairy, Eggs & Fridge", emoji: "🥚", dateKind: "best-before", defaultLocation: "fridge", defaultUnit: "item", defaultQuantity: 12 },
    { ...base, id: "beef-mince", name: "Beef mince", aliases: ["mince", "beef mince"], category: "meat", aisle: "Meat & Seafood", emoji: "🥩", dateKind: "use-by", defaultLocation: "fridge", defaultUnit: "g", defaultQuantity: 500 },
    { ...base, id: "banana", name: "Bananas", aliases: ["banana", "cavendish"], category: "fruit", aisle: "Fruit & Veg", emoji: "🍌", dateKind: "best-before", defaultLocation: "pantry", defaultUnit: "item", defaultQuantity: 6 },
    { ...base, id: "tinned-tomatoes", name: "Tinned tomatoes", aliases: ["diced tomatoes", "crushed tomatoes"], category: "pantry", aisle: "Pantry", emoji: "🥫", dateKind: "best-before", defaultLocation: "pantry", defaultUnit: "tin", defaultQuantity: 1 },
    { ...base, id: "raspberries", name: "Raspberries", aliases: ["raspberry", "rspbry"], category: "fruit", aisle: "Fruit & Veg", emoji: "🫐", dateKind: "use-by", defaultLocation: "fridge", defaultUnit: "g", defaultQuantity: 125 },
  ];
  return { FOOD_TYPES };
});

const { parseLine, parseLocalList, lineToDraft, resolveQuantity, looksLikeOrderEmail, isLikelyNonFood, freeTextDraft, applyFoodType, offProductToResponse } =
  await import("./drafts");

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
    expect(d).toMatchObject({ foodTypeId: "milk", emoji: "🥛", locationId: "fridge", dateKind: "use-by", quantity: 4, unit: "L", include: true, isFood: true });
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
    expect(d).toMatchObject({ foodTypeId: "eggs", emoji: "🥚", unit: "item", confidence: "high" });
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
    expect(drafts[0]).toMatchObject({ foodTypeId: "milk", quantity: 4, unit: "L", price: 6.2 });
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
