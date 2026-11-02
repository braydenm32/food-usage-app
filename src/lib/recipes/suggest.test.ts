import { describe, expect, it } from "vitest";
import type { ItemStatus, PantryItem, Recipe } from "@/lib/types";
import { analyseRecipe, exclusionReason, isStaple, labelChecks, matchIngredient, rankRecipes, spillCandidates, type RankableItem } from "./suggest";
import { BUILTIN_RECIPES } from "./builtin";

function view(name: string, status: ItemStatus, daysLeft = 1, id = `id-${name}`, extra: Partial<PantryItem> = {}): RankableItem {
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
    ...extra,
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
    const [res] = rankRecipes([rec], [view("bread", "expired", -2, "b", { dateKind: "use-by" })], noProfile);
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

const typed = (name: string, foodTypeId: string, status: ItemStatus = "fresh", daysLeft = 5) =>
  view(name, status, daysLeft, `id-${name}`, { foodTypeId });

describe("matching larder items to ingredients", () => {
  const ing = (name: string, foodTypeId: string | null) => ({ name, foodTypeId });

  it("accepts close varieties of the same food", () => {
    expect(matchIngredient(ing("capsicum", "capsicum-red"), typed("Green capsicum", "capsicum-green").item)).toBe("family");
    expect(matchIngredient(ing("milk", "milk-full-cream"), typed("Light milk", "milk-skim").item)).toBe("family");
    expect(matchIngredient(ing("milk", "milk-full-cream"), typed("Oat milk", "milk-oat").item)).toBe("substitute");
    expect(matchIngredient(ing("bread", "bread-loaf"), typed("Sourdough", "sourdough").item)).toBe("family");
    expect(matchIngredient(ing("rice", "rice-white"), typed("Brown rice", "rice-brown").item)).toBe("family");
    expect(matchIngredient(ing("tasty cheese", "cheese-tasty"), typed("Grated cheese", "cheese-shredded").item)).toBe("family");
    expect(matchIngredient(ing("tomato", "tomato"), typed("Cherry tomatoes", "cherry-tomato").item)).toBe("family");
    expect(matchIngredient(ing("brown onion", "onion-brown"), typed("White onion", "onion-white").item)).toBe("family");
    expect(matchIngredient(ing("greek yoghurt", "greek-yoghurt"), typed("Natural yoghurt", "yoghurt-natural").item)).toBe("family");
    expect(matchIngredient(ing("chicken thigh", "chicken-thigh"), typed("Chicken", "chicken-breast").item)).toBe("family");
    expect(matchIngredient(ing("fish fillets", "white-fish"), typed("Salmon", "salmon-fillet").item)).toBe("family");
  });

  it("reads 'pork or chicken mince' as either", () => {
    expect(matchIngredient(ing("pork or chicken mince", "pork-mince"), typed("Chicken mince", "chicken-mince").item)).toBe("exact");
    expect(matchIngredient(ing("pork or chicken mince", "pork-mince"), typed("Beef mince", "beef-mince").item)).toBeNull();
  });

  it("doesn't let catch-all food types match unlike foods", () => {
    expect(matchIngredient(ing("ground cumin", "spices"), typed("Cinnamon", "spices").item)).toBeNull();
    expect(matchIngredient(ing("vegetable stock", "stock"), typed("Chicken stock", "stock").item)).toBeNull();
    expect(matchIngredient(ing("corn chips", "chips"), typed("Potato chips", "chips").item)).toBeNull();
    expect(matchIngredient(ing("maple syrup", "syrup"), typed("Golden syrup", "syrup").item)).toBeNull();
    expect(matchIngredient(ing("oyster sauce", "asian-sauces"), typed("Hoisin sauce", "asian-sauces").item)).toBeNull();
    expect(matchIngredient(ing("vegetable stock", "stock"), typed("Massel vegetable stock 1L", "stock").item)).toBe("name");
  });

  it("still uses food past its best-before date, flagged to check", () => {
    const rec = r("bb", "Toast", ["bread"]);
    const printed = (v: RankableItem): RankableItem => ({ ...v, expiry: { ...v.expiry, estimated: false } });
    const a = analyseRecipe(rec, [printed(view("bread", "expired", -1))]);
    expect(a.uses).toHaveLength(1);
    expect(a.uses[0].pastBestBefore).toBe(true);
    expect(a.atRisk).toHaveLength(1);
    expect(analyseRecipe(rec, [view("bread", "expired", -1, "x", { dateKind: "use-by" })]).uses).toHaveLength(0);
    // An estimate that ran out, or food frozen past its date, is "check it", not a quality date.
    expect(analyseRecipe(rec, [view("bread", "expired", -1)]).uses).toHaveLength(0);
    expect(analyseRecipe(rec, [printed(view("bread", "expired", -1, "y", { expiredWhenFrozen: true }))]).uses).toHaveLength(0);
  });

  it("spills onto usable stock only, closest match and soonest first", () => {
    const tv = (id: string, foodTypeId: string, status: ItemStatus, daysLeft: number, extra: Partial<PantryItem> = {}) =>
      view(id, status, daysLeft, id, { foodTypeId, ...extra });
    const pick = spillCandidates([
      tv("skim", "milk-skim", "fresh", 5),
      tv("fc6", "milk-full-cream", "fresh", 6),
      tv("fc1", "milk-full-cream", "use-soon", 1),
      tv("off", "milk-full-cream", "expired", -2, { dateKind: "use-by" }),
      tv("oat", "milk-oat", "use-today", 0),
    ]);
    expect(pick(ing("milk", "milk-full-cream") as Recipe["ingredients"][number]).map((i) => i.id)).toEqual(["fc1", "fc6", "skim", "oat"]);
  });
});

describe("ranking spreads cards across at-risk items", () => {
  it("doesn't let one item fill the top of the list", () => {
    const recipes = [
      r("b1", "Banana bread", ["banana", "egg"]),
      r("b2", "Banana smoothie", ["banana", "milk"]),
      r("b3", "Banana pancakes", ["banana", "flour"]),
      r("av", "Avo toast", ["avocado", "bread"]),
    ];
    const views = [view("banana", "use-today", 0), view("avocado", "use-soon", 2), view("egg", "fresh", 9), view("milk", "fresh", 6), view("bread", "fresh", 4)];
    const ids = rankRecipes(recipes, views, noProfile).map((x) => x.recipe.id);
    expect(ids.indexOf("av")).toBeLessThanOrEqual(1);
  });
});

describe("check the label", () => {
  const tacos = BUILTIN_RECIPES.find((x) => x.id === "builtin-beef-tacos")!;
  const curry = BUILTIN_RECIPES.find((x) => x.id === "builtin-chickpea-curry")!;
  it("flags processed foods for gluten-free and coeliac households", () => {
    expect(labelChecks(tacos, { ...noProfile, diets: ["gluten-free"] }).map((c) => c.ingredient)).toContain("taco seasoning");
    expect(labelChecks(tacos, { ...noProfile, allergies: ["coeliac"] }).length).toBeGreaterThan(0);
    expect(labelChecks(tacos, noProfile)).toEqual([]);
  });
  it("flags curry paste for vegans without hiding the recipe", () => {
    const vegan = { ...noProfile, diets: ["vegan" as const] };
    expect(labelChecks(curry, vegan).map((c) => c.ingredient)).toContain("curry paste");
    expect(exclusionReason(curry, vegan)).toBeNull();
  });
  it("treats flour, sugar, banana and corn chips as carbs", () => {
    const lowCarb = { ...noProfile, diets: ["low-carb" as const] };
    for (const id of ["builtin-banana-bread", "builtin-nachos", "builtin-smoothie", "builtin-beef-tacos"]) {
      expect(exclusionReason(BUILTIN_RECIPES.find((x) => x.id === id)!, lowCarb)).toBeTruthy();
    }
  });
});
