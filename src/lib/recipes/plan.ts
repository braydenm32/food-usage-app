// Shopping for planned meals and recipes: what the week needs, minus what the larder already has.
// Pure functions, so they can be tested without the store.

import type { PantryItem, Recipe, RecipeIngredient, ShoppingListItem } from "@/lib/types";
import { getFoodType } from "@/lib/shelf-life/foods";
import { CATCH_ALL_IDS, familyOf } from "./families";
import { addAmounts, convertToItemUnit, formatAmount, ingredientName, scaleIngredient, tbspOf } from "./quantity";
import { ingredientMatchesItem, isStaple } from "./suggest";

export interface ListEntry {
  name: string;
  foodTypeId: string | null;
  quantity?: number;
  unit?: string;
  note?: string;
}

const capitalise = (t: string) => t.trim().charAt(0).toUpperCase() + t.trim().slice(1);

const SAME_KIND: Record<string, string> = { g: "mass", kg: "mass", ml: "vol", L: "vol", l: "vol", item: "count", dozen: "count" };

/** Can a shop buy this recipe amount as written? "500 g mince" yes; "6 slices bread" no, that's a loaf. */
function buyable(unit: string | undefined, foodUnit: string): boolean {
  const u = unit ?? "item";
  if (u === foodUnit) return true;
  return !!SAME_KIND[u] && SAME_KIND[u] === SAME_KIND[foodUnit];
}

/** Round up to something you can buy: whole or half items, 5 g/ml under 100, 10 above. */
function roundUp(q: number, unit: string | undefined): number {
  const u = unit ?? "item";
  if (u === "g" || u === "ml") return q < 100 ? Math.ceil(q / 5) * 5 : Math.ceil(q / 10) * 10;
  if (u === "kg" || u === "L") return Math.ceil(q * 10) / 10;
  return Math.max(0.5, Math.ceil(q * 2 - 1e-9) / 2);
}

/**
 * One shopping-list line for a recipe ingredient (already scaled). When the recipe's amount
 * isn't how the food is sold (slices of bread, cloves of garlic), it adds one of the food's usual
 * size and keeps the recipe's amount as a note.
 */
export function listEntryFor(ing: RecipeIngredient, forWhat?: string): ListEntry {
  const food = ing.foodTypeId ? getFoodType(ing.foodTypeId) : undefined;
  const name = capitalise(ingredientName(ing.name, ing.quantity, ing.unit));
  if (food && ing.quantity !== undefined && !buyable(ing.unit, food.defaultUnit)) {
    const amount = `${formatAmount(ing.quantity, ing.unit)} ${ingredientName(ing.name, ing.quantity, ing.unit)}`.trim();
    return {
      name,
      foodTypeId: food.id,
      quantity: food.defaultQuantity,
      unit: food.defaultUnit,
      note: forWhat ? `${amount} for ${forWhat}` : amount,
    };
  }
  return {
    name,
    foodTypeId: ing.foodTypeId ?? null,
    quantity: ing.quantity === undefined ? undefined : roundUp(ing.quantity, ing.unit),
    unit: ing.unit,
    ...(forWhat ? { note: `for ${forWhat}` } : {}),
  };
}

export interface PlannedMeal {
  recipe: Recipe;
  /** People it's for; defaults to the recipe's own servings. */
  servings?: number;
}

export interface PlanNeed extends ListEntry {
  recipeIds: string[];
}

function groupKey(ing: RecipeIngredient): string {
  const id = ing.foodTypeId;
  if (id && !CATCH_ALL_IDS.has(id)) return `f:${familyOf(id) ?? id}`;
  return `n:${ing.name.trim().toLowerCase().replace(/s$/, "")}`;
}

/**
 * What the week's planned meals need that the larder doesn't have: each food's total across the
 * meals (scaled to each meal's servings), minus what's on hand, with staples left out.
 */
export function planShoppingNeeds(meals: PlannedMeal[], items: PantryItem[], list: ShoppingListItem[] = []): PlanNeed[] {
  const groups = new Map<
    string,
    { ing: RecipeIngredient; total: { quantity?: number; unit?: string }; tbsp: 15 | 20; recipeIds: string[]; titles: string[] }
  >();
  for (const { recipe, servings } of meals) {
    const factor = (servings ?? recipe.servings) / Math.max(1, recipe.servings);
    for (const raw of recipe.ingredients) {
      if (raw.optional || isStaple(raw)) continue;
      const ing = scaleIngredient(raw, factor);
      const key = groupKey(ing);
      const g = groups.get(key);
      if (!g) {
        groups.set(key, { ing, total: { quantity: ing.quantity, unit: ing.unit }, tbsp: tbspOf(recipe), recipeIds: [recipe.id], titles: [recipe.title] });
        continue;
      }
      const sum = addAmounts(g.total, ing);
      if (sum) g.total = sum;
      if (!g.recipeIds.includes(recipe.id)) {
        g.recipeIds.push(recipe.id);
        g.titles.push(recipe.title);
      }
    }
  }

  const onList = list.filter((l) => !l.checked);
  const out: PlanNeed[] = [];
  for (const g of groups.values()) {
    const need: RecipeIngredient = { ...g.ing, quantity: g.total.quantity, unit: g.total.unit, quantityMax: undefined };
    let remaining = 1;
    for (const item of items) {
      if (remaining <= 0) break;
      if (!ingredientMatchesItem(g.ing, item)) continue;
      const inItemUnits = convertToItemUnit(need, item, g.tbsp);
      // When we can't compare amounts, having some counts as having enough.
      if (inItemUnits === null || inItemUnits <= 0) remaining = 0;
      else remaining -= item.quantity / inItemUnits;
    }
    if (remaining <= 0.05) continue;
    const shortfall: RecipeIngredient = need.quantity === undefined ? need : { ...need, quantity: need.quantity * remaining };
    const forWhat = g.titles.length > 2 ? `${g.titles.length} meals` : g.titles.join(" and ");
    const entry = listEntryFor(shortfall, forWhat);
    const already = onList.some(
      (l) => (entry.foodTypeId && l.foodTypeId === entry.foodTypeId) || l.name.trim().toLowerCase() === entry.name.toLowerCase(),
    );
    if (already) continue;
    out.push({ ...entry, recipeIds: g.recipeIds });
  }
  return out;
}
