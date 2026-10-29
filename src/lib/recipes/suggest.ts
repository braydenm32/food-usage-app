import type { HouseholdProfile, ItemStatus, PantryItem, Recipe, RecipeIngredient } from "@/lib/types";
import { getFoodType, normalise } from "@/lib/shelf-life/foods";

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

/* ---------- dietary filtering ---------- */

const MEAT = /\b(beef|mince|chicken|pork|bacon|lamb|ham|sausage|salami|steak|turkey|prosciutto|chorizo|veal|duck)\b/i;
const SEAFOOD = /\b(fish|tuna|salmon|prawn|shrimp|barramundi|crab|squid|calamari|mussel|oyster|anchov|sardine|seafood|scallop)\b/i;
const DAIRY = /\b(milk|cheese|cheddar|butter|cream|yoghurt|yogurt|parmesan|feta|mozzarella|ricotta|custard|ghee|halloumi)\b/i;
const EGG = /\b(egg|eggs|mayonnaise)\b/i;
const HONEY = /\b(honey)\b/i;
const GLUTEN = /\b(flour|bread|breadcrumb|pasta|spaghetti|penne|noodle|wrap|couscous|barley|sourdough|toast|soy sauce|hoisin|schnitzel)\b/i;
const NUTS = /\b(nut|nuts|peanut|almond|cashew|walnut|pecan|pistachio|hazelnut|macadamia)\b/i;
const PORK = /\b(pork|bacon|ham|prosciutto|chorizo|salami|lard)\b/i;

function categoryOf(ing: RecipeIngredient) {
  return getFoodType(ing.foodTypeId)?.category;
}

function isMeat(i: RecipeIngredient) {
  const c = categoryOf(i);
  return MEAT.test(i.name) || (c === "meat" && !SEAFOOD.test(i.name));
}
function isSeafood(i: RecipeIngredient) {
  return SEAFOOD.test(i.name) || categoryOf(i) === "seafood";
}
function isDairy(i: RecipeIngredient) {
  return DAIRY.test(i.name) || categoryOf(i) === "dairy";
}
function isEgg(i: RecipeIngredient) {
  return EGG.test(i.name) || categoryOf(i) === "eggs";
}

const ALLERGY_RULES: Array<{ keys: RegExp; test: (r: Recipe) => boolean }> = [
  { keys: /dairy|milk|lactose/, test: (r) => r.ingredients.some(isDairy) },
  { keys: /\begg/, test: (r) => r.ingredients.some(isEgg) },
  { keys: /gluten|wheat|coeliac|celiac/, test: (r) => !r.tags.includes("gluten-free") && r.ingredients.some((i) => GLUTEN.test(i.name)) },
  { keys: /nut|peanut|almond|cashew/, test: (r) => r.ingredients.some((i) => NUTS.test(i.name)) },
  { keys: /shellfish|crustacean|prawn/, test: (r) => r.ingredients.some((i) => /prawn|shrimp|crab|lobster|mussel|oyster|scallop/i.test(i.name)) },
  { keys: /fish|seafood/, test: (r) => r.ingredients.some(isSeafood) },
  { keys: /soy/, test: (r) => r.ingredients.some((i) => /\bsoy\b|tofu|edamame/i.test(i.name)) },
];

function recipeText(r: Recipe): string {
  return `${r.title} ${r.ingredients.map((i) => i.name).join(" ")}`.toLowerCase();
}

function wordIn(text: string, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return false;
  const stem = t.replace(/(es|s)$/, "");
  return new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(text);
}

/** Why a recipe is excluded for this household, or null when it is fine. */
export function exclusionReason(recipe: Recipe, profile: Pick<HouseholdProfile, "diets" | "allergies" | "dislikes">): string | null {
  const ings = recipe.ingredients.filter((i) => !i.optional);
  const all = recipe.ingredients;
  const text = recipeText(recipe);

  for (const a of profile.allergies) {
    const key = a.trim().toLowerCase();
    if (!key) continue;
    const rule = ALLERGY_RULES.find((r) => r.keys.test(key));
    if ((rule && rule.test(recipe)) || wordIn(text, key)) return `Contains ${key}`;
  }
  for (const d of profile.dislikes) {
    if (wordIn(text, d)) return `Has ${d.trim().toLowerCase()}`;
  }
  for (const diet of profile.diets) {
    switch (diet) {
      case "vegan":
        if (all.some((i) => isMeat(i) || isSeafood(i) || isDairy(i) || isEgg(i) || HONEY.test(i.name))) return "Not vegan";
        break;
      case "vegetarian":
        if (all.some((i) => isMeat(i) || isSeafood(i))) return "Not vegetarian";
        break;
      case "pescatarian":
        if (all.some(isMeat)) return "Contains meat";
        break;
      case "gluten-free":
        if (!recipe.tags.includes("gluten-free") && ings.some((i) => GLUTEN.test(i.name))) return "Contains gluten";
        break;
      case "dairy-free":
        if (all.some(isDairy)) return "Contains dairy";
        break;
      case "halal":
      case "kosher":
        if (all.some((i) => PORK.test(i.name))) return "Contains pork";
        break;
      default:
        break;
    }
  }
  return null;
}

export function isRecipeAllowed(recipe: Recipe, profile: Pick<HouseholdProfile, "diets" | "allergies" | "dislikes">): boolean {
  return exclusionReason(recipe, profile) === null;
}

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
  profile: Pick<HouseholdProfile, "diets" | "allergies" | "dislikes">,
): RankedRecipe[] {
  return recipes
    .filter((r) => isRecipeAllowed(r, profile))
    .map((r) => {
      const a = analyseRecipe(r, views);
      return { ...a, score: scoreOf(a) };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.missing.length - b.missing.length ||
        (a.recipe.minutes ?? 99) - (b.recipe.minutes ?? 99) ||
        a.recipe.title.localeCompare(b.recipe.title),
    );
}
