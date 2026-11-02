// Find a food in the Australian Food Composition Database by name, and turn grams of it into
// a meal log entry ("Log a food" on the Nutrition screen).

import afcd from "./data/afcd.json";
import type { FoodComposition } from "./engine";
import type { MealEntry } from "./meal-log";
import { scaleNutrients } from "./nutrients";

const FOODS = afcd as FoodComposition[];

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * Foods whose name has every typed word (or a word starting with it), best first: the main name
 * (before the first comma) matching, fewer extra words, and raw or plain forms rank higher.
 */
export function searchFoods(query: string, limit = 8, foods: FoodComposition[] = FOODS): FoodComposition[] {
  const want = words(query);
  if (want.length === 0) return [];
  const scored: { f: FoodComposition; score: number }[] = [];
  for (const f of foods) {
    const comma = f.name.indexOf(",");
    const base = words(comma < 0 ? f.name : f.name.slice(0, comma));
    const all = words(f.name);
    if (!want.every((w) => all.some((t) => t.startsWith(w)))) continue;
    let score = 0;
    for (const w of want) {
      if (base.includes(w)) score += 3;
      else if (base.some((t) => t.startsWith(w))) score += 2;
      else score += 1;
    }
    score -= (all.length - want.length) * 0.2;
    if (/\b(raw|fresh|plain)\b/i.test(f.name)) score += 0.5;
    scored.push({ f, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.f.name.length - b.f.name.length)
    .slice(0, limit)
    .map((s) => s.f);
}

/** Short display name: "Banana, cavendish, peeled, raw" → "Banana, cavendish". */
export function shortFoodName(name: string): string {
  return name.split(",").slice(0, 2).join(",").trim();
}

/** A meal log entry for `grams` of a database food, eaten on `date` (local YYYY-MM-DD). */
export function foodMealEntry(food: FoodComposition, grams: number, date: string, at = new Date()): Omit<MealEntry, "id"> {
  const n = scaleNutrients(food.n, grams / 100);
  const name = shortFoodName(food.name);
  return {
    at: at.toISOString(),
    date,
    title: `${name} (${Math.round(grams)} g)`,
    servings: 1,
    perServing: n,
    contributors: [{ name, n }],
  };
}

/** One more serving of a meal already in the log (eating the leftovers of something you cooked). */
export function leftoversEntry(meal: MealEntry, date: string, at = new Date()): Omit<MealEntry, "id"> {
  return {
    at: at.toISOString(),
    date,
    recipeId: meal.recipeId,
    title: meal.title.endsWith("(leftovers)") ? meal.title : `${meal.title} (leftovers)`,
    servings: 1,
    perServing: meal.perServing,
    contributors: meal.contributors,
  };
}

/** Recently cooked meals worth offering as leftovers: one per recipe or title, newest first. */
export function recentCooked(meals: MealEntry[], today: string, days = 5): MealEntry[] {
  const from = new Date(`${today}T00:00:00`);
  from.setDate(from.getDate() - days);
  const seen = new Set<string>();
  const out: MealEntry[] = [];
  for (const m of [...meals].sort((a, b) => b.at.localeCompare(a.at))) {
    if (new Date(m.at) < from || m.title.endsWith("g)")) continue;
    const key = m.recipeId ?? m.title.replace(/ \(leftovers\)$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out.slice(0, 6);
}
