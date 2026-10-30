"use client";

import { useMemo } from "react";
import { useLarder } from "@/lib/store";
import { useNow } from "@/lib/use-now";
import { computeExpiry, parseLocalDate, STATUS_ORDER, toLocalISODate, type ExpiryInfo } from "@/lib/shelf-life/engine";
import { getFoodType } from "@/lib/shelf-life/foods";
import type { FoodType, PantryItem, StorageLocation } from "@/lib/types";

export interface ItemView {
  item: PantryItem;
  food?: FoodType;
  location?: StorageLocation;
  expiry: ExpiryInfo;
}

export function viewItem(
  item: PantryItem,
  state: Pick<ReturnType<typeof useLarder.getState>, "locations" | "overrides" | "settings">,
  now?: Date,
): ItemView {
  const food = getFoodType(item.foodTypeId);
  const location = state.locations.find((l) => l.id === item.locationId);
  const expiry = computeExpiry(item, {
    food,
    override: item.foodTypeId ? state.overrides[item.foodTypeId] : undefined,
    location,
    useSoonDays: state.settings.useSoonDays,
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
