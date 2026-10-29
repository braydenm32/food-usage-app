"use client";

import type { Recipe } from "@/lib/types";

const KEY = (id: string) => `larder-recipe:${id}`;

/** Remember recipes that are not built in, so the detail page can open them. */
export function cacheRecipes(recipes: Recipe[]) {
  try {
    for (const r of recipes) sessionStorage.setItem(KEY(r.id), JSON.stringify(r));
  } catch {
    // storage unavailable: the detail page falls back to a fetch or a not-found state
  }
}

export function readCachedRecipe(id: string): Recipe | null {
  try {
    const raw = sessionStorage.getItem(KEY(id));
    return raw ? (JSON.parse(raw) as Recipe) : null;
  } catch {
    return null;
  }
}
