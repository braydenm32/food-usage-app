import type { FoodType, ItemStatus, PantryItem, ShelfLifeOverride, StorageLocation } from "@/lib/types";

const DAY_MS = 86_400_000;

/** Fallback days when an item has no matched food type. */
const FALLBACK_DAYS = { pantry: 30, fridge: 7, freezer: 90 } as const;

export interface ExpiryInfo {
  /** Local date (midnight) the item should be used by. */
  expiresOn: Date;
  /** True when the date is an estimate rather than a printed date. */
  estimated: boolean;
  /** Whole days from today until expiresOn. Negative once past. */
  daysLeft: number;
  status: ItemStatus;
  /** Short reason shown in the item sheet, e.g. "Opened 2 days ago". */
  basis: string;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
}

/** Parse "YYYY-MM-DD" as a local date (not UTC). */
export function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toLocalISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Shelf-life days for a food type, with the household's override applied. */
export function effectiveDays(
  food: FoodType | undefined,
  override: ShelfLifeOverride | undefined,
  kind: "pantry" | "fridge" | "freezer" | "opened",
): number | null {
  const key = `${kind}Days` as const;
  if (override && override[key] !== undefined) return override[key] ?? null;
  if (!food) return kind === "opened" ? null : FALLBACK_DAYS[kind];
  return food[key];
}

export function computeExpiry(
  item: PantryItem,
  opts: {
    food?: FoodType;
    override?: ShelfLifeOverride;
    location?: StorageLocation;
    useSoonDays?: number;
    now?: Date;
  },
): ExpiryInfo {
  const { food, override, location } = opts;
  const now = opts.now ?? new Date();
  const useSoonDays = opts.useSoonDays ?? 2;
  const kind = location?.kind ?? "fridge";

  let expiresOn: Date;
  let estimated = true;
  let basis: string;

  const printed = item.printedDate ? parseLocalDate(item.printedDate) : undefined;

  if (kind === "freezer") {
    // Freezing pauses the clock: count freezer life from when it went in.
    const frozenAt = new Date(item.frozenAt ?? item.addedAt);
    const days = effectiveDays(food, override, "freezer") ?? FALLBACK_DAYS.freezer;
    expiresOn = addDays(startOfDay(frozenAt), days);
    basis = `Frozen ${relativeDay(frozenAt, now)}`;
  } else if (item.thawedAt) {
    const thawed = new Date(item.thawedAt);
    const days = food?.thawedDays ?? Math.min(effectiveDays(food, override, "fridge") ?? 2, 2);
    expiresOn = addDays(startOfDay(thawed), days);
    basis = `Thawed ${relativeDay(thawed, now)}`;
  } else if (item.openedAt) {
    const opened = new Date(item.openedAt);
    const days =
      effectiveDays(food, override, "opened") ??
      effectiveDays(food, override, kind) ??
      FALLBACK_DAYS.fridge;
    expiresOn = addDays(startOfDay(opened), days);
    basis = `Opened ${relativeDay(opened, now)}`;
    // An opened item never outlasts its printed use-by date.
    if (printed && item.dateKind === "use-by" && printed < expiresOn) {
      expiresOn = printed;
      estimated = false;
      basis = "Printed use-by date";
    }
  } else if (printed) {
    expiresOn = printed;
    estimated = false;
    basis = item.dateKind === "use-by" ? "Printed use-by date" : "Printed best-before date";
  } else {
    const added = new Date(item.addedAt);
    const days = effectiveDays(food, override, kind) ?? FALLBACK_DAYS[kind];
    expiresOn = addDays(startOfDay(added), days);
    basis = food
      ? `Typical for ${food.name.toLowerCase()} in the ${location?.name.toLowerCase() ?? kind}`
      : `Typical for the ${location?.name.toLowerCase() ?? kind}`;
  }

  const daysLeft = daysBetween(now, expiresOn);
  return { expiresOn, estimated, daysLeft, status: statusFor(daysLeft, useSoonDays), basis };
}

export function statusFor(daysLeft: number, useSoonDays: number): ItemStatus {
  if (daysLeft < 0) return "expired";
  if (daysLeft === 0) return "use-today";
  if (daysLeft <= useSoonDays) return "use-soon";
  return "fresh";
}

export function relativeDay(d: Date, now: Date = new Date()): string {
  const diff = daysBetween(d, now);
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff > 1) return `${diff} days ago`;
  if (diff === -1) return "tomorrow";
  return `in ${-diff} days`;
}

/** Human label for how long is left, honest about best-before vs use-by. */
export function describeDaysLeft(info: ExpiryInfo, dateKind: PantryItem["dateKind"]): string {
  const d = info.daysLeft;
  const est = info.estimated ? "about " : "";
  if (d < 0) {
    const ago = -d === 1 ? "yesterday" : `${-d} days ago`;
    return dateKind === "best-before" && !info.estimated ? `Past best before (${ago})` : `Likely spoiled (${ago})`;
  }
  if (d === 0) return "Use today";
  if (d === 1) return "Use by tomorrow";
  if (d < 14) return `${est}${d} days left`;
  if (d < 60) return `${est}${Math.round(d / 7)} weeks left`;
  if (d < 365) return `${est}${Math.round(d / 30)} months left`;
  const years = Math.round(d / 365);
  return `${est}${years} year${years === 1 ? "" : "s"} left`;
}

export const STATUS_ORDER: Record<ItemStatus, number> = {
  expired: 0,
  "use-today": 1,
  "use-soon": 2,
  fresh: 3,
};
