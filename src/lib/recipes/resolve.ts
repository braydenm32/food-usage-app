"use client";

import type { MealPlanEntry, Recipe } from "@/lib/types";
import { getBuiltinRecipe } from "./builtin";
import { readCachedRecipe } from "./cache";

/**
 * Find a recipe by id the same way everywhere (detail page, plan): built in, then saved, then a
 * copy kept on a plan entry, then this visit's cache. Library recipes can also be re-fetched
 * (see `refetchUrl`) when none of these has them.
 */
export function resolveRecipe(id: string, saved: Recipe[], planEntries: MealPlanEntry[] = []): Recipe | null {
  return (
    getBuiltinRecipe(id) ??
    saved.find((r) => r.id === id) ??
    planEntries.find((m) => m.recipeId === id && m.recipe)?.recipe ??
    readCachedRecipe(id)
  );
}
