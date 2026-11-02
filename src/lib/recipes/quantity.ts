import type { PantryItem, Recipe, RecipeIngredient, Unit } from "@/lib/types";
import { ITEM_GRAMS, UNIT_CONTENTS } from "./families";

/** Australian measures: 20 ml tablespoon, 250 ml cup. Recipes can say they use 15 ml tablespoons. */
const TO_ML: Record<string, number> = { ml: 1, l: 1000, tsp: 5, tbsp: 20, cup: 250 };
const TO_G: Record<string, number> = { g: 1, kg: 1000 };

/** Recipe units that count pieces of something rather than measure it. */
const PIECE_UNITS = new Set(["item", "slice", "clove", "stalk", "piece", "rasher", "fillet", "sheet", "leaf", "head", "stick", "sprig", "handful"]);

const round = (n: number) => Math.round(n * 100) / 100;

/** Nice display for a quantity: "1½", "250", "0.4". */
export function formatQty(n: number): string {
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  const glyph = [
    [0.25, "¼"],
    [0.33, "⅓"],
    [0.5, "½"],
    [0.67, "⅔"],
    [0.75, "¾"],
  ].find(([v]) => Math.abs(frac - (v as number)) < 0.04);
  if (frac < 0.02 || frac > 0.98) return String(Math.round(n));
  if (glyph) return `${whole || ""}${glyph[1]}`;
  return n >= 10 ? String(Math.round(n)) : String(round(n));
}

/** Grams and millilitres read as whole numbers: "13 g", never "13⅓g". */
function metricQty(n: number): string {
  if (n >= 10) return String(Math.round(n));
  return String(Math.round(n * 10) / 10);
}

export function formatAmount(quantity: number | undefined, unit?: string, quantityMax?: number): string {
  if (quantity === undefined) return "";
  const metric = !!unit && /^(g|ml)$/.test(unit);
  const f = metric ? metricQty : formatQty;
  const q = quantityMax !== undefined && quantityMax > quantity ? `${f(quantity)}–${f(quantityMax)}` : f(quantity);
  if (!unit || unit === "item") return q;
  if (/^(g|kg|ml|L)$/.test(unit)) return `${q}${unit}`;
  return `${q} ${Math.max(quantity, quantityMax ?? 0) > 1 ? pluralUnit(unit) : unit}`;
}

/** "2 tins", "3 cloves", "2 bunches"; spoons and metric units stay as they are. */
function pluralUnit(unit: string): string {
  if (!/^(tin|can|jar|pack|packet|bunch|clove|slice|cup|sprig|handful|stick|pinch|punnet|bottle|head|fillet|sheet|piece|rasher|stalk|leaf)$/.test(unit)) return unit;
  if (/(ch|sh)$/.test(unit)) return `${unit}es`;
  if (unit === "leaf") return "leaves";
  return `${unit}s`;
}

/* ---------- ingredient names ---------- */

const UNCOUNTABLE = /\b(?:broccoli|celery|cabbage|lettuce|rice|garlic|ginger|spinach|cauliflower|pumpkin|fish|bread|basil|coriander|parsley|mint|feta|cheese|butter|milk|cream|yoghurt|mince|pasta|spaghetti|penne|flour|sugar|salt|pepper|oil|sauce|stock|honey|water|beef|pork|chicken|lamb|tuna|bacon|zucchini|kale|rocket|corn|dahl|chilli)$/;

function pluralWord(w: string): string {
  if (/s$/.test(w)) return w;
  if (/(?:ch|sh|x)$/.test(w)) return `${w}es`;
  if (/[^aeiou]y$/.test(w)) return `${w.slice(0, -1)}ies`;
  if (/(?:tomato|potato|mango)$/.test(w)) return `${w}es`;
  if (/leaf$/.test(w)) return `${w.slice(0, -1)}ves`;
  return `${w}s`;
}

