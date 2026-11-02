import type { DateKind, FoodType, ItemStatus, PantryItem, ShelfLifeOverride, StorageLocation } from "@/lib/types";

const DAY_MS = 86_400_000;

type StorageKind = StorageLocation["kind"];

/**
 * Fallback days when an item has no matched food type (see `unknownDays`). The pantry figure is
 * deliberately short: an unknown food on the bench could be anything, so we ask to check it soon.
 */
const FALLBACK_DAYS = { pantry: 7, fridge: 5, freezer: 90 } as const;
/** Unknown raw meat or seafood: the household rule for raw mince, poultry and fish (2 fridge days). */
const HIGH_RISK_DAYS = 2;
/**
 * A known food kept somewhere its table has no days for (milk in the pantry, cooked food on the
 * bench, a frozen-only food in the fridge): a safe short stand-in, never the other spot's long life.
 */
const UNSUITED_DAYS = { pantry: 1, fridge: 3 } as const;
/** Freezer life used for foods whose table says "not recommended frozen". */
export const FREEZER_NOT_RECOMMENDED_DAYS = 30;

const SPOT_NAME: Record<StorageKind, string> = { pantry: "pantry", fridge: "fridge", freezer: "freezer" };

const HIGH_RISK =
  /\b(meat|mince|chicken|chook|fish|prawns?|shrimps?|seafood|fillets?|steaks?|sausages?|snags?|pork|lamb|beef|veal|kangaroo|roo|turkey|duck|chops?|cutlets?|mussels?|oysters?|squid|calamari|octopus|cuttlefish|salmon|tuna|sardines?|mackerel|barramundi|barra|flathead|trout|whiting|bream|snapper|cod|basa|hoki|ling|dory|kingfish|mahi ?mahi|swordfish|tilapia|crab|lobster|crayfish|yabbies|marron|scallops?|clams?|pipis|vongole|goat|mutton|venison|rabbit|quail|wings?|drumsticks?|thighs?|brisket|rissoles?|meatballs?|patt(?:y|ies)|burgers?|offal|liver)\b/i;
/**
 * Tinned, dried and cured foods that share a word with raw meat or fish ("tuna in springwater",
 * "beef jerky"). Kept narrow on purpose: words like "sauce", "flavour" or "dog" also turn up in
 * raw foods ("Chicken fillets in teriyaki sauce", "Hot dog sausages"), which must stay cautious.
 */
const SHELF_STABLE =
  /\b(tins?|tinned|cans?|canned|in (?:spring ?water|brine|oil)|springwater|jerky|biltong|dried|stock|broth|powder|(?:fish|oyster) sauce|prawn crackers?|(?:instant|2 ?minute) noodles?)\b/i;

/**
 * True when free text looks like raw meat or seafood, which must be kept cold and used fast.
 * Used for foods we couldn't match, so they get a cautious estimate.
 */
export function isHighRisk(name: string): boolean {
  return HIGH_RISK.test(name) && !SHELF_STABLE.test(name);
}

export interface UnknownDefaults {
  /** Default storage spot id (always a built-in spot). */
  locationId: "fridge";
  /** Estimated days in that spot. */
  days: number;
  dateKind: DateKind;
  highRisk: boolean;
  /** Short reason for the item sheet. */
  basis: string;
}

/**
 * Defaults for a food that didn't match the shelf-life table. Unknown foods go in the fridge
 * with a conservative 5 days; anything that looks like raw meat or seafood gets 2 days and use-by.
 */
export function defaultsForUnknown(name: string): UnknownDefaults {
  const highRisk = isHighRisk(name);
  return highRisk
    ? { locationId: "fridge", days: HIGH_RISK_DAYS, dateKind: "use-by", highRisk, basis: "Cautious estimate for raw meat or seafood" }
    : { locationId: "fridge", days: FALLBACK_DAYS.fridge, dateKind: "best-before", highRisk, basis: "Cautious estimate for the fridge" };
}

/** Days for an unmatched food in a given kind of spot. Raw meat or fish left out: use it today. */
function unknownDays(name: string, kind: StorageKind): number {
  if (kind === "freezer") return FALLBACK_DAYS.freezer;
  if (isHighRisk(name)) return kind === "pantry" ? 0 : HIGH_RISK_DAYS;
  return FALLBACK_DAYS[kind];
}

/** True when the shelf-life table says this food doesn't freeze well. */
export function freezerNotRecommended(food: FoodType | undefined): boolean {
  return !!food && food.freezerDays === null;
}

/** The better spot for a food whose table has no days for `kind` (shortest non-null of pantry/fridge). */
function betterSpot(food: FoodType, kind: StorageKind): { kind: "pantry" | "fridge"; days: number } | undefined {
  const options = (["fridge", "pantry"] as const)
    .filter((k) => k !== kind && food[`${k}Days`] !== null)
    .map((k) => ({ kind: k, days: food[`${k}Days`] as number }));
  options.sort((a, b) => a.days - b.days);
  return options[0];
}

