import type { PantryItem, RecipeIngredient, Unit } from "@/lib/types";

/** Australian measures: 20 ml tablespoon, 250 ml cup. Recipes can say they use 15 ml tablespoons. */
const TO_ML: Record<string, number> = { ml: 1, l: 1000, tsp: 5, tbsp: 20, cup: 250 };
const TO_G: Record<string, number> = { g: 1, kg: 1000 };

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

export function formatAmount(quantity: number | undefined, unit?: string, quantityMax?: number): string {
  if (quantity === undefined) return "";
  const q = quantityMax !== undefined && quantityMax > quantity ? `${formatQty(quantity)}–${formatQty(quantityMax)}` : formatQty(quantity);
  if (!unit || unit === "item") return q;
  if (/^(g|kg|ml|L)$/.test(unit)) return `${q}${unit}`;
  return `${q} ${unit}`;
}

export function scaleIngredient(ing: RecipeIngredient, factor: number): RecipeIngredient {
  if (ing.quantity === undefined) return ing;
  const scaled: RecipeIngredient = { ...ing, quantity: round(ing.quantity * factor) };
  if (ing.quantityMax !== undefined) scaled.quantityMax = round(ing.quantityMax * factor);
  return scaled;
}

/** Convert the recipe amount into the pantry item's own unit, or null when we can't tell. */
export function convertToItemUnit(ing: RecipeIngredient, item: PantryItem, tbspMl: 15 | 20 = 20): number | null {
  const q = ing.quantity;
  if (q === undefined) return null;
  const u = (ing.unit ?? "item").toLowerCase();
  const iu = item.unit;
  if (iu === "g" || iu === "kg") {
    if (!(u in TO_G)) return null;
    const grams = q * TO_G[u];
    return iu === "g" ? grams : grams / 1000;
  }
  if (iu === "ml" || iu === "L") {
    if (!(u in TO_ML)) return null;
    const ml = q * (u === "tbsp" ? tbspMl : TO_ML[u]);
    return iu === "ml" ? ml : ml / 1000;
  }
  if (iu === "tin" || iu === "jar" || iu === "bottle") {
    if (u === "tin" || u === "jar" || u === "bottle") return q;
    if (u === "g" || u === "ml") return Math.max(0.5, Math.round(q / 400) || 1);
    return null;
  }
  if (iu === "item" || iu === "dozen" || iu === "bunch" || iu === "loaf") {
    if (u === "item" || u === iu) return iu === "dozen" ? q / 12 : q;
    if (u === "clove" || u === "slice") return null;
    return null;
  }
  return null;
}

/** Sensible starting deduction for an item, never more than what is there. */
export function defaultDeduction(ing: RecipeIngredient, item: PantryItem, factor: number, tbspMl: 15 | 20 = 20): number {
  const scaled = scaleIngredient(ing, factor);
  const converted = convertToItemUnit(scaled, item, tbspMl);
  let amount: number;
  if (converted !== null && converted > 0) amount = converted;
  else if (item.quantity <= 1 || (item.unit === "item" && item.quantity <= 2)) amount = item.quantity;
  else amount = item.quantity / 2; // packs: about half
  return Math.min(item.quantity, stepRound(amount, item.unit));
}

export function stepFor(unit: Unit): number {
  if (unit === "g" || unit === "ml") return 50;
  if (unit === "kg" || unit === "L") return 0.1;
  return 0.5;
}

function stepRound(n: number, unit: Unit): number {
  if (unit === "g" || unit === "ml") return Math.round(n / 5) * 5 || n;
  return Math.round(n * 100) / 100;
}

/** Tablespoon size for a recipe. Older saves have none: library (TheMealDB) recipes are UK/US 15 ml; ours are Australian 20 ml. */
export function tbspOf(recipe: { tbspMl?: 15 | 20; source: string }): 15 | 20 {
  return recipe.tbspMl ?? (recipe.source === "database" ? 15 : 20);
}
