import type { Diet, Recipe } from "@/lib/types";
import { getFoodType } from "@/lib/shelf-life/foods";
import { exclusionReason } from "./filter";
import { isStaple } from "./suggest";

const TAG_LABELS: Record<string, string> = {
  "kid-friendly": "Kid friendly",
  "uses-leftovers": "Uses leftovers",
  "quick-prep": "Quick to prep",
  "uses-ripe-fruit": "Uses ripe fruit",
  "freezer-friendly": "Freezes well",
  "pantry-meal": "From the pantry",
  "gluten-free": "Gluten free",
  "dairy-free": "Dairy free",
  "low-carb": "Low carb",
};

/** "kid-friendly" -> "Kid friendly". */
export function tagLabel(tag: string): string {
  const t = tag.trim().toLowerCase();
  if (TAG_LABELS[t]) return TAG_LABELS[t];
  const words = t.replace(/[-_]+/g, " ").replace(/\s+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const DIET_TAGS: Diet[] = ["vegetarian", "vegan", "gluten-free", "dairy-free", "low-carb"];

/** Tags worth showing: diet tags only when the ingredients agree, no duplicates. */
export function visibleTags(recipe: Recipe, max = 5): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of recipe.tags) {
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    if ((DIET_TAGS as string[]).includes(t) && exclusionReason(recipe, { diets: [t as Diet], allergies: [], dislikes: [] })) continue;
    const label = tagLabel(t);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out.slice(0, max);
}

/**
 * The photo to show, if any. Only TheMealDB photos are shown (credited, and they allow it);
 * photos on imported web pages belong to those sites, so we don't hotlink them.
 */
export function recipeImage(recipe: Recipe): string | undefined {
  return recipe.id.startsWith("db-") && recipe.image ? recipe.image : undefined;
}

const titleKey = (t: string) =>
  t
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["the", "a", "an", "and", "with", "recipe", "easy", "best", "classic", "homemade"].includes(w))
    .map((w) => (w.length > 3 ? w.replace(/s$/, "") : w))
    .sort()
    .join(" ");

/** Drop near-identical titles ("Banana split" twice, "Banana Bread" and "Easy banana bread"). */
export function dedupeByTitle<T extends { title: string }>(recipes: T[]): T[] {
  const seen = new Set<string>();
  return recipes.filter((r) => {
    const k = titleKey(r.title);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const TINTS =["bg-primary-soft", "bg-soon-soft", "bg-fresh-soft", "bg-today-soft"] as const;

/** A designed stand-in for a photo: the main ingredient's emoji (or the title's initial) on a soft tint. */
export function recipePlaceholder(recipe: Recipe): { emoji?: string; initial: string; tint: (typeof TINTS)[number] } {
  const main = recipe.ingredients.find((i) => !i.optional && !isStaple(i) && i.foodTypeId && getFoodType(i.foodTypeId));
  const food = main?.foodTypeId ? getFoodType(main.foodTypeId) : undefined;
  let hash = 0;
  for (const ch of recipe.id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return {
    emoji: food?.emoji,
    initial: recipe.title.trim().charAt(0).toUpperCase() || "R",
    tint: TINTS[Math.abs(hash) % TINTS.length],
  };
}
