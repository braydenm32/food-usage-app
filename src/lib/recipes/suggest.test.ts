import { describe, expect, it } from "vitest";
import type { ItemStatus, PantryItem, Recipe } from "@/lib/types";
import { exclusionReason, isStaple, rankRecipes, type RankableItem } from "./suggest";
import { BUILTIN_RECIPES } from "./builtin";

function view(name: string, status: ItemStatus, daysLeft = 1, id = `id-${name}`): RankableItem {
  const item: PantryItem = {
    id,
    name,
    foodTypeId: null,
    emoji: "x",
    locationId: "fridge",
    quantity: 1,
    initialQuantity: 1,
    unit: "item",
    addedAt: new Date().toISOString(),
    dateKind: "best-before",
    source: "manual",
  };
  return { item, expiry: { status, daysLeft } };
}

function r(id: string, title: string, ingredients: string[], tags: string[] = []): Recipe {
  return {
    id,
    title,
    source: "builtin",
    servings: 2,
    ingredients: ingredients.map((name) => ({ name, foodTypeId: null })),
    steps: ["Cook."],
    tags,
  };
}

const noProfile = { diets: [], allergies: [], dislikes: [] };

describe("rankRecipes", () => {
  const spinachOmelette = r("a", "Spinach omelette", ["eggs", "baby spinach"]);
  const beefTacos = r("b", "Beef tacos", ["beef mince", "taco shells", "lettuce"]);

  it("prefers recipes that use items needing to be eaten first", () => {
    const views = [view("baby spinach", "use-today", 0), view("beef mince", "fresh", 6), view("eggs", "fresh", 9)];
    const ranked = rankRecipes([beefTacos, spinachOmelette], views, noProfile);
    expect(ranked[0].recipe.id).toBe("a");
    expect(ranked[0].itemIds).toEqual(["id-eggs", "id-baby spinach"]);
  });

  it("weights statuses and subtracts missing ingredients", () => {
    const [res] = rankRecipes([beefTacos], [view("beef mince", "use-soon", 2)], noProfile);
    expect(res.score).toBe(2 - 2);
    expect(res.missing.map((m) => m.name)).toEqual(["taco shells", "lettuce"]);
    expect(res.atRisk).toHaveLength(1);
  });

  it("ignores expired items, staples and optional ingredients", () => {
    const rec: Recipe = {
      ...r("c", "Toast", []),
      ingredients: [
        { name: "bread", foodTypeId: null },
        { name: "olive oil", foodTypeId: null },
        { name: "jam", foodTypeId: null, optional: true },
      ],
    };
    const [res] = rankRecipes([rec], [view("bread", "expired", -2)], noProfile);
    expect(res.uses).toHaveLength(0);
    expect(res.missing.map((m) => m.name)).toEqual(["bread"]);
    expect(isStaple({ name: "olive oil" })).toBe(true);
  });

  it("uses each pantry item once and prefers the most urgent copy", () => {
    const [res] = rankRecipes([r("d", "Eggs", ["eggs"])], [view("eggs", "fresh", 9, "old"), view("eggs", "use-soon", 2, "urgent")], noProfile);
    expect(res.itemIds).toEqual(["urgent"]);
  });
});

describe("dietary filters", () => {
  const bolognese = r("e", "Bolognese", ["beef mince", "spaghetti", "tasty cheese"]);
  const veg = r("f", "Veg curry", ["chickpeas", "coconut milk", "rice"], ["gluten-free"]);

  it("drops meat for vegetarians and dairy/egg for vegans", () => {
    expect(exclusionReason(bolognese, { ...noProfile, diets: ["vegetarian"] })).toBeTruthy();
    expect(exclusionReason(veg, { ...noProfile, diets: ["vegetarian"] })).toBeNull();
    const omelette = r("g", "Omelette", ["eggs", "tasty cheese"]);
    expect(exclusionReason(omelette, { ...noProfile, diets: ["vegetarian"] })).toBeNull();
    expect(exclusionReason(omelette, { ...noProfile, diets: ["vegan"] })).toBeTruthy();
  });

  it("honours allergies and dislikes", () => {
    expect(exclusionReason(bolognese, { ...noProfile, allergies: ["dairy"] })).toBeTruthy();
    expect(exclusionReason(bolognese, { ...noProfile, allergies: ["gluten"] })).toBeTruthy();
    expect(exclusionReason(veg, { ...noProfile, allergies: ["gluten"] })).toBeNull();
    expect(exclusionReason(veg, { ...noProfile, dislikes: ["chickpeas"] })).toBeTruthy();
    const ranked = rankRecipes([bolognese, veg], [], { ...noProfile, dislikes: ["Chickpea"] });
    expect(ranked.map((x) => x.recipe.id)).toEqual(["e"]);
  });

  it("gluten-free requires the tag when gluten ingredients are present", () => {
    expect(exclusionReason(r("h", "Pasta", ["spaghetti"]), { ...noProfile, diets: ["gluten-free"] })).toBeTruthy();
  });
});

describe("built-in recipes", () => {
  it("has unique ids and a healthy library", () => {
    expect(BUILTIN_RECIPES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(BUILTIN_RECIPES.map((x) => x.id)).size).toBe(BUILTIN_RECIPES.length);
    for (const rec of BUILTIN_RECIPES) {
      expect(rec.steps.length).toBeGreaterThan(1);
      expect(rec.ingredients.length).toBeGreaterThan(2);
    }
  });

  it("vegetarian filter leaves only meat-free built-ins", () => {
    const ranked = rankRecipes(BUILTIN_RECIPES, [], { ...noProfile, diets: ["vegetarian"] });
    expect(ranked.length).toBeGreaterThan(8);
    expect(ranked.some((x) => x.recipe.id === "builtin-spag-bol")).toBe(false);
  });
});
