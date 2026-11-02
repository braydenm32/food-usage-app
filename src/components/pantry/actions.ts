"use client";

import { useLarder } from "@/lib/store";
import { isHighRiskFood, viewItem, type ItemView } from "@/lib/selectors";
import {
  describeDaysLeft,
  freezerNotRecommended,
  isPastDateForFreezing,
  storageDays,
} from "@/lib/shelf-life/engine";
import { getFoodType } from "@/lib/shelf-life/foods";
import type { PantryItem } from "@/lib/types";
import { toast } from "@/components/toast";
import { formatQuantity } from "./format";

/**
 * Item actions shared by the Today screen, the larder list and the item sheet. Each toasts with Undo.
 * Wording is the same everywhere: "Ate 1" / "Used some" for part, "Used it all", "Bin it".
 */

export const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function find(id: string) {
  return useLarder.getState().items.find((i) => i.id === id);
}

/** Units counted one at a time, where "had one" means taking 1 off. */
const COUNTABLE = new Set(["item", "pack", "tin", "jar", "bottle", "loaf", "bunch"]);

/**
 * What the main "used" button does for this item:
 * - "one": countable with more than one left, so a tap takes 1 off ("Ate 1" / "Used 1").
 * - "amount": weights, volumes and dozens: a tap asks how much.
 * - "all": just one left, so a tap finishes it.
 */
export function primaryUse(item: Pick<PantryItem, "unit" | "quantity">): "one" | "amount" | "all" {
  if (COUNTABLE.has(item.unit)) return item.quantity > 1 ? "one" : "all";
  return "amount";
}

/** "Ate 1" for loose food (bananas, avocados), "Used 1" for tins, jars and packs. */
export function oneLabel(item: Pick<PantryItem, "unit">): string {
  return item.unit === "item" ? "Ate 1" : "Used 1";
}

/** Quick amounts for the "Used some" choice: a quarter, half and three quarters of what's left. */
export function quickAmounts(item: Pick<PantryItem, "unit" | "quantity">): { label: string; quantity: number }[] {
  const round = (q: number) => {
    if (item.unit === "g" || item.unit === "ml") return Math.max(1, Math.round(q / 5) * 5);
    return Math.round(q * 100) / 100;
  };
  const seen = new Set<number>();
  return [
    { f: 0.25, word: "A quarter" },
    { f: 0.5, word: "Half" },
    { f: 0.75, word: "Most" },
  ]
    .map(({ f, word }) => ({ word, quantity: round(item.quantity * f) }))
    .filter((a) => a.quantity > 0 && a.quantity < item.quantity && !seen.has(a.quantity) && seen.add(a.quantity))
    .map((a) => ({ label: `${a.word} (${formatQuantity(a.quantity, item.unit as PantryItem["unit"])})`, quantity: a.quantity }));
}

/** Put a used-up item on the shopping list (unless it is already there). */
export function addUsedToList(name: string, foodTypeId: string | null) {
  const s = useLarder.getState();
  const already = s.shoppingList.some(
    (l) => !l.checked && ((foodTypeId && l.foodTypeId === foodTypeId) || l.name.toLowerCase() === name.toLowerCase()),
  );
  if (already) return toast(`${name} is already on your list`);
  s.addToList([{ name, foodTypeId, reason: "manual" }]);
  toast(`Added ${name} to your list`);
}

/** "Used it all": the item is finished and leaves the larder. */
export function markUsed(id: string) {
  const item = find(id);
  if (!item) return;
  useLarder.getState().consumeItem(id, "all", "used");
  toast(`Used it all: ${item.name}`, {
    undoable: true,
    action: { label: "Add to list", onClick: () => addUsedToList(item.name, item.foodTypeId ?? null) },
  });
}

/** "Ate 1": take one off a countable item. */
export function eatOne(id: string) {
  const item = find(id);
  if (!item) return;
  if (item.quantity <= 1) return markUsed(id);
  useLarder.getState().consumeItem(id, 1, "used");
  const left = Math.round((item.quantity - 1) * 1000) / 1000;
  toast(`${oneLabel(item)} ${item.name}. ${formatQuantity(left, item.unit).replace(/^×/, "")} left`, {
    undoable: true,
    action: { label: "Used it all", onClick: () => markUsed(id) },
  });
}

/** Use part of an item ("Used some"). Using everything that's left counts as "Used it all". */
export function markSomeUsed(id: string, quantity: number, notify?: Notify) {
  const item = find(id);
  if (!item || quantity <= 0) return;
  if (quantity >= item.quantity) return markUsed(id);
  useLarder.getState().consumeItem(id, quantity, "used");
  const msg = `Used ${formatQuantity(quantity, item.unit).replace(/^×/, "")} of ${item.name}`;
  if (notify) notify(msg);
  else toast(msg, { undoable: true });
}

export function markBinned(id: string) {
  const item = find(id);
  if (!item) return;
  useLarder.getState().consumeItem(id, "all", "binned");
  toast(`Binned ${item.name}`, { undoable: true });
}

