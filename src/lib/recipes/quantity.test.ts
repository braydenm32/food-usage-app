import { describe, expect, it } from "vitest";
import type { PantryItem, Recipe, RecipeIngredient, Unit } from "@/lib/types";
import { defaultDeduction, displayIngredient, formatAmount, ingredientName, isBatchRecipe, planDeductions } from "./quantity";
import { ingredientMatchesItem } from "./suggest";
import { getBuiltinRecipe } from "./builtin";

function item(name: string, foodTypeId: string | null, quantity: number, unit: Unit, id = name): PantryItem {
  return { id, name, foodTypeId, emoji: "x", locationId: "pantry", quantity, initialQuantity: quantity, unit, addedAt: "2026-01-01T00:00:00Z", dateKind: "best-before", source: "manual" };
}
const ing = (name: string, quantity: number | undefined, unit: string | undefined, foodTypeId: string | null, extra: Partial<RecipeIngredient> = {}): RecipeIngredient => ({ name, quantity, unit, foodTypeId, ...extra });

describe("I cooked this: starting deductions", () => {
  it("takes grams from a kg bag using typical sizes, not the whole bag", () => {
    expect(defaultDeduction(ing("brown onion", 1, "item", "onion-brown"), item("Brown onions", "onion-brown", 1, "kg"), 1)).toBe(0.15);
    expect(defaultDeduction(ing("carrot", 2, "item", "carrot"), item("Carrots", "carrot", 1, "kg"), 1)).toBe(0.24);
  });

  it("never takes oil, sauces or spices by default", () => {
    expect(defaultDeduction(ing("olive oil", 1, "tbsp", "oil-olive"), item("Olive oil", "oil-olive", 1, "bottle"), 1)).toBe(0);
    expect(defaultDeduction(ing("soy sauce", 2, "tbsp", "soy-sauce"), item("Soy sauce", "soy-sauce", 1, "bottle"), 1)).toBe(0);
    expect(defaultDeduction(ing("ground cumin", 2, "tsp", "spices"), item("Cumin", "spices", 1, "jar"), 1)).toBe(0);
  });

  it("defaults to none when the units can't be compared, and for optional things", () => {
    expect(defaultDeduction(ing("mystery", 2, "handful", null), item("Mystery", null, 1, "pack"), 1)).toBe(0);
    expect(defaultDeduction(ing("tasty cheese", 40, "g", "cheese-tasty", { optional: true }), item("Cheese", "cheese-tasty", 500, "g"), 1)).toBe(0);
  });

  it("allows part of a jar, tin or loaf", () => {
    expect(defaultDeduction(ing("pasta sauce", 250, "g", "pasta-sauce"), item("Pasta sauce", "pasta-sauce", 1, "jar"), 1)).toBe(0.5);
    expect(defaultDeduction(ing("bread", 6, "slice", "bread-loaf"), item("Bread", "bread-loaf", 1, "loaf"), 1)).toBe(0.25);
    expect(defaultDeduction(ing("garlic", 2, "clove", "garlic"), item("Garlic", "garlic", 2, "item"), 1)).toBe(0.25);
    expect(defaultDeduction(ing("tinned tomatoes", 400, "g", "tinned-tomatoes"), item("Tomatoes", "tinned-tomatoes", 3, "tin"), 1)).toBe(1);
  });

  it("spills the rest onto the next matching item", () => {
    const recipe: Recipe = { id: "r", title: "Mince", source: "builtin", servings: 4, ingredients: [ing("beef mince", 500, "g", "beef-mince")], steps: [], tags: [] };
    const items = [item("Beef mince", "beef-mince", 300, "g", "a"), item("Beef mince", "beef-mince", 500, "g", "b")];
    const rows = planDeductions(recipe, [{ itemId: "a", ingredient: "beef mince" }], items, 1, ingredientMatchesItem);
    expect(rows).toEqual([
      { itemId: "a", ingredient: "beef mince", amount: 300 },
      { itemId: "b", ingredient: "beef mince", amount: 200, spill: true },
    ]);
  });

  it("spills only onto the candidates it is given, in their order", () => {
    const recipe: Recipe = { id: "r", title: "Mince", source: "builtin", servings: 4, ingredients: [ing("beef mince", 500, "g", "beef-mince")], steps: [], tags: [] };
    const items = [item("Beef mince", "beef-mince", 300, "g", "a"), item("Off mince", "beef-mince", 500, "g", "off"), item("Beef mince", "beef-mince", 500, "g", "c")];
    const rows = planDeductions(recipe, [{ itemId: "a", ingredient: "beef mince" }], items, 1, ingredientMatchesItem, () => [items[2]]);
    expect(rows.map((r) => r.itemId)).toEqual(["a", "c"]);
  });

  it("spag bol for 2 doesn't wipe out whole bags and bottles", () => {
    const bol = getBuiltinRecipe("builtin-spag-bol")!;
    const larder = [
      item("Brown onions", "onion-brown", 1, "kg"),
      item("Carrots", "carrot", 1, "kg"),
      item("Olive oil", "oil-olive", 1, "bottle"),
      item("Pasta sauce", "pasta-sauce", 1, "jar"),
    ];
    for (const it of larder) {
      const i = bol.ingredients.find((x) => ingredientMatchesItem(x, it))!;
      expect(defaultDeduction(i, it, 0.5)).toBeLessThan(it.quantity);
    }
  });
});

describe("scaled amounts read well", () => {
  it("rounds countable things to halves and grams to whole numbers", () => {
    expect(displayIngredient(ing("brown onion", 1, "item", null), 2 / 6).quantity).toBe(0.5);
    expect(displayIngredient(ing("carrot", 2, "item", null), 2 / 6).quantity).toBe(0.5);
    expect(formatAmount(displayIngredient(ing("cheese", 40, "g", null), 1 / 3).quantity, "g")).toBe("13g");
    expect(formatAmount(13.333, "g")).toBe("13g");
  });

  it("turns small cups into spoons", () => {
    const s = displayIngredient(ing("sugar", 1, "cup", null), 1 / 6, 20);
    expect(s.unit).toBe("tbsp");
    expect(s.quantity).toBe(2);
    const t = displayIngredient(ing("salt", 0.5, "tsp", null), 1 / 6);
    expect(t.quantity).toBe(0.25);
  });

  it("matches the name to the count", () => {
    expect(ingredientName("brown onion", 2)).toBe("brown onions");
    expect(ingredientName("bananas", 1)).toBe("banana");
    expect(ingredientName("tomato", 3)).toBe("tomatoes");
    expect(ingredientName("broccoli", 2)).toBe("broccoli");
    expect(ingredientName("beef mince", 500, "g")).toBe("beef mince");
  });

  it("knows baking and batch recipes", () => {
    expect(isBatchRecipe(getBuiltinRecipe("builtin-banana-bread")!)).toBe(true);
    expect(isBatchRecipe(getBuiltinRecipe("builtin-spag-bol")!)).toBe(false);
  });
});
