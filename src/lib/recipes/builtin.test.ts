import { describe, expect, it } from "vitest";
import type { Diet } from "@/lib/types";
import { BUILTIN_RECIPES } from "./builtin";
import { exclusionReason } from "./filter";

const DIET_TAGS: Diet[] = ["vegetarian", "vegan", "gluten-free", "dairy-free"];
const none = { allergies: [], dislikes: [] };

describe("built-in recipe diet tags", () => {
  // Tags must agree with the ingredients, both ways: a tag the filter would reject is wrong,
  // and a diet the recipe fits should be tagged so people can find it.
  for (const r of BUILTIN_RECIPES) {
    it(`${r.title} has diet tags that match its ingredients`, () => {
      for (const diet of DIET_TAGS) {
        const fits = exclusionReason(r, { ...none, diets: [diet] }) === null;
        expect({ diet, tagged: r.tags.includes(diet) }).toEqual({ diet, tagged: fits });
      }
    });
  }

  it("lists oil or butter when a step fries, browns or softens something", () => {
    for (const r of BUILTIN_RECIPES) {
      const fries = r.steps.some((s) => /\b(fry|fried|brown|soften|sear|stir-fry)\b/i.test(s));
      const fat = r.ingredients.some((i) => /\b(oil|butter)\b/i.test(i.name));
      if (fries && !/mince/.test(r.title.toLowerCase())) expect({ title: r.title, fat }).toEqual({ title: r.title, fat: true });
    }
  });

  it("measures water in millilitres, not cups", () => {
    for (const r of BUILTIN_RECIPES) for (const s of r.steps) expect(s).not.toMatch(/\b(?:a|half a|\d+(?:\/\d+)?)\s+cups?\b/i);
  });

  it("says 'if using' wherever a step uses an optional ingredient", () => {
    for (const r of BUILTIN_RECIPES) {
      for (const ing of r.ingredients.filter((i) => i.optional)) {
        const word = ing.name.split(" ").pop()!.replace(/s$/, "");
        const steps = r.steps.filter((s) => new RegExp(`\\b${word}`, "i").test(s));
        for (const s of steps) expect({ title: r.title, step: s, ok: /if using|if you like/i.test(s) }).toMatchObject({ ok: true });
      }
    }
  });
});
