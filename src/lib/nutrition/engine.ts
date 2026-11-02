// Nutrition for a recipe: match each ingredient to a food, estimate grams, add it up.

import type { Recipe, RecipeIngredient } from "@/lib/types";
import { scaleIngredient, tbspOf } from "@/lib/recipes/quantity";
import { addNutrients, scaleNutrients, type Nutrients } from "./nutrients";
import afcd from "./data/afcd.json";

/** One food from the Australian Food Composition Database, nutrients per 100 g. */
export interface FoodComposition {
  key: string;
  name: string;
  n: Nutrients;
}

const FOODS = afcd as FoodComposition[];

/** Whether the food database is bundled in this build. */
export const hasFoodData = () => FOODS.length > 0;

/* ---------- grams ---------- */

/** Grams per ml for things often measured in cups or spoons. Approximate, from common kitchen conversions. */
const DENSITY: [RegExp, number][] = [
  [/\bflour\b/, 0.53],
  [/\bicing sugar\b/, 0.5],
  [/\bbrown sugar\b/, 0.9],
  [/\bsugar\b/, 0.85],
  [/\b(rolled )?oats\b/, 0.4],
  [/\brice\b/, 0.8],
  [/\b(grated|shredded) .*cheese|\bparmesan\b/, 0.4],
  [/\bbutter\b/, 0.96],
  [/\boil\b/, 0.92],
  [/\bhoney\b|\bmaple syrup\b|\bgolden syrup\b/, 1.4],
  [/\bcocoa\b/, 0.45],
  [/\bbreadcrumbs?\b/, 0.45],
  [/\b(nuts|almonds|walnuts|cashews|peanuts)\b/, 0.6],
  [/\b(spinach|rocket|lettuce|kale|herbs|parsley|coriander|basil)\b/, 0.15],
  [/\bpeas\b|\bcorn\b/, 0.65],
];

/** Typical weight of one whole item, in grams. Approximate edible weights. */
const EACH: [RegExp, number][] = [
  [/\beggplant/, 400],
  [/\beggs?\b/, 50],
  [/\bgarlic (bulb|head)|\bbulbs? of garlic|\bheads? of garlic/, 45],
  [/\bgarlic\b|^clove$/, 5],
  [/\bspring onion|\bshallot/, 15],
  [/\bonion/, 150],
  [/\bcarrot/, 120],
  [/\bsweet potato/, 300],
  [/\bpotato/, 170],
  [/\btomato/, 120],
  [/\bbanana/, 120],
  [/\bapple|\bpear/, 150],
  [/\blemon|\blime/, 100],
  [/\bcapsicum/, 160],
  [/\bzucchini/, 200],
  [/\bcucumber/, 300],
  [/\bavocado/, 150],
  [/\bbroccoli/, 350],
  [/\bcauliflower/, 800],
  [/\bchicken breast/, 220],
  [/\bchicken thigh/, 120],
  [/\bsausage/, 70],
  [/\btortilla|\bwrap/, 60],
  [/\bslice|\bbread/, 35],
  [/\bchilli/, 10],
  [/\bcelery/, 40],
  [/\bmushroom/, 20],
];

const UNIT_ML: Record<string, number> = { ml: 1, L: 1000, l: 1000, tsp: 5, cup: 250 };
const UNIT_G: Record<string, number> = { g: 1, kg: 1000 };
const PACK_G: Record<string, number> = { tin: 400, jar: 300, pack: 250, bunch: 150, pinch: 0.5, sprig: 1, handful: 30, stick: 115 };

const find = (table: [RegExp, number][], name: string) => table.find(([re]) => re.test(name))?.[1];

/**
 * Best estimate of an ingredient's weight in grams, or null when we can't tell ("salt, to taste").
 * `basis` says how it was worked out, for the "how we worked this out" list.
 */