/** Bin several items as one Undo step. */
export function binMany(ids: string[]) {
  const live = ids.filter((id) => find(id));
  if (live.length === 0) return;
  if (live.length === 1) return markBinned(live[0]);
  useLarder.getState().consumeMany(live, "binned");
  toast(`Binned ${live.length} items`, { undoable: true });
}

/** "Used it all" for several items as one Undo step. */
export function markManyUsed(ids: string[]) {
  const live = ids.filter((id) => find(id));
  if (live.length === 0) return;
  if (live.length === 1) return markUsed(live[0]);
  useLarder.getState().consumeMany(live, "used");
  toast(`Used it all: ${live.length} items`, { undoable: true });
}

/** Move several items as one Undo step. */
export function moveMany(ids: string[], locationId: string) {
  const s = useLarder.getState();
  const to = s.locations.find((l) => l.id === locationId);
  const n = s.moveMany(ids, locationId);
  if (n > 0) toast(`Moved ${n} item${n === 1 ? "" : "s"} to the ${to?.name.toLowerCase() ?? "new spot"}`, { undoable: true });
}

/** Delete an item added by mistake (no event is logged). */
export function removeItem(id: string) {
  const item = find(id);
  if (!item) return;
  useLarder.getState().deleteItem(id);
  toast(`Deleted ${item.name}`, { undoable: true });
}

/** Default notifier: an Undo toast. Pass `undoable: false` for plain messages. */
export type Notify = (message: string, undoable?: boolean) => void;
const undoToast: Notify = (m, undoable = true) => toast(m, { undoable });

export function markOpened(id: string, notify: Notify = undoToast) {
  const s = useLarder.getState();
  s.openItem(id);
  const item = find(id);
  if (!item) return;
  const v = viewItem(item, useLarder.getState());
  notify(`${item.name} opened. ${capitalise(describeDaysLeft(v.expiry, item.dateKind))}.`);
}

function span(days: number) {
  if (days >= 60) return `${Math.round(days / 30)} months`;
  if (days >= 14) return `${Math.round(days / 7)} weeks`;
  return days === 1 ? "a day" : `${days} days`;
}

/** Move an item and explain what that does to its date, with a warning when freezing won't help. */
export function moveTo(id: string, locationId: string, notify: Notify = undoToast, quantity?: number) {
  const s = useLarder.getState();
  const item = s.items.find((i) => i.id === id);
  if (!item || item.locationId === locationId) return;
  const from = s.locations.find((l) => l.id === item.locationId);
  const to = s.locations.find((l) => l.id === locationId);
  const food = getFoodType(item.foodTypeId);
  const override = item.foodTypeId ? s.overrides[item.foodTypeId] : undefined;
  const freezing = to?.kind === "freezer" && from?.kind !== "freezer";
  // Check before moving: once frozen, the freezer clock applies.
  const pastDate = freezing && isPastDateForFreezing(item, { food, override, location: from });

  const partial = quantity !== undefined && quantity > 0 && quantity < item.quantity;
  s.moveItem(id, locationId, partial ? quantity : undefined);

  let msg = partial ? `Moved ${quantity} to the ${to?.name.toLowerCase() ?? "new spot"}` : `Moved to the ${to?.name.toLowerCase() ?? "new spot"}`;
  if (freezing) {
    if (pastDate) {
      msg = "Frozen, but it's already past its date — freezing won't make it safe";
    } else {
      msg = `${partial ? `Froze ${quantity}` : `Froze ${item.name}`} — good for about ${span(storageDays(food, override, "freezer", item.name))}`;
      if (freezerNotRecommended(food)) msg += ". Not great frozen — texture suffers";
    }
  } else if (from?.kind === "freezer" && to?.kind !== "freezer") {
    const days = food?.thawedDays ?? Math.min(storageDays(food, override, "fridge", item.name), 2);
    msg = `Thawed — use within ${span(days)}`;
  }
  notify(msg);
}

/** The household's first freezer, if it has one. */
export function freezerId(): string | undefined {
  return useLarder.getState().locations.find((l) => l.kind === "freezer")?.id;
}

/**
 * Whether to offer "Freeze it" for an item: not frozen already, freezes well (by the table, or
 * unknown raw meat or fish), still in date, and there is a freezer to put it in.
 */
export function canFreeze(view: ItemView, hasFreezer = !!freezerId()): boolean {
  const { item, food, location, expiry } = view;
  if (!hasFreezer || location?.kind === "freezer" || item.thawedAt) return false;
  if (expiry.daysLeft < 0) return false;
  if (food) return food.freezerDays !== null && food.freezerDays >= 30;
  return isHighRiskFood(item, food);
}

export function freezeItem(id: string, notify: Notify = undoToast) {
  const to = freezerId();
  if (to) moveTo(id, to, notify);
}

/** Freeze several items as one Undo step. */
export function freezeMany(ids: string[]) {
  const to = freezerId();
  if (!to) return;
  if (ids.length === 1) return freezeItem(ids[0]);
  const n = useLarder.getState().moveMany(ids, to);
  if (n > 0) toast(`Froze ${n} items`, { undoable: true });
}