/**
 * A warning when a known food isn't suited to a kind of spot, or undefined when it's fine.
 * e.g. milk in the pantry → "Not suited to the pantry — move it to the fridge";
 * lettuce in the freezer → "Not great frozen — texture suffers".
 */
export function storageWarning(food: FoodType | undefined, kind: StorageKind): string | undefined {
  if (!food) return undefined;
  if (kind === "freezer") return food.freezerDays === null ? "Not great frozen — texture suffers" : undefined;
  if (food[`${kind}Days`] !== null) return undefined;
  const better = betterSpot(food, kind);
  if (better) return `Not suited to the ${SPOT_NAME[kind]} — move it to the ${better.kind}`;
  return food.freezerDays !== null ? "Keep this one in the freezer" : `Not suited to the ${SPOT_NAME[kind]}`;
}

/**
 * Days a food lasts in a kind of spot, never null: the table/override value when there is one,
 * otherwise a safe short stand-in (at most 3 days in the fridge, 1 in the pantry, 30 frozen, or the
 * unknown-food default). A spot the food isn't suited to never borrows another spot's long life:
 * cooked lentils in the fridge must not get dried lentils' two years.
 */
export function storageDays(
  food: FoodType | undefined,
  override: ShelfLifeOverride | undefined,
  kind: StorageKind,
  name = "",
): number {
  if (!food) return unknownDays(name, kind);
  const days = effectiveDays(food, override, kind);
  if (days !== null) return days;
  if (kind === "freezer") return FREEZER_NOT_RECOMMENDED_DAYS;
  const better = betterSpot(food, kind);
  // Chilling a shelf-stable food (a tin, a jar of sauce) doesn't shorten its life, unless the name
  // says it's really raw fish or meat ("tuna" in the fridge is a steak, not a tin).
  if (kind === "fridge" && better?.kind === "pantry" && better.days >= SHELF_STABLE_DAYS && !isHighRisk(name)) return better.days;
  if (kind === "fridge" && isHighRisk(name)) return HIGH_RISK_DAYS;
  return Math.min(UNSUITED_DAYS[kind], better?.days ?? UNSUITED_DAYS[kind]);
}

/** Pantry life from which a food counts as shelf-stable (tins, jars, dry goods, long-life). */
const SHELF_STABLE_DAYS = 60;

/**
 * How long a food keeps unopened wherever it does best (the longer of its pantry and fridge
 * life), used to cap the opened clock. Falls back to the current spot for unknown foods.
 */
function unopenedDays(food: FoodType | undefined, override: ShelfLifeOverride | undefined, kind: StorageKind, name: string): number {
  if (!food) return storageDays(food, override, kind, name);
  const own = effectiveDays(food, override, kind === "freezer" ? "fridge" : kind);
  if (own !== null) return own;
  const options = (["pantry", "fridge"] as const).map((k) => effectiveDays(food, override, k)).filter((d): d is number => d !== null);
  return options.length ? Math.max(...options) : storageDays(food, override, kind, name);
}

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

/**
 * Shelf-life days for a food type, with the household's override applied. Can be null
 * ("not recommended" in the table); use `storageDays` when you need a number to show.
 */
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
  const spot = location?.name.toLowerCase() ?? kind;
  const days = (k: StorageKind) => storageDays(food, override, k, item.name);

  let expiresOn: Date;
  let estimated = true;
  let basis: string;

  const printed = item.printedDate ? parseLocalDate(item.printedDate) : undefined;

  if (item.expiredWhenFrozen && (kind === "freezer" || item.thawedAt)) {
    // Freezing doesn't make food safe again: it stays past its date.
    const frozenAt = new Date(item.frozenAt ?? item.addedAt);
    expiresOn = addDays(startOfDay(frozenAt), -1);
    basis = "Was past its date when frozen";
  } else if (kind === "freezer") {
    // Freezing pauses the clock: count freezer life from when it went in.
    const frozenAt = new Date(item.frozenAt ?? item.addedAt);
    expiresOn = addDays(startOfDay(frozenAt), days("freezer"));
    basis = `Frozen ${relativeDay(frozenAt, now)}`;
    if (freezerNotRecommended(food)) basis += ". Not great frozen — texture suffers";
  } else if (item.thawedAt) {
    const thawed = new Date(item.thawedAt);
    const thawDays = food?.thawedDays ?? Math.min(days("fridge"), 2);
    expiresOn = addDays(startOfDay(thawed), thawDays);
    basis = `Thawed ${relativeDay(thawed, now)}`;
  } else if (item.openedAt) {
    const opened = new Date(item.openedAt);
    const openDays = effectiveDays(food, override, "opened") ?? days(kind);
    expiresOn = addDays(startOfDay(opened), openDays);
    basis = `Opened ${relativeDay(opened, now)}`;
    // Opening only ever shortens the clock: an opened item never outlasts the date it had
    // unopened, printed or estimated. (Opening spoiled milk must not make it fresh again.)
    const unopened = printed ?? addDays(startOfDay(new Date(item.addedAt)), unopenedDays(food, override, kind, item.name));
    if (unopened < expiresOn) {
      expiresOn = unopened;
      if (printed) {
        estimated = false;
        basis = item.dateKind === "use-by" ? "Printed use-by date" : "Printed best-before date";
      } else {
        basis += ". It was already close to its date";
      }
    }
  } else if (printed) {
    expiresOn = printed;
    estimated = false;
    basis = item.dateKind === "use-by" ? "Printed use-by date" : "Printed best-before date";
  } else {
    const added = new Date(item.addedAt);
    expiresOn = addDays(startOfDay(added), days(kind));
    const warning = storageWarning(food, kind);
    basis = warning
      ? warning
      : food
        ? `Typical for ${food.name.toLowerCase()} in the ${spot}`
        : isHighRisk(item.name)
          ? "Cautious estimate for raw meat or seafood"
          : kind === "pantry"
            ? `Typical for the ${spot}`
            : `Cautious estimate for the ${spot}`;
  }

  const daysLeft = daysBetween(now, expiresOn);
  return { expiresOn, estimated, daysLeft, status: statusFor(daysLeft, useSoonDays), basis };
}

