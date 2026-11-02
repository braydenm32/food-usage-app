"use client";

import { useMemo } from "react";
import { sameStapleFood, useLarder } from "@/lib/store";
import { useNow } from "@/lib/use-now";
import { computeExpiry, parseLocalDate, soonDaysFor, STATUS_ORDER, toLocalISODate, type ExpiryInfo } from "@/lib/shelf-life/engine";
import { getFoodType } from "@/lib/shelf-life/foods";
import type { FoodType, PantryItem, Staple, StorageLocation } from "@/lib/types";

export interface ItemView {
  item: PantryItem;
  food?: FoodType;
  location?: StorageLocation;
  expiry: ExpiryInfo;
}

// Re-exported: the rule lives with the engine so the push sender (server) shares it.
export { HIGH_RISK_EXTRA_DAYS, isHighRiskFood } from "@/lib/shelf-life/engine";

export function viewItem(
  item: PantryItem,
  state: Pick<ReturnType<typeof useLarder.getState>, "locations" | "overrides" | "settings">,
  now?: Date,
): ItemView {
  const food = getFoodType(item.foodTypeId);
  const location = state.locations.find((l) => l.id === item.locationId);
  const override = item.foodTypeId ? state.overrides[item.foodTypeId] : undefined;
  const expiry = computeExpiry(item, {
    food,
    override,
    location,
    useSoonDays: soonDaysFor(item, { food, override, location, useSoonDays: state.settings.useSoonDays }),
    now,
  });
  return { item, food, location, expiry };
}

/** All pantry items with computed dates, most urgent first. */
export function useItemViews(): ItemView[] {
  const items = useLarder((s) => s.items);
  const locations = useLarder((s) => s.locations);
  const overrides = useLarder((s) => s.overrides);
  const settings = useLarder((s) => s.settings);
  // Recompute when the day changes (an app left open overnight), not every minute.
  const nowMs = useNow();
  const day = nowMs ? toLocalISODate(new Date(nowMs)) : "";
  return useMemo(() => {
    const now = day ? parseLocalDate(day) : undefined;
    const views = items.map((i) => viewItem(i, { locations, overrides, settings }, now));
    return views.sort(
      (a, b) =>
        STATUS_ORDER[a.expiry.status] - STATUS_ORDER[b.expiry.status] ||
        a.expiry.daysLeft - b.expiry.daysLeft ||
        a.item.name.localeCompare(b.item.name),
    );
  }, [items, locations, overrides, settings, day]);
}

export function useItemView(id: string): ItemView | undefined {
  const views = useItemViews();
  return views.find((v) => v.item.id === id);
}

export interface StapleView {
  staple: Staple;
  /** Larder items that are this staple and still good, most urgent first. */
  items: ItemView[];
  inStock: boolean;
  /** True when none is left, or what's left is a quarter or less of what was bought. */
  low: boolean;
  /** Already on the shopping list, unticked. */
  onList: boolean;
}

/** Pure version of `useHouseholdStaples`, for tests and non-React callers. */
export function stapleViews(
  staples: Staple[],
  views: ItemView[],
  list: { name: string; foodTypeId: string | null; checked: boolean }[],
): StapleView[] {
  return staples.map((staple) => {
    const items = views.filter((v) => sameStapleFood(staple, v.item) && v.item.quantity > 0 && v.expiry.status !== "expired");
    const left = items.reduce((t, v) => t + v.item.quantity, 0);
    const bought = items.reduce((t, v) => t + Math.max(v.item.initialQuantity, v.item.quantity), 0);
    return {
      staple,
      items,
      inStock: items.length > 0,
      low: items.length === 0 || (bought > 0 && left / bought <= 0.25),
      onList: list.some((l) => !l.checked && sameStapleFood(staple, l)),
    };
  });
}

/**
 * The household's own staples ("Always keep in stock" on the item sheet), each with whether
 * it is in the larder, running low, or already on the list. Gone-off items don't count as stock.
 */
export function useHouseholdStaples(): StapleView[] {
  const staples = useLarder((s) => s.staples);
  const list = useLarder((s) => s.shoppingList);
  const views = useItemViews();
  return useMemo(() => stapleViews(staples, views, list), [staples, views, list]);
}

/** Whether this item is one of the household's staples. */
export function useIsStaple(item: Pick<PantryItem, "name" | "foodTypeId"> | undefined): boolean {
  return useLarder((s) => !!item && s.staples.some((x) => sameStapleFood(x, item)));
}
