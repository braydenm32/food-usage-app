import type { ItemStatus, PantryItem, Recipe, RecipeIngredient } from "@/lib/types";
import { normalise } from "@/lib/shelf-life/foods";
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
}

export interface RankedRecipe {
  recipe: Recipe;
  /** Pantry items this recipe would use (one per matched ingredient). */
  uses: RecipeUse[];
  itemIds: string[];
  /** Subset of uses that are use-today or use-soon (or expired-but-flagged is excluded). */
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

const GENERIC = new Set(["cooked", "tinned", "tin", "frozen", "fresh", "dried", "ground", "plain", "tasty", "brown", "red", "white"]);

/** Does this pantry item satisfy this recipe ingredient? */
export function ingredientMatchesItem(ing: RecipeIngredient, item: PantryItem): boolean {
  if (ing.foodTypeId && item.foodTypeId) return ing.foodTypeId === item.foodTypeId;
  const a = tokens(ing.name).filter((t) => !GENERIC.has(t));
  const b = tokens(item.name).filter((t) => !GENERIC.has(t));
  if (a.length === 0 || b.length === 0) return false;
  return a.every((t) => b.includes(t)) || b.every((t) => a.includes(t));
}

/* ---------- dietary filtering (see filter.ts) ---------- */

export { allergenHits, dislikeHits, exclusionReason, isRecipeAllowed, termInText, type AllergenHit, type FilterProfile } from "./filter";

/* ---------- ranking ---------- */

/** Match a single recipe against the larder. Each pantry item is used at most once. */
export function analyseRecipe(recipe: Recipe, views: RankableItem[]): Omit<RankedRecipe, "score"> {
  const uses: RecipeUse[] = [];
  const missing: RecipeIngredient[] = [];
  const taken = new Set<string>();

  for (const ing of recipe.ingredients) {
    // Prefer the most urgent usable item; views arrive most-urgent-first but sort defensively.
    const candidates = views
      .filter((v) => v.expiry.status !== "expired" && !taken.has(v.item.id) && ingredientMatchesItem(ing, v.item))
      .sort((a, b) => a.expiry.daysLeft - b.expiry.daysLeft);
    const hit = candidates[0];
    if (hit) {
      taken.add(hit.item.id);
      uses.push({
        itemId: hit.item.id,
        itemName: hit.item.name,
        ingredient: ing.name,
        status: hit.expiry.status,
        daysLeft: hit.expiry.daysLeft,
      });
    } else if (!ing.optional && !isStaple(ing)) {
      missing.push(ing);
    }
  }
  return {
    recipe,
    uses,
    itemIds: uses.map((u) => u.itemId),
    atRisk: uses.filter((u) => u.status === "use-today" || u.status === "use-soon"),
    missing,
  };
}

export function scoreOf(a: Omit<RankedRecipe, "score">): number {
  return a.uses.reduce((s, u) => s + STATUS_WEIGHT[u.status], 0) - a.missing.length;
}

/**
 * Rank recipes for this household: weighted at-risk items used, minus missing ingredients.
 * Recipes excluded by diets, allergies or dislikes are dropped.
 */
export function rankRecipes(
  recipes: Recipe[],
  views: RankableItem[],
  profile: FilterProfile,
): RankedRecipe[] {
  return recipes
    .filter((r) => isRecipeAllowed(r, profile))
    .map((r) => {
      const a = analyseRecipe(r, views);
      // Foods the household likes nudge a recipe up, but never past a use-today ingredient.
      return { ...a, score: scoreOf(a) + Math.min(1, likeCount(r, profile.likes) * 0.5) };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.missing.length - b.missing.length ||
        (a.recipe.minutes ?? 99) - (b.recipe.minutes ?? 99) ||
        a.recipe.title.localeCompare(b.recipe.title),
    );
}
