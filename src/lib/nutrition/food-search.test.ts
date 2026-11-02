import { describe, expect, it } from "vitest";
import { foodMealEntry, leftoversEntry, recentCooked, searchFoods, shortFoodName } from "./food-search";
import type { MealEntry } from "./meal-log";

describe("searchFoods", () => {
  it("finds foods by every typed word, main name first", () => {
    const r = searchFoods("banana");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].name.toLowerCase().startsWith("banana")).toBe(true);
    expect(searchFoods("")).toEqual([]);
    expect(searchFoods("zzzqqq")).toEqual([]);
  });
  it("accepts word prefixes", () => {
    expect(searchFoods("bana").length).toBeGreaterThan(0);
  });
});

describe("meal entries", () => {
  const food = { key: "x", name: "Apple, red skin, raw", n: { energyKj: 200, protein: 0.4 } };
  it("scales per-100 g values to the grams eaten", () => {
    const e = foodMealEntry(food, 150, "2026-11-02");
    expect(e.perServing.energyKj).toBeCloseTo(300);
    expect(e.title).toBe("Apple, red skin (150 g)");
    expect(e.servings).toBe(1);
  });
  it("shortens names", () => {
    expect(shortFoodName("Banana, cavendish, peeled, raw")).toBe("Banana, cavendish");
  });
  it("logs one serving of leftovers and lists recent cooked meals once each", () => {
    const meal: MealEntry = { id: "m1", at: "2026-11-01T08:00:00.000Z", date: "2026-11-01", recipeId: "r1", title: "Dal", servings: 2, perServing: { protein: 10 } };
    const left = leftoversEntry(meal, "2026-11-02");
    expect(left).toMatchObject({ title: "Dal (leftovers)", servings: 1, recipeId: "r1" });
    const again = { ...meal, id: "m2", at: "2026-11-02T08:00:00.000Z", title: "Dal (leftovers)" };
    const snack = { ...meal, id: "m3", recipeId: undefined, title: "Apple (150 g)" };
    expect(recentCooked([meal, again, snack], "2026-11-02").map((m) => m.id)).toEqual(["m2"]);
  });
});
