import type { ItemStatus, PantryItem, Recipe, RecipeIngredient } from "@/lib/types";
import { matchFoodType, normalise } from "@/lib/shelf-life/foods";
import { CATCH_ALL_IDS, foodTypeMatch, type MatchQuality } from "./families";
import { isRecipeAllowed, likeCount, type FilterProfile } from "./filter";

/** The slice of an ItemView that ranking needs (keeps this module free of the store). */
export interface RankableItem {
  item: PantryItem;
  expiry: { status: ItemStatus; daysLeft: number };
}

export interface RecipeUse {
  itemId: string;
  itemName: string;
  ingredient: string;
  status: ItemStatus;
  daysLeft: number;
  /** Past a best-before date: still fine to cook with, but worth a look first. */
  pastBestBefore?: boolean;
  /** How the item matched: the same food, a close variety, a swap, or by its name. */
  match?: MatchQuality | "name";
}

export interface RankedRecipe {
  recipe: Recipe;
  /** Pantry items this recipe would use (one per matched ingredient). */
  uses: RecipeUse[];
  itemIds: string[];
  /** Uses that are use-today, use-soon or past their best-before date. */
  atRisk: RecipeUse[];
  /** Non-staple ingredients with nothing in the larder. */
  missing: RecipeIngredient[];
  score: number;
}

export const STATUS_WEIGHT: Record<ItemStatus, number> = {
  "use-today": 3,
  "use-soon": 2,
  fresh: 0.5,
  expired: 0,
};

/** Past best before: quality, not safety. Worth using soon, just check it first. */
const PAST_BEST_BEFORE_WEIGHT = 2;

/* ---------- ingredient helpers ---------- */

const STAPLE_RE =
  /\b(salt|pepper|oil|water|sugar|flour|baking powder|baking soda|soy sauce|oyster sauce|hoisin|taco seasoning|curry powder|curry paste|cumin|paprika|cinnamon|maple syrup|honey|vinegar|mayonnaise|stock|spice|seasoning|butter)\b/i;

/** Things most kitchens already have; never counted as missing. */
export function isStaple(ing: RecipeIngredient): boolean {
  return STAPLE_RE.test(ing.name);
}

