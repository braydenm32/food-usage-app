"use client";

/**
 * TEMPORARY SHIM, to be replaced at merge by the real `useHouseholdStaples` from
 * `@/lib/selectors` (the household's own "always keep in stock" foods). It has the same
 * names and shape so the List compiles on its own; it returns no staples, so the List
 * falls back to history-based suggestions and the generic "Common staples".
 */
import type { PantryItem } from "@/lib/types";

export interface Staple {
  id: string;
  name: string;
  foodTypeId: string | null;
  emoji?: string;
  addedAt: string;
}

export interface StapleView {
  staple: Staple;
  items: PantryItem[];
  inStock: boolean;
  low: boolean;
  onList: boolean;
}

export function useHouseholdStaples(): StapleView[] {
  return [];
}

