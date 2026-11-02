import { describe, expect, it } from "vitest";
import { ingredientGrams, matchFood, recipeNutrition, topContributors, type FoodComposition } from "./engine";
import { contributorsFor, dailyAverage, mealsCsv, quickAddText, targetState, totalsFor, type MealEntry } from "./meal-log";
import { NUTRIENT, addNutrients, kcal, scaleNutrients } from "./nutrients";
import type { Recipe } from "@/lib/types";

const FOODS: FoodComposition[] = [
  { key: "egg", name: "Egg, chicken, whole, raw", n: { energyKj: 576, protein: 12.6, fat: 9.5 } },
  { key: "egg-fried", name: "Egg, chicken, whole, fried, no added fat", n: { energyKj: 700, protein: 14, fat: 11 } },
  { key: "onion", name: "Onion, brown, peeled, raw", n: { energyKj: 120, protein: 1.4, carbs: 5.5 } },
  { key: "flour", name: "Flour, wheat, white, plain", n: { energyKj: 1450, protein: 10, carbs: 72 } },
  { key: "milk", name: "Milk, cow, fluid, regular fat", n: { energyKj: 270, protein: 3.4, fat: 3.5, calcium: 115 } },
  { key: "tomato-can", name: "Tomato, canned, whole, no added salt", n: { energyKj: 85, carbs: 3 } },
];

const recipe = (p: Partial<Recipe>): Recipe => ({ id: "r", title: "Test", source: "saved", servings: 2, ingredients: [], steps: [], tags: [], ...p });

describe("nutrients", () => {
  it("adds, scales and converts", () => {
    expect(addNutrients({ protein: 1 }, { protein: 2, fat: 1 }, 2)).toEqual({ protein: 5, fat: 2 });
    expect(scaleNutrients({ protein: 10 }, 0.5)).toEqual({ protein: 5 });
    expect(kcal(4184)).toBe(1000);
    expect(kcal(undefined)).toBeUndefined();
    expect(NUTRIENT.vitA.afcd.test("Vitamin A retinol equivalents (ug)")).toBe(true);
    expect(NUTRIENT.magnesium.afcd.test("Magnesium (Mg) (mg)")).toBe(true);
  });
});

describe("ingredientGrams", () => {
  it("uses weights as written", () => {
    expect(ingredientGrams({ name: "beef mince", quantity: 0.5, unit: "kg" })?.grams).toBe(500);
  });
  it("uses density for cups and the recipe's tablespoon", () => {
    expect(ingredientGrams({ name: "plain flour", quantity: 1, unit: "cup" })?.grams).toBeCloseTo(132.5);
    expect(ingredientGrams({ name: "olive oil", quantity: 1, unit: "tbsp" }, 15)?.grams).toBeCloseTo(13.8);
    expect(ingredientGrams({ name: "milk", quantity: 1, unit: "tbsp" }, 20)?.grams).toBe(20);
  });
  it("uses typical weights for whole items, pack sizes, and the midpoint of ranges", () => {
    expect(ingredientGrams({ name: "eggs", quantity: 2 })?.grams).toBe(100);
    expect(ingredientGrams({ name: "garlic", quantity: 3, unit: "clove" })?.grams).toBe(15);
    expect(ingredientGrams({ name: "crushed tomatoes", quantity: 1, unit: "tin", note: "400g" })?.grams).toBe(400);
    expect(ingredientGrams({ name: "crushed tomatoes", quantity: 1, unit: "tin" })?.grams).toBe(400);
    expect(ingredientGrams({ name: "eggs", quantity: 2, quantityMax: 4 })?.grams).toBe(150);
  });
  it("gives up when it can't tell", () => {
    expect(ingredientGrams({ name: "salt", note: "to taste" })).toBeNull();
    expect(ingredientGrams({ name: "mystery thing", quantity: 1 })).toBeNull();
  });
});

describe("matchFood", () => {
  it("prefers the raw, plain food", () => {
    expect(matchFood("eggs", FOODS)?.key).toBe("egg");
    expect(matchFood("brown onion, diced", FOODS)?.key).toBe("onion");
    expect(matchFood("plain flour", FOODS)?.key).toBe("flour");
  });
  it("returns null for things it doesn't know", () => {
    expect(matchFood("saffron", FOODS)).toBeNull();
    expect(matchFood("", FOODS)).toBeNull();
  });
});

