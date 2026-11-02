"use client";

import { useId, useState } from "react";
import { CalendarCheck } from "lucide-react";
import { useLarder } from "@/lib/store";
import { isHighRiskFood, type ItemView } from "@/lib/selectors";
import { addDays, daysBetween, effectiveDays, parseLocalDate, startOfDay, toLocalISODate } from "@/lib/shelf-life/engine";
import type { ShelfLifeOverride } from "@/lib/types";
import { Button, Chip, Input, cx } from "@/components/ui";
import { toast } from "@/components/toast";
import { formatShortDate } from "./format";

export interface RememberOffer {
  column: "pantryDays" | "fridgeDays";
  days: number;
  foodTypeId: string;
  /** "baby spinach in the fridge" */
  phrase: string;
}

/**
 * When a new date for a sealed, estimated item differs from the table, offer to remember it
 * for that food from now on. Frozen, thawed or opened items follow their own clock, so no offer.
 */
export function rememberOfferFor(
  view: ItemView,
  isoDate: string,
  overrides: Record<string, ShelfLifeOverride>,
): RememberOffer | null {
  const { item, food, location, expiry } = view;
  const kind = location?.kind ?? "fridge";
  if (!expiry.estimated || !food || kind === "freezer" || item.thawedAt || item.openedAt) return null;
  const column = `${kind}Days` as RememberOffer["column"];
  const days = daysBetween(new Date(item.addedAt), parseLocalDate(isoDate));
  const current = effectiveDays(food, overrides[food.id], kind);
  if (days < 1 || days === current) return null;
  return { column, days, foodTypeId: food.id, phrase: `${food.name.toLowerCase()} in the ${kind}` };
}

/** Save a remember offer as a household override. */
export function rememberDays(offer: RememberOffer) {
  useLarder.getState().setOverride({ foodTypeId: offer.foodTypeId, [offer.column]: offer.days } as ShelfLifeOverride);
  toast(`Got it. ${offer.days} days for ${offer.phrase} from now on.`);
}

/**
 * Whether to ask "Is it still within date?": raw meat, fish and leftovers on an estimated date
 * that is close or past, or best-before food that is past its date ("Still good?").
 */
export function needsDateCheck(view: ItemView): "within-date" | "still-good" | null {
  const { item, food, location, expiry } = view;
  if (location?.kind === "freezer") return null;
  if (item.dateKind === "best-before" && expiry.status === "expired") return "still-good";
  if (expiry.estimated && !item.openedAt && !item.thawedAt && expiry.status !== "fresh" && isHighRiskFood(item, food)) {
    return "within-date";
  }
  return null;
}

/** Set an item's date after the user checked it, and offer to remember the shelf life. */
export function confirmDate(view: ItemView, isoDate: string) {
  const s = useLarder.getState();
  const offer = rememberOfferFor(view, isoDate, s.overrides);
  s.updateItem(view.item.id, { printedDate: isoDate });
  const when = formatShortDate(parseLocalDate(isoDate));
  toast(`${view.item.name}: ${view.item.dateKind === "use-by" ? "use by" : "best before"} ${when}`, {
    action: offer ? { label: `Remember ${offer.days} days`, onClick: () => rememberDays(offer) } : undefined,
  });
}

/**
 * The quick "Is it still within date?" check: enter the date on the pack, or say it's still
 * good for a couple of days or a week. Replaces opening the whole sheet for a date picker.
 */
export function DateCheck({ view, kind, className }: { view: ItemView; kind: "within-date" | "still-good"; className?: string }) {
  const [picking, setPicking] = useState(false);
  const [value, setValue] = useState("");
  const inputId = useId();
  const today = startOfDay(new Date());
  const iso = (n: number) => toLocalISODate(addDays(today, n));
  const highRisk = kind === "within-date";

  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
        <CalendarCheck size={16} aria-hidden className="shrink-0 text-ink-2" />
        {highRisk ? "Is it still within date?" : "Still looks, smells and tastes fine?"}
      </p>
      <div role="group" aria-label={highRisk ? `Is ${view.item.name} still within date?` : `Is ${view.item.name} still good?`} className="flex flex-wrap gap-2">
        <Chip onClick={() => setPicking((p) => !p)} aria-expanded={picking} className={picking ? "border-primary text-ink" : undefined}>
          {highRisk ? "Enter the pack date" : "Pick a date"}
        </Chip>
        <Chip onClick={() => confirmDate(view, iso(2))}>{highRisk ? "Yes, 2 more days" : "Good for 2 more days"}</Chip>
        <Chip onClick={() => confirmDate(view, iso(7))}>{highRisk ? "Yes, a week" : "Good for a week"}</Chip>
      </div>
      {picking && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (value) confirmDate(view, value);
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            Date on the pack for {view.item.name}
          </label>
          <Input
            id={inputId}
            type="date"
            autoFocus
            min={iso(-60)}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="min-w-0 flex-1 basis-40"
          />
          <Button type="submit" size="sm" disabled={!value} className="h-11">
            Save date
          </Button>
        </form>
      )}
      {highRisk && (
        <p className="text-xs text-ink-3">Raw meat and fish: if the pack date has passed or it smells off, bin it.</p>
      )}
    </div>
  );
}