function singularWord(w: string): string {
  if (/(?:tomato|potato|mango)es$/.test(w)) return w.slice(0, -2);
  if (/[^aeiou]ies$/.test(w)) return `${w.slice(0, -3)}y`;
  if (/(?:ch|sh|x)es$/.test(w)) return w.slice(0, -2);
  if (/[^s]s$/.test(w) && !/(?:us|ss|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

/** "2 brown onion" reads "2 brown onions" and "1 bananas" reads "1 banana". Only for counted items. */
export function ingredientName(name: string, quantity: number | undefined, unit?: string): string {
  if (quantity === undefined || (unit && unit !== "item")) return name;
  if (/[,(]/.test(name) || /\bor\b/.test(name)) return name;
  const m = name.match(/^(.*?)([A-Za-z]+)$/);
  if (!m) return name;
  const [, head, last] = m;
  if (UNCOUNTABLE.test(last.toLowerCase()) || UNCOUNTABLE.test(singularWord(last.toLowerCase()))) return name;
  const next = quantity > 1 ? pluralWord(last) : singularWord(last);
  return head + next;
}

/* ---------- scaling ---------- */

export function scaleIngredient(ing: RecipeIngredient, factor: number): RecipeIngredient {
  if (ing.quantity === undefined) return ing;
  const scaled: RecipeIngredient = { ...ing, quantity: round(ing.quantity * factor) };
  if (ing.quantityMax !== undefined) scaled.quantityMax = round(ing.quantityMax * factor);
  return scaled;
}

const toStep = (n: number, step: number) => Math.max(step, Math.round(n / step) * step);

function niceMetricAmount(n: number): number {
  if (n < 20) return Math.round(n * 10) / 10 >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  if (n < 250) return Math.round(n / 5) * 5;
  if (n < 1000) return Math.round(n / 10) * 10;
  return Math.round(n / 50) * 50;
}

/**
 * Scale an ingredient for reading and shopping: countable things round to the nearest half
 * (no "⅓ onion"), small cups become spoons, and grams are whole numbers.
 */
export function displayIngredient(ing: RecipeIngredient, factor: number, tbspMl: 15 | 20 = 20): RecipeIngredient {
  const s = scaleIngredient(ing, factor);
  if (s.quantity === undefined || s.quantity <= 0) return s;
  const unit = (s.unit ?? "item").toLowerCase();
  const fix = (n: number | undefined, f: (x: number) => number) => (n === undefined ? undefined : f(n));
  const out: RecipeIngredient = { ...s };
  const scaled = Math.abs(factor - 1) > 1e-6;
  if (unit === "g" || unit === "ml") {
    // As written, amounts stay exactly as the recipe says (225 g is 225 g).
    if (!scaled) return out;
    out.quantity = fix(s.quantity, niceMetricAmount);
    out.quantityMax = fix(s.quantityMax, niceMetricAmount);
  } else if (!scaled) {
    return out;
  } else if (unit === "cup" && s.quantity < 0.25) {
    const toSpoon = (cups: number) => (cups * 250) / tbspMl;
    const tbsp = toSpoon(s.quantity);
    if (tbsp >= 1) {
      out.unit = "tbsp";
      out.quantity = toStep(tbsp, 0.5);
      out.quantityMax = fix(s.quantityMax, (x) => toStep(toSpoon(x), 0.5));
    } else {
      out.unit = "tsp";
      out.quantity = toStep((s.quantity * 250) / 5, 0.25);
      out.quantityMax = fix(s.quantityMax, (x) => toStep((x * 250) / 5, 0.25));
    }
  } else if (unit === "cup") {
    out.quantity = toStep(s.quantity, 0.25);
    out.quantityMax = fix(s.quantityMax, (x) => toStep(x, 0.25));
  } else if (unit === "tbsp" && s.quantity < 1) {
    out.unit = "tsp";
    out.quantity = toStep((s.quantity * tbspMl) / 5, 0.25);
    out.quantityMax = fix(s.quantityMax, (x) => toStep((x * tbspMl) / 5, 0.25));
  } else if (unit === "tbsp") {
    out.quantity = toStep(s.quantity, 0.5);
    out.quantityMax = fix(s.quantityMax, (x) => toStep(x, 0.5));
  } else if (unit === "tsp") {
    out.quantity = toStep(s.quantity, 0.25);
    out.quantityMax = fix(s.quantityMax, (x) => toStep(x, 0.25));
  } else if (PIECE_UNITS.has(unit) || unit === "tin" || unit === "bunch") {
    out.quantity = toStep(s.quantity, 0.5);
    out.quantityMax = fix(s.quantityMax, (x) => toStep(x, 0.5));
  }
  return out;
}

/**
 * Baking and big-batch recipes don't scale well (a third of a banana bread is not a thing), so
 * they open at the recipe's own size.
 */
export function isBatchRecipe(recipe: Pick<Recipe, "tags" | "servings" | "title">): boolean {
  if (recipe.tags.some((t) => /^(baking|cake|cakes|dessert|desserts|bread|biscuits|cookies)$/i.test(t))) return true;
  if (/\b(bread|cake|loaf|muffins?|slice|cookies|biscuits|brownies?)\b/i.test(recipe.title) && !/\bpasta\b/i.test(recipe.title)) return true;
  return recipe.servings >= 8;
}

/* ---------- larder deductions ---------- */

/** Oils, sauces, spices and the like: a spoonful from a bottle can't be measured, so we leave them be. */
const CONDIMENT_RE =
  /\b(?:oil|oils|sauce|sauces|spice|spices|salt|pepper|vinegar|seasoning|paste|honey|syrup|mayonnaise|mayo|mustard|powder|extract|essence|stock cubes?|cumin|paprika|cinnamon|nutmeg|oregano|turmeric|chilli flakes|ketchup|relish|chutney|jam)\b/i;

export function isCondiment(ing: RecipeIngredient): boolean {
  return CONDIMENT_RE.test(ing.name) && !/\bpasta sauce\b/i.test(ing.name);
}

/** The recipe amount in grams (or ml, treated alike), using typical sizes for counted things. */
function recipeGrams(q: number, unit: string, foodId: string | null | undefined, tbspMl: 15 | 20): number | null {
  if (unit in TO_G) return q * TO_G[unit];
  if (unit in TO_ML) return q * (unit === "tbsp" ? tbspMl : TO_ML[unit]);
  if (!foodId) return null;
  if (unit === "item" && ITEM_GRAMS[foodId]) return q * ITEM_GRAMS[foodId];
  const c = UNIT_CONTENTS[foodId];
  if (PIECE_UNITS.has(unit) && c?.count && c.grams) return (q * c.grams) / c.count;
  return null;
}

/** Convert the recipe amount into the pantry item's own unit, or null when we can't tell. */
export function convertToItemUnit(ing: RecipeIngredient, item: PantryItem, tbspMl: 15 | 20 = 20): number | null {
  const q = ing.quantity;
  if (q === undefined) return null;
  const u = (ing.unit ?? "item").toLowerCase();
  const iu = item.unit;
  const foodId = item.foodTypeId ?? ing.foodTypeId ?? null;
  const contents = foodId ? UNIT_CONTENTS[foodId] : undefined;
  const isVolume = u in TO_ML;

  if (iu === "g" || iu === "kg") {
    // Cups of rice or flour aren't grams; only weights and counted items convert.
    if (isVolume) return null;
    const g = recipeGrams(q, u, foodId, tbspMl);
    if (g === null) return null;
    return iu === "g" ? g : g / 1000;
  }
  if (iu === "ml" || iu === "L") {
    const ml = u in TO_ML ? q * (u === "tbsp" ? tbspMl : TO_ML[u]) : u in TO_G ? q * TO_G[u] : null;
    if (ml === null) return null;
    return iu === "ml" ? ml : ml / 1000;
  }
  if (u === iu.toLowerCase() || (u === "can" && iu === "tin")) return q;
  if (iu === "dozen") return u === "item" ? q / 12 : null;
  if (iu === "item") {
    // A bulb of garlic for cloves, an onion for grams.
    if (contents?.count && PIECE_UNITS.has(u) && u !== "item") return q / contents.count;
    if (u === "item") return q;
    const g = u in TO_G ? q * TO_G[u] : null;
    const each = foodId ? ITEM_GRAMS[foodId] : undefined;
    return g !== null && each ? g / each : null;
  }
  // Tins, jars, bottles, packs, loaves and bunches.
  if (contents?.count && PIECE_UNITS.has(u)) return q / contents.count;
  const g = recipeGrams(q, u, foodId, tbspMl);
  if (g !== null && contents?.grams) return g / contents.grams;
  if (g !== null && (iu === "tin" || iu === "jar") && !isVolume) return g / 400;
  return null;
}

function stepRound(n: number, unit: Unit): number {
  if (unit === "g" || unit === "ml") return Math.round(n / 5) * 5 || Math.round(n);
  if (unit === "kg" || unit === "L") return Math.round(n * 100) / 100;
  // Part of a tin, jar or loaf is fine: quarters are close enough to adjust from.
  return Math.max(0.25, Math.round(n * 4) / 4);
}

/**
 * Sensible starting deduction for an item, never more than what is there. When we can't tell
 * how much of a bag or bottle the recipe used, it starts at none rather than all of it.
 */
export function defaultDeduction(ing: RecipeIngredient, item: PantryItem, factor: number, tbspMl: 15 | 20 = 20): number {
  if (ing.optional || isCondiment(ing)) return 0;
  const converted = convertToItemUnit(scaleIngredient(ing, factor), item, tbspMl);
  if (converted === null || converted <= 0) return 0;
  return Math.min(item.quantity, stepRound(converted, item.unit));
}

export interface DeductionRow {
  itemId: string;
  ingredient: string;
  amount: number;
  /** True for a second item that takes what the first one didn't have. */
  spill?: boolean;
}

/**
 * Starting deductions for "I cooked this": one row per matched item, plus a row for the next
 * matching item when the first doesn't have enough (300 g of mince left, recipe needs 500 g).
 */
export function planDeductions(
  recipe: Recipe,
  uses: Array<{ itemId: string; ingredient: string }>,
  items: PantryItem[],
  factor: number,
  matches: (ing: RecipeIngredient, item: PantryItem) => boolean,
): DeductionRow[] {
  const tbsp = tbspOf(recipe);
  const taken = new Set(uses.map((u) => u.itemId));
  const rows: DeductionRow[] = [];
  for (const u of uses) {
    const item = items.find((i) => i.id === u.itemId);
    const ing = recipe.ingredients.find((i) => i.name === u.ingredient);
    if (!item || !ing) continue;
    const amount = defaultDeduction(ing, item, factor, tbsp);
    rows.push({ itemId: item.id, ingredient: ing.name, amount });
    if (amount <= 0) continue;
    const need = convertToItemUnit(scaleIngredient(ing, factor), item, tbsp);
    if (need === null || need <= item.quantity * 1.02) continue;
    // What fraction of the recipe amount is still to find.
    let left = 1 - item.quantity / need;
    for (const next of items) {
      if (left <= 0.02) break;
      if (taken.has(next.id) || !matches(ing, next)) continue;
      const part = defaultDeduction({ ...ing, quantity: (ing.quantity ?? 0) * left, quantityMax: undefined }, next, factor, tbsp);
      if (part <= 0) continue;
      const nextNeed = convertToItemUnit(scaleIngredient({ ...ing, quantity: (ing.quantity ?? 0) * left }, factor), next, tbsp) ?? part;
      taken.add(next.id);
      rows.push({ itemId: next.id, ingredient: ing.name, amount: part, spill: true });
      left = nextNeed > 0 ? left * Math.max(0, 1 - next.quantity / nextNeed) : 0;
    }
  }
  return rows;
}

export function stepFor(unit: Unit): number {
  if (unit === "g" || unit === "ml") return 50;
  if (unit === "kg" || unit === "L") return 0.1;
  return 0.25;
}

/** Tablespoon size for a recipe. Older saves have none: library (TheMealDB) recipes are UK/US 15 ml; ours are Australian 20 ml. */
export function tbspOf(recipe: { tbspMl?: 15 | 20; source: string }): 15 | 20 {
  return recipe.tbspMl ?? (recipe.source === "database" ? 15 : 20);
}

const BASE: Record<string, [string, number]> = { g: ["g", 1], kg: ["g", 1000], ml: ["ml", 1], L: ["ml", 1000], l: ["ml", 1000] };

/**
 * Add two shopping amounts ("1 egg" + "2 eggs" = 3; "500 g" + "1 kg" = 1.5 kg).
 * Returns null when the units can't be added, so the caller keeps both as they are.
 */
export function addAmounts(
  a: { quantity?: number; unit?: string },
  b: { quantity?: number; unit?: string },
): { quantity?: number; unit?: string } | null {
  if (a.quantity === undefined) return b.quantity === undefined ? a : { quantity: b.quantity, unit: b.unit ?? a.unit };
  if (b.quantity === undefined) return a;
  const ua = a.unit ?? "item";
  const ub = b.unit ?? "item";
  if (ua === ub) return { quantity: round(a.quantity + b.quantity), unit: a.unit ?? b.unit };
  const ba = BASE[ua];
  const bb = BASE[ub];
  if (!ba || !bb || ba[0] !== bb[0]) return null;
  const total = a.quantity * ba[1] + b.quantity * bb[1];
  // Show in the bigger unit once it reaches 1000.
  if (total >= 1000) return { quantity: round(total / 1000), unit: ba[0] === "g" ? "kg" : "L" };
  return { quantity: round(total), unit: ba[0] };
}