function tokens(text: string): string[] {
  return normalise(text)
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.endsWith("oes") ? w.slice(0, -2) : w.endsWith("ies") ? w.slice(0, -3) + "y" : w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

const GENERIC = new Set(["cooked", "tinned", "tin", "frozen", "fresh", "dried", "ground", "plain", "tasty", "brown", "red", "white", "small", "large", "baby"]);

function namesMatch(a0: string, b0: string): boolean {
  const a = tokens(a0).filter((t) => !GENERIC.has(t));
  const b = tokens(b0).filter((t) => !GENERIC.has(t));
  if (a.length === 0 || b.length === 0) return false;
  return a.every((t) => b.includes(t)) || b.every((t) => a.includes(t));
}

const altCache = new Map<string, Array<{ name: string; foodTypeId: string | null }>>();

/** "pork or chicken mince" -> pork mince, chicken mince. Other names stand alone. */
function alternatives(ing: RecipeIngredient): Array<{ name: string; foodTypeId: string | null }> {
  const own = { name: ing.name, foodTypeId: ing.foodTypeId ?? null };
  if (!/\bor\b/i.test(ing.name)) return [own];
  const hit = altCache.get(ing.name);
  if (hit) return [own, ...hit];
  const parts = ing.name.split(/\s+or\s+/i).map((p) => p.trim()).filter(Boolean);
  // "pork or chicken mince": the last word belongs to every option.
  const tail = parts.length > 1 ? parts[parts.length - 1].split(/\s+/).slice(1).join(" ") : "";
  const names = parts.map((p, i) => (i < parts.length - 1 && tail && !p.includes(" ") ? `${p} ${tail}` : p));
  const alts = names.map((name) => {
    const m = matchFoodType(name);
    return { name, foodTypeId: m && m.score >= 45 ? m.food.id : null };
  });
  altCache.set(ing.name, alts);
  return [own, ...alts];
}

const MATCH_RANK: Record<MatchQuality | "name", number> = { exact: 0, family: 1, name: 1, substitute: 2 };

/** How well this pantry item satisfies this recipe ingredient, or null when it doesn't. */
export function matchIngredient(ing: RecipeIngredient, item: PantryItem): MatchQuality | "name" | null {
  let best: MatchQuality | "name" | null = null;
  for (const alt of alternatives(ing)) {
    let q: MatchQuality | "name" | null = null;
    if (alt.foodTypeId && item.foodTypeId) {
      // Catch-all ids (spices, stock, Asian sauces...) group unlike foods, so the names must agree.
      if (CATCH_ALL_IDS.has(alt.foodTypeId) || CATCH_ALL_IDS.has(item.foodTypeId)) {
        q = alt.foodTypeId === item.foodTypeId && namesMatch(alt.name, item.name) ? "name" : null;
      } else {
        q = foodTypeMatch(alt.foodTypeId, item.foodTypeId);
      }
    } else if (namesMatch(alt.name, item.name)) {
      q = "name";
    }
    if (q && (!best || MATCH_RANK[q] < MATCH_RANK[best])) best = q;
  }
  return best;
}

/** Does this pantry item satisfy this recipe ingredient? */
export function ingredientMatchesItem(ing: RecipeIngredient, item: PantryItem): boolean {
  return matchIngredient(ing, item) !== null;
}

/**
 * Can this item go into a recipe? Past a use-by date, no. Past a best-before date it's a
 * quality question, so it still counts (and is flagged "check it").
 */
export function usableForCooking(v: RankableItem): boolean {
  if (v.expiry.status !== "expired") return true;
  return v.item.dateKind === "best-before" && !v.item.expiredWhenFrozen;
}

/* ---------- dietary filtering (see filter.ts) ---------- */

export { allergenHits, dislikeHits, exclusionReason, isRecipeAllowed, labelChecks, termInText, type AllergenHit, type FilterProfile, type LabelCheck } from "./filter";

/* ---------- ranking ---------- */

/** Match a single recipe against the larder. Each pantry item is used at most once. */
export function analyseRecipe(recipe: Recipe, views: RankableItem[]): Omit<RankedRecipe, "score"> {
  const uses: RecipeUse[] = [];
  const missing: RecipeIngredient[] = [];
  const taken = new Set<string>();

  for (const ing of recipe.ingredients) {
    // Prefer the closest match, then the most urgent item.
    const candidates = views
      .filter((v) => usableForCooking(v) && !taken.has(v.item.id))
      .map((v) => ({ v, q: matchIngredient(ing, v.item) }))
      .filter((c): c is { v: RankableItem; q: MatchQuality | "name" } => c.q !== null)
      .sort((a, b) => MATCH_RANK[a.q] - MATCH_RANK[b.q] || a.v.expiry.daysLeft - b.v.expiry.daysLeft);
    const hit = candidates[0];
    if (hit) {
      taken.add(hit.v.item.id);
      uses.push({
        itemId: hit.v.item.id,
        itemName: hit.v.item.name,
        ingredient: ing.name,
        status: hit.v.expiry.status,
        daysLeft: hit.v.expiry.daysLeft,
        pastBestBefore: hit.v.expiry.status === "expired" || undefined,
        match: hit.q,
      });
    } else if (!ing.optional && !isStaple(ing)) {
      missing.push(ing);
    }
  }
  return {
    recipe,
    uses,
    itemIds: uses.map((u) => u.itemId),
    atRisk: uses.filter((u) => u.status === "use-today" || u.status === "use-soon" || u.pastBestBefore),
    missing,
  };
}

/** True when the recipe also leans on pantry staples we can't check (flour, oil, salt). */
export function needsStaples(recipe: Recipe): boolean {
  return recipe.ingredients.some((i) => !i.optional && isStaple(i));
}

const useWeight = (u: RecipeUse) => (u.pastBestBefore ? PAST_BEST_BEFORE_WEIGHT : STATUS_WEIGHT[u.status]);

/** "You have 6 of 9": ingredients that count (not optional, not staples) and how many are in the larder. */
export function stockCount(a: Pick<RankedRecipe, "recipe" | "missing">): { have: number; total: number } {
  const total = a.recipe.ingredients.filter((i) => !i.optional && !isStaple(i)).length;
  return { have: Math.max(0, total - a.missing.length), total };
}

export function scoreOf(a: Omit<RankedRecipe, "score">): number {
  return a.uses.reduce((s, u) => s + useWeight(u), 0) - a.missing.length;
}

/**
 * Rank recipes for this household: weighted at-risk items used, minus missing ingredients.
 * Recipes excluded by diets, allergies or dislikes are dropped. The order is then spread out so
 * each next recipe prefers at-risk items the ones above it don't already use: five banana recipes
 * in a row would hide the avocado.
 */
export function rankRecipes(
  recipes: Recipe[],
  views: RankableItem[],
  profile: FilterProfile,
): RankedRecipe[] {
  const scored = recipes
    .filter((r) => isRecipeAllowed(r, profile))
    .map((r) => {
      const a = analyseRecipe(r, views);
      // Foods the household likes nudge a recipe up, but never past a use-today ingredient.
      return { ...a, score: scoreOf(a) + Math.min(1, likeCount(r, profile.likes) * 0.5) };
    })
    .sort(tieBreak);
  return spreadCoverage(scored);
}

function tieBreak(a: RankedRecipe, b: RankedRecipe): number {
  return (
    b.score - a.score ||
    a.missing.length - b.missing.length ||
    (a.recipe.minutes ?? 99) - (b.recipe.minutes ?? 99) ||
    a.recipe.title.localeCompare(b.recipe.title)
  );
}

/** Greedy re-order: an at-risk item already used by a higher card counts for a lot less. */
export function spreadCoverage(ranked: RankedRecipe[]): RankedRecipe[] {
  const pool = [...ranked];
  const out: RankedRecipe[] = [];
  const covered = new Map<string, number>();
  while (pool.length) {
    let bestI = 0;
    let bestV = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const r = pool[i];
      let v = r.score;
      for (const u of r.atRisk) v -= useWeight(u) * (1 - 0.6 ** (covered.get(u.itemId) ?? 0));
      if (v > bestV + 1e-9 || (Math.abs(v - bestV) < 1e-9 && tieBreak(r, pool[bestI]) < 0)) {
        bestV = v;
        bestI = i;
      }
    }
    const [pick] = pool.splice(bestI, 1);
    for (const u of pick.atRisk) covered.set(u.itemId, (covered.get(u.itemId) ?? 0) + 1);
    out.push(pick);
  }
  return out;
}