describe("recipeNutrition", () => {
  const r = recipe({
    servings: 2,
    ingredients: [
      { name: "eggs", quantity: 4 },
      { name: "milk", quantity: 100, unit: "ml" },
      { name: "salt", note: "to taste" },
      { name: "saffron", quantity: 1, unit: "pinch" },
    ],
  });

  it("totals matched ingredients and divides by servings", () => {
    const n = recipeNutrition(r, 2, FOODS);
    // 200 g egg + 100 g milk
    expect(n.total.protein).toBeCloseTo(12.6 * 2 + 3.4);
    expect(n.perServing.protein).toBeCloseTo((12.6 * 2 + 3.4) / 2);
    expect(n.total.calcium).toBeCloseTo(115);
  });
  it("lists what it left out, except to-taste extras", () => {
    const n = recipeNutrition(r, 2, FOODS);
    expect(n.missing.map((m) => m.ingredient.name)).toEqual(["saffron"]);
    expect(n.coverage).toBeGreaterThan(0.99);
  });
  it("scales the whole recipe but keeps per-serving the same", () => {
    const n = recipeNutrition(r, 4, FOODS);
    expect(n.total.protein).toBeCloseTo((12.6 * 2 + 3.4) * 2);
    expect(n.perServing.protein).toBeCloseTo((12.6 * 2 + 3.4) / 2);
  });
  it("honours a food the user picked", () => {
    const n = recipeNutrition(r, 2, FOODS, { eggs: "egg-fried" });
    expect(n.rows[0].food?.key).toBe("egg-fried");
  });
  it("ranks top contributors", () => {
    const top = topContributors(recipeNutrition(r, 2, FOODS).rows, "protein");
    expect(top[0].name).toBe("eggs");
    expect(top.reduce((s, t) => s + t.share, 0)).toBeCloseTo(1);
  });
});

describe("meal log maths", () => {
  const meal = (p: Partial<MealEntry>): MealEntry => ({
    id: Math.random().toString(36),
    at: "2026-11-02T08:00:00.000Z",
    date: "2026-11-02",
    title: "Omelette",
    servings: 1,
    perServing: { energyKj: 1000, protein: 20 },
    contributors: [
      { name: "Eggs", n: { protein: 15 } },
      { name: "Milk", n: { protein: 5 } },
    ],
    ...p,
  });
  const meals = [meal({}), meal({ servings: 2 }), meal({ date: "2026-11-01", perServing: { protein: 10 }, contributors: [{ name: "Tofu", n: { protein: 10 } }] })];

  it("totals a day", () => {
    expect(totalsFor(meals, new Set(["2026-11-02"])).protein).toBe(60);
  });
  it("averages over logged days only", () => {
    const { avg, days } = dailyAverage(meals, "2026-10-01", "2026-11-30");
    expect(days).toBe(2);
    expect(avg.protein).toBe(35);
    expect(dailyAverage([], "2026-10-01", "2026-11-30").days).toBe(0);
  });
  it("ranks contributors across meals", () => {
    const c = contributorsFor(meals, "protein");
    expect(c[0]).toMatchObject({ name: "eggs", amount: 45 });
    expect(c.map((x) => x.name)).toEqual(["eggs", "milk", "tofu"]);
  });
  it("checks targets", () => {
    expect(targetState(50, { min: 60 })).toBe("under");
    expect(targetState(70, { min: 60, max: 80 })).toBe("ok");
    expect(targetState(90, { max: 80 })).toBe("over");
    expect(targetState(undefined, { max: 80 })).toBeNull();
  });
  it("formats Quick Add text and CSV", () => {
    const t = quickAddText("Omelette", { energyKj: 4184, protein: 20.4 });
    expect(t).toContain("Calories: 1000 kcal");
    expect(t).toContain("Protein: 20 g");
    const csv = mealsCsv([meal({ title: 'Eggs, "fancy"' })]).split("\n");
    expect(csv).toHaveLength(2);
    expect(csv[1]).toContain('"Eggs, ""fancy"""');
  });
});
