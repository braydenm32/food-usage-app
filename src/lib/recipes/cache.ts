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
    if (raw) return JSON.parse(raw) as Recipe;
  } catch {
    // fall through to the AI ideas cache
  }
  return readAiIdeasCache()?.recipes.find((r) => r.id === id) ?? null;
}

// --- AI ideas: kept for a day so reopening Recipes doesn't pay for the same ideas again.
const AI_KEY = "larder-ai-ideas";
const AI_TTL_MS = 24 * 60 * 60 * 1000;

interface AiIdeasCache {
  key: string;
  at: number;
  recipes: Recipe[];
}

function readAiIdeasCache(): AiIdeasCache | null {
  try {
    const raw = localStorage.getItem(AI_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as AiIdeasCache;
    if (!c || !Array.isArray(c.recipes) || typeof c.at !== "number" || Date.now() - c.at > AI_TTL_MS) return null;
    return c;
  } catch {
    return null;
  }
}

/** The last AI ideas, if they were asked for with exactly this request in the last day. */
export function readAiIdeas(requestKey: string): Recipe[] | null {
  const c = readAiIdeasCache();
  return c && c.key === requestKey ? c.recipes : null;
}

export function saveAiIdeas(requestKey: string, recipes: Recipe[]) {
  try {
    localStorage.setItem(AI_KEY, JSON.stringify({ key: requestKey, at: Date.now(), recipes } satisfies AiIdeasCache));
  } catch {
    // storage full or blocked: ideas still show for this visit
  }
}

/** Library recipes can be re-fetched by id when opened from a bookmark or a fresh tab. */
export function refetchUrl(id: string): string | null {
  if (id.startsWith("db-")) return `/api/recipes/search?id=${encodeURIComponent(id.slice(3))}`;
  if (id.startsWith("wb-")) return `/api/recipes/wikibooks?id=${encodeURIComponent(id.slice(3))}`;
  return null;
}