export function ingredientGrams(ing: RecipeIngredient, tbspMl: 15 | 20 = 20): { grams: number; basis: string } | null {
  const q = ing.quantityMax !== undefined && ing.quantity !== undefined ? (ing.quantity + ing.quantityMax) / 2 : ing.quantity;
  if (q === undefined || q <= 0) return null;
  const name = ing.name.toLowerCase();
  const unit = ing.unit ?? "item";
  if (UNIT_G[unit]) return { grams: q * UNIT_G[unit], basis: "as written" };
  const ml = unit === "tbsp" ? tbspMl : UNIT_ML[unit];
  if (ml) {
    const d = find(DENSITY, name) ?? 1;
    return { grams: q * ml * d, basis: d === 1 ? "1 ml ≈ 1 g" : `about ${Math.round(ml * d)} g per ${unit}` };
  }
  // "1 (400g) tin": use the size in the note when there is one.
  const size = ing.note?.match(/(\d+(?:\.\d+)?)\s*(g|kg|ml|l)\b/i);
  if (size && (unit === "tin" || unit === "jar" || unit === "pack" || unit === "item")) {
    const amount = Number(size[1]) * (/^(kg|l)$/i.test(size[2]) ? 1000 : 1);
    // "1 (400g) tin" or "200g each" is per pack; "4 chicken thighs (about 600g)" is the total.
    const perPack = unit !== "item" || /\beach\b/i.test(ing.note ?? "") || q === 1;
    return perPack ? { grams: q * amount, basis: `${size[1]}${size[2]} each` } : { grams: amount, basis: `${size[1]}${size[2]} in total` };
  }
  if (PACK_G[unit]) return { grams: q * PACK_G[unit], basis: `about ${PACK_G[unit]} g per ${unit}` };
  if (unit === "item" || unit === "clove" || unit === "slice") {
    const each = find(EACH, unit === "clove" ? (/garlic/.test(name) || !/\bcloves?\b/.test(name) ? "garlic" : name) : unit === "slice" ? "slice" : name);
    if (each) return { grams: q * each, basis: `about ${each} g each` };
  }
  return null;
}

/* ---------- matching ---------- */

const STOP = new Set([
  ...["fresh", "chopped", "diced", "sliced", "large", "small", "medium", "finely", "roughly", "thinly", "of", "and", "or", "the", "a", "to", "for", "whole", "lean"],
  ...["boneless", "skinless", "peeled", "minced", "crushed", "grated", "beaten", "softened", "melted", "cold", "warm", "extra", "virgin", "ripe", "clove", "tin", "can", "packet"],
]);
/** Words recipes use that the database spells differently. */
const SYNONYM: Record<string, string> = { tinned: "canned", courgette: "zucchini", courgettes: "zucchini", aubergine: "eggplant", aubergines: "eggplant", cilantro: "coriander", shrimp: "prawn", shrimps: "prawn" };
const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .map((t) => SYNONYM[t] ?? t)
    .map((t) => (t.length > 3 ? t.replace(/ies$/, "y").replace(/oes$/, "o").replace(/(?<!s)s$/, "") : t))
    .filter((t) => t.length > 1 && !STOP.has(t));

/**
 * The everyday version of a plain ingredient, when the database has several ("milk" is cow's milk,
 * regular fat, not goat). Matched against the food name; the first food that fits wins a bonus.
 */
const DEFAULTS: [RegExp, RegExp][] = [
  [/^(whole |full cream |full fat )?milk$/, /^milk, cow, fluid, (regular|whole)/i],
  [/^(white |caster |granulated )?sugar$/, /^sugar, white/i],
  [/^(brown )?onion$/, /^onion, brown/i],
  [/^butter$/, /^butter, (plain, )?salted/i],
  [/^(plain )?flour$/, /^flour, wheat, white, plain/i],
  [/^rice$/, /^rice, white/i],
  [/^(olive )?oil$/, /^oil, olive/i],
  [/^salt$/, /^salt, table/i],
];