/**
 * True when an item is past its use-by or estimated date right now (in a non-freezer spot).
 * A printed best-before date in the past doesn't count: that's quality, not safety.
 * The store calls this when an item goes into the freezer to set `expiredWhenFrozen`.
 */
export function isPastDateForFreezing(
  item: PantryItem,
  opts: Omit<Parameters<typeof computeExpiry>[1], "useSoonDays">,
): boolean {
  if (opts.location?.kind === "freezer" && !item.thawedAt) return false; // already frozen; the freezer clock applies
  const info = computeExpiry(item, opts);
  if (!info.estimated && item.dateKind === "best-before") return false;
  return !(info.daysLeft >= 0);
}

export function statusFor(daysLeft: number, useSoonDays: number): ItemStatus {
  if (!Number.isFinite(daysLeft) || daysLeft < 0) return "expired";
  if (daysLeft === 0) return "use-today";
  if (daysLeft <= useSoonDays) return "use-soon";
  return "fresh";
}

export function relativeDay(d: Date, now: Date = new Date()): string {
  const diff = daysBetween(d, now);
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff > 1) return `${spanAgo(diff)} ago`;
  if (diff === -1) return "tomorrow";
  return `in ${-diff} days`;
}

/** "3 days", "about 2 weeks", "about 5 months", "about a year", "about 7 years", for a span in the past. */
function spanAgo(days: number): string {
  if (days < 14) return `${days} days`;
  if (days < 60) return `about ${Math.round(days / 7)} weeks`;
  if (days < 330) return `about ${Math.round(days / 30)} months`;
  const years = Math.round(days / 365);
  return years <= 1 ? "about a year" : `about ${years} years`;
}

/** Human label for how long is left, honest about best-before vs use-by. */
export function describeDaysLeft(info: ExpiryInfo, dateKind: PantryItem["dateKind"]): string {
  const d = info.daysLeft;
  const est = info.estimated ? "about " : "";
  if (!Number.isFinite(d)) return "Check the date";
  if (d < 0) {
    const ago = -d === 1 ? "yesterday" : `${spanAgo(-d)} ago`;
    return dateKind === "best-before" ? `Past best before (${ago})` : `Likely spoiled (${ago})`;
  }
  if (d === 0) return "Use today";
  if (d === 1) return "Use by tomorrow";
  if (d < 14) return `${est}${d} days left`;
  if (d < 60) return `${est}${Math.round(d / 7)} weeks left`;
  if (d < 330) return `${est}${Math.round(d / 30)} months left`;
  // A year or more out is always approximate, printed or not.
  const years = Math.round(d / 365);
  return years <= 1 ? "about a year left" : `about ${years} years left`;
}

/**
 * Label for the date an item is tracked against. Frozen food is about quality, not safety, so
 * the freezer always says "Best quality by"; elsewhere it follows the printed kind.
 */
export function dateLabel(dateKind: DateKind, kind?: StorageKind, opts?: { thawed?: boolean }): string {
  if (kind === "freezer" && !opts?.thawed) return "Best quality by";
  return dateKind === "use-by" ? "Use by" : "Best before";
}

export const STATUS_ORDER: Record<ItemStatus, number> = {
  expired: 0,
  "use-today": 1,
  "use-soon": 2,
  fresh: 3,
};
