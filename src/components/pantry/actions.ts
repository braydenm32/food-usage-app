"use client";

import { useLarder } from "@/lib/store";
import { viewItem } from "@/lib/selectors";
import { describeDaysLeft, effectiveDays } from "@/lib/shelf-life/engine";
import { getFoodType } from "@/lib/shelf-life/foods";
import { toast } from "@/components/toast";

/** Item actions shared by the Today screen, the larder list and the item sheet. Each toasts with Undo. */

export const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function find(id: string) {
  return useLarder.getState().items.find((i) => i.id === id);
}

export function markUsed(id: string) {
  const item = find(id);
  if (!item) return;
  useLarder.getState().consumeItem(id, "all", "used");
  toast(`Used ${item.name}`, { undoable: true });
}

export function markBinned(id: string) {
  const item = find(id);
  if (!item) return;
  useLarder.getState().consumeItem(id, "all", "binned");
  toast(`Binned ${item.name}`, { undoable: true });
}

export function removeItem(id: string) {
  const item = find(id);
  if (!item) return;
  useLarder.getState().deleteItem(id);
  toast(`Removed ${item.name}`, { undoable: true });
}

/** Default notifier: an Undo toast. Pages that show their own feedback (the item sheet) pass another. */
export type Notify = (message: string) => void;
const undoToast: Notify = (m) => toast(m, { undoable: true });

export function markOpened(id: string, notify: Notify = undoToast) {
  const s = useLarder.getState();
  s.openItem(id);
  const item = find(id);
  if (!item) return;
  const v = viewItem(item, useLarder.getState());
  notify(`${item.name} opened. ${capitalise(describeDaysLeft(v.expiry, item.dateKind))}.`);
}

/** Move an item and explain what that does to its date. */
export function moveTo(id: string, locationId: string, notify: Notify = undoToast) {
  const s = useLarder.getState();
  const item = s.items.find((i) => i.id === id);
  if (!item || item.locationId === locationId) return;
  const from = s.locations.find((l) => l.id === item.locationId);
  const to = s.locations.find((l) => l.id === locationId);
  s.moveItem(id, locationId);
  const food = getFoodType(item.foodTypeId);
  const override = item.foodTypeId ? s.overrides[item.foodTypeId] : undefined;
  let msg = `Moved to the ${to?.name.toLowerCase() ?? "new spot"}`;
  if (to?.kind === "freezer") {
    const days = effectiveDays(food, override, "freezer") ?? 90;
    const span =
      days >= 60 ? `${Math.round(days / 30)} months` : days >= 14 ? `${Math.round(days / 7)} weeks` : `${days} days`;
    msg = `Frozen — good for about ${span}`;
  } else if (from?.kind === "freezer") {
    const days = food?.thawedDays ?? Math.min(effectiveDays(food, override, "fridge") ?? 2, 2);
    msg = `Thawed — use within ${days === 1 ? "a day" : `${days} days`}`;
  }
  notify(msg);
}
