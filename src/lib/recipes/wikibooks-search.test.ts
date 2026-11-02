import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { searchWikibooks, wikibooksRecipe } from "./wikibooks-search";
import data from "./data/wikibooks.json";

describe("bundled Wikibooks recipes", () => {
  const recipes = (data as { recipes: { id: string; credit?: { licence?: string }; ingredients: unknown[]; steps: unknown[] }[] }).recipes;

  it("all carry the CC BY-SA credit and enough content", () => {
    expect(recipes.length).toBeGreaterThan(40);
    for (const r of recipes) {
      expect(r.credit?.licence).toBe("CC BY-SA 4.0");
      expect(r.ingredients.length).toBeGreaterThanOrEqual(2);
      expect(r.steps.length).toBeGreaterThanOrEqual(2);
    }
    expect(new Set(recipes.map((r) => r.id)).size).toBe(recipes.length);
  });

  it("finds recipes by ingredient and looks them up by id", () => {
    const found = searchWikibooks("chicken", 4);
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((r) => r.ingredients.some((i) => /chicken/i.test(i.name)))).toBe(true);
    expect(wikibooksRecipe(found[0].id)?.title).toBe(found[0].title);
    expect(searchWikibooks("zzzz", 4)).toEqual([]);
  });
});
