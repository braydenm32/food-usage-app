import "server-only";
import { matchFoodType } from "@/lib/shelf-life/foods";
import type { Recipe } from "@/lib/types";
import data from "./data/wikibooks.json";

/** Snapshot of the Wikibooks Cookbook (CC BY-SA 4.0), built by scripts/import-wikibooks.ts. */
const RECIPES = (data as { recipes: Recipe[] }).recipes;
const BY_ID = new Map(RECIPES.map((r) => [r.id, r]));

export function wikibooksRecipe(id: string): Recipe | null {
  return BY_ID.get(id) ?? null;
}

const words = (s: string) => s.toLowerCase().match(/[a-z]+/g) ?? [];
const singular = (w: string) =>
  w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.endsWith("oes") ? w.slice(0, -2) : w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;

/** Recipes that use an ingredient, best matches first: same food type, then name words, then title. */
export function searchWikibooks(ingredient: string, limit: number): Recipe[] {
  const match = matchFoodType(ingredient);
  const typeId = match && match.score >= 45 ? match.food.id : null;
  const qWords = words(ingredient).map(singular).filter((w) => w.length > 2);
  if (!typeId && qWords.length === 0) return [];

  const scored: { r: Recipe; score: number }[] = [];
  for (const r of RECIPES) {
    let score = 0;
    for (const i of r.ingredients) {
      const iw = new Set(words(i.name).map(singular));
      if (typeId && i.foodTypeId === typeId) score = Math.max(score, 3);
      else if (qWords.length && qWords.every((w) => iw.has(w))) score = Math.max(score, 2);
    }
    if (score === 0) continue;
    const tw = new Set(words(r.title).map(singular));
    if (qWords.some((w) => tw.has(w))) score += 1;
    // Shorter, home-cook friendly recipes first among equals.
    score -= Math.min(r.ingredients.length, 20) / 40;
    scored.push({ r, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.r.title.localeCompare(b.r.title))
    .slice(0, limit)
    .map((s) => s.r);
}
