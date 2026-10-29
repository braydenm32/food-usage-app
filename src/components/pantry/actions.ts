"use client";

import { useLarder } from "@/lib/store";
import { viewItem } from "@/lib/selectors";
import {
  describeDaysLeft,
  freezerNotRecommended,
  isPastDateForFreezing,
  storageDays,
} from "@/lib/shelf-life/engine";
import { getFoodType } from "@/lib/shelf-life/foods";
import { toast } from "@/components/toast";

/** Item actions shared by the Today screen, the larder list and the item sheet. Each toasts with Undo. */

export const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function find(id: string) {
  return useLarder.getState().items.find((i) => i.id === id);
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

export function markUsed(id: string) {
  const item = find(id);
  if (!item) return;
  useLarder.getState().consumeItem(id, "all", "used");
  toast(`Used ${item.name}`, {
    undoable: true,
    action: { label: "Add to list", onClick: () => addUsedToList(item.name, item.foodTypeId ?? null) },
  });
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

export function removeItem(id: string) {
  const item = find(id);
  if (!item) return;
  useLarder.getState().deleteItem(id);
  toast(`Removed ${item.name}`, { undoable: true });
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
export function moveTo(id: string, locationId: string, notify: Notify = undoToast) {
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

  s.moveItem(id, locationId);

  let msg = `Moved to the ${to?.name.toLowerCase() ?? "new spot"}`;
  if (freezing) {
    if (pastDate) {
      msg = "Frozen, but it's already past its date — freezing won't make it safe";
    } else {
      msg = `Frozen — good for about ${span(storageDays(food, override, "freezer", item.name))}`;
      if (freezerNotRecommended(food)) msg += ". Not great frozen — texture suffers";
    }
  } else if (from?.kind === "freezer" && to?.kind !== "freezer") {
    const days = food?.thawedDays ?? Math.min(storageDays(food, override, "fridge", item.name), 2);
    msg = `Thawed — use within ${span(days)}`;
  }
  notify(msg);
}