/** Find the closest database food for an ingredient name. Prefers raw, plain versions. */
export function matchFood(name: string, foods: FoodComposition[] = FOODS): FoodComposition | null {
  // "chicken thighs, skin on" → match on "chicken thighs"; what comes after the comma is prep.
  const want = tokens(name.split(/,|\(/)[0]);
  if (want.length === 0 || foods.length === 0) return null;
  // The ingredient's main word ("beans" in "butter beans", "cheese" in "cream cheese") must be in the food's name.
  const head = want[want.length - 1];
  const plain = want.join(" ");
  const preferred = DEFAULTS.find(([re]) => re.test(plain))?.[1];
  let best: { f: FoodComposition; score: number } | null = null;
  for (const f of foods) {
    const have = tokens(f.name);
    if (!have.includes(head)) continue;
    const first = have[0];
    let hit = 0;
    for (const w of want) if (have.includes(w)) hit++;
    if (hit / want.length < 0.66) continue;
    // All the ingredient's words, the food's main word, few extra words, and raw/plain forms score higher.
    let score = (hit / want.length) * 10 - (have.length - hit) * 0.3;
    if (want.includes(first)) score += 2;
    if (/\braw\b|\bfresh\b|\bunprepared\b/i.test(f.name)) score += 0.8;
    if (/\b(fried|battered|canned in syrup|takeaway|commercial)\b/i.test(f.name)) score -= 0.8;
    if (preferred?.test(f.name)) score += 3;
    if (!best || score > best.score) best = { f, score };
  }
  return best && best.score >= 5 ? best.f : null;
}

/* ---------- recipes ---------- */

export interface IngredientNutrition {
  ingredient: RecipeIngredient;
  food: FoodComposition | null;
  grams: number | null;
  basis?: string;
  nutrients: Nutrients;
}

export interface RecipeNutrition {
  /** Whole recipe at the chosen servings. */
  total: Nutrients;
  perServing: Nutrients;
  rows: IngredientNutrition[];
  /** Ingredients left out of the totals (no match or no amount), not counting "to taste" extras. */
  missing: IngredientNutrition[];
  /** Share of the recipe's weight we could account for (0–1). */
  coverage: number;
}

/**
 * Nutrition for `servings` servings of a recipe. Totals are scaled; perServing is per one serving.
 * `overrides` maps an ingredient name to a database food key the user picked.
 */
export function recipeNutrition(recipe: Recipe, servings = recipe.servings, foods: FoodComposition[] = FOODS, overrides: Record<string, string> = {}): RecipeNutrition {
  const factor = servings / recipe.servings;
  const tbsp = tbspOf(recipe);
  const byKey = new Map(foods.map((f) => [f.key, f]));
  let total: Nutrients = {};
  const rows: IngredientNutrition[] = [];
  let counted = 0;
  let weighed = 0;
  for (const raw of recipe.ingredients) {
    const ing = scaleIngredient(raw, factor);
    const g = ingredientGrams(ing, tbsp);
    const food = (overrides[raw.name] && byKey.get(overrides[raw.name])) || matchFood(raw.name, foods);
    const nutrients = food && g ? scaleNutrients(food.n, g.grams / 100) : {};
    if (g) weighed += g.grams;
    if (food && g) {
      counted += g.grams;
      total = addNutrients(total, nutrients);
    }
    rows.push({ ingredient: raw, food, grams: g?.grams ?? null, basis: g?.basis, nutrients });
  }
  const missing = rows.filter((r) => (!r.food || r.grams === null) && !(r.ingredient.quantity === undefined && /to taste/i.test(r.ingredient.note ?? "")));
  return {
    total,
    perServing: scaleNutrients(total, 1 / (servings > 0 ? servings : 1)),
    rows,
    missing,
    coverage: weighed > 0 ? counted / weighed : 0,
  };
}

/** Which ingredients supply the most of a nutrient, largest first. */
export function topContributors(rows: IngredientNutrition[], key: keyof Nutrients, limit = 3): { name: string; amount: number; share: number }[] {
  const sum = rows.reduce((s, r) => s + (r.nutrients[key] ?? 0), 0);
  if (sum <= 0) return [];
  return rows
    .map((r) => ({ name: r.ingredient.name, amount: r.nutrients[key] ?? 0, share: (r.nutrients[key] ?? 0) / sum }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}
