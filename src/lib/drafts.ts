// Turning parsed receipt / list / order / barcode lines into DraftItems for review.
// Shared by the client (add flow) and the server (API routes), so no React or store imports here.
// Relative imports keep this file loadable by vitest without path-alias config.

import { defaultsForUnknown } from "./shelf-life/engine";
import { getFoodType, matchFoodType } from "./shelf-life/foods";
import type { DraftItem, FoodType, ItemEvent, LocationId, PantryItem, Unit } from "./types";

/** One line read from a receipt, list, order email or barcode lookup, before matching. */
export interface ParsedLine {
  /** Text as it appeared on the source, for the small print in review. */
  rawText?: string;
  /** Cleaned product name, e.g. "raspberries". */
  name: string;
  /** How many packs / items (the "2" in "2 x milk 2L"). */
  count?: number;
  /** Pack size or loose amount (the "2L" in "2 x milk 2L"). */
  size?: { quantity: number; unit: Unit };
  /** AUD for the whole line. */
  price?: number;
  /** Printed use-by / best-before as ISO date, if read. */
  printedDate?: string;
  /** False for bags, cleaning products, discounts, totals… */
  isFood?: boolean;
}

/** A DraftItem with the extra bits the review screen needs. */
export interface ReviewDraft extends DraftItem {
  isFood: boolean;
  /**
   * A weak match we didn't trust enough to apply. The line keeps the shopper's own name and
   * review offers "Did you mean …?".
   */
  suggestion?: { foodTypeId: string; name: string; emoji: string };
  /** When set, this line tops up that existing larder item instead of adding a new one. */
  mergeIntoId?: string;
}

/* ---------- Units ---------- */

const UNIT_ALIASES: Record<string, Unit> = {
  g: "g",
  gm: "g",
  gms: "g",
  gram: "g",
  grams: "g",
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilos: "kg",
  ml: "ml",
  mls: "ml",
  l: "L",
  lt: "L",
  ltr: "L",
  litre: "L",
  litres: "L",
  liter: "L",
  liters: "L",
  pk: "pack",
  pkt: "pack",
  pack: "pack",
  packs: "pack",
  packet: "pack",
  packets: "pack",
  bunch: "bunch",
  bunches: "bunch",
  bn: "bunch",
  doz: "dozen",
  dozen: "dozen",
  loaf: "loaf",
  loaves: "loaf",
  tin: "tin",
  tins: "tin",
  can: "tin",
  cans: "tin",
  jar: "jar",
  jars: "jar",
  bottle: "bottle",
  bottles: "bottle",
  btl: "bottle",
  ea: "item",
  each: "item",
};

export function normaliseUnit(u: string | undefined | null): Unit | undefined {
  if (!u) return undefined;
  return UNIT_ALIASES[u.trim().toLowerCase().replace(/\.$/, "")];
}

const MEASURE_UNITS = new Set<Unit>(["g", "kg", "ml", "L"]);

/** Units you count rather than weigh. */
export function isCountUnit(u: Unit): boolean {
  return !MEASURE_UNITS.has(u);
}

function sameDimension(a: Unit, b: Unit): boolean {
  const mass = (u: Unit) => u === "g" || u === "kg";
  const vol = (u: Unit) => u === "ml" || u === "L";
  return (mass(a) && mass(b)) || (vol(a) && vol(b));
}

/** True when an amount in `a` can be converted to `b` (same unit, or g↔kg, ml↔L). */
export function compatibleUnits(a: Unit, b: Unit): boolean {
  return a === b || sameDimension(a, b);
}

/** Convert between g/kg and ml/L; other units pass through unchanged. */
export function convertQuantity(q: number, from: Unit, to: Unit): number {
  return round(convert(q, from, to));
}

function convert(q: number, from: Unit, to: Unit): number {
  if (from === to) return q;
  if (from === "kg" && to === "g") return q * 1000;
  if (from === "g" && to === "kg") return q / 1000;
  if (from === "L" && to === "ml") return q * 1000;
  if (from === "ml" && to === "L") return q / 1000;
  return q;
}

const round = (n: number) => Math.round(n * 100) / 100;

/* ---------- Keys ---------- */

let keyCounter = 0;
export function draftKey(): string {
  keyCounter += 1;
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `d-${Date.now().toString(36)}-${keyCounter}-${rand}`;
}

/* ---------- Non-food detection ---------- */

const NON_FOOD_PATTERNS: RegExp[] = [
  /\bbags?\b/,
  /\bcarry ?bag/,
  /\bdetergent/,
  /\blaundry/,
  /\bdishwash/,
  /\bdish ?liquid/,
  /\btoilet (paper|tissue|roll)/,
  /\btissues?\b/,
  /\bpaper towel/,
  /\bshampoo/,
  /\bconditioner\b/,
  /\bbody ?wash/,
  /\bsoap\b/,
  /\bdeodorant/,
  /\btoothpaste/,
  /\btoothbrush/,
  /\bnapp(y|ies)/,
  /\bwipes\b/,
  /\bcleaner\b/,
  /\bbleach/,
  /\bdisinfect/,
  /\bsponge/,
  /\bscourer/,
  /\bfoil\b/,
  /\bcling ?wrap/,
  /\bbaking paper/,
  /\bbin liner/,
  /\bgarbage bag/,
  /\bbatter(y|ies)/,
  /\blight ?bulb/,
  /\bcat litter/,
  /\bpet food/,
  /\bdog food/,
  /\bcat food/,
  /\bfloss/,
  /\brazor/,
  /\bsunscreen/,
  /\bpanadol|\bnurofen|\bparacetamol|\bibuprofen/,
  /\bcandles?\b/,
  /\bmatches\b/,
  /\bgift card/,
  /\bflowers?\b/,
];

/** Receipt and email lines that are money or admin, not products. */
const ADMIN_PATTERNS: RegExp[] = [
  /^(sub ?total|total|balance|gst|tax|change|cash|eftpos|visa|mastercard|amex|card|rounding|savings?|you saved|discount|promo(tion)?|coupon|voucher|points?|rewards?|everyday rewards|flybuys)\b/,
  /\b(delivery|service|packaging|bag|card surcharge|surcharge|order) fee\b/,
  /\btotal (savings|items|incl|including)/,
  /\bgst (incl|included)/,
  /\bincludes? gst\b/,
  /\bitems? (purchased|in order|ordered)\b/,
];

export function isLikelyNonFood(text: string): boolean {
  const t = text.toLowerCase();
  return NON_FOOD_PATTERNS.some((r) => r.test(t)) || ADMIN_PATTERNS.some((r) => r.test(t));
}

/* ---------- Line → draft ---------- */

/** Defaults for a line that matched no food: fridge, cautious dates (see defaultsForUnknown). */
function unknownDefaults(name: string): Pick<DraftItem, "emoji" | "locationId" | "dateKind"> {
  const d = defaultsForUnknown(name);
  return { emoji: "🛒", locationId: d.locationId, dateKind: d.dateKind };
}

/** Work out the quantity + unit to track, given what was read and what the food usually comes in. */
export function resolveQuantity(
  line: Pick<ParsedLine, "count" | "size">,
  food?: Pick<FoodType, "defaultUnit" | "defaultQuantity">,
): { quantity: number; unit: Unit } {
  const count = line.count && line.count > 0 ? line.count : undefined;
  const size = line.size && line.size.quantity > 0 ? line.size : undefined;

  if (food) {
    const fu = food.defaultUnit;
    if (isCountUnit(fu)) {
      const packs = count ?? 1;
      // "12pk" / "6 pack" arrive as a size in items: how many are inside one pack.
      if (size && size.unit === "item") {
        if (fu === "dozen") return { quantity: round((size.quantity * packs) / 12), unit: "dozen" };
        if (fu === "item" || fu === "tin" || fu === "jar" || fu === "bottle") return { quantity: size.quantity * packs, unit: fu };
        return { quantity: packs, unit: fu }; // a 6-pack of rolls is still one pack
      }
      if (size && size.unit === "dozen" && fu === "item") return { quantity: size.quantity * 12 * packs, unit: "item" };
      // Loose produce sold by weight ("tomatoes 1kg"): keep the weight rather than guessing a count.
      if (fu === "item" && !count && size && !isCountUnit(size.unit)) return size;
      // Counted foods (eggs, bread, tins): track how many, not the pack weight.
      if (count) return { quantity: count, unit: fu };
      if (size && size.unit === fu) return { quantity: size.quantity, unit: fu };
      if (size && isCountUnit(size.unit)) return { quantity: size.quantity, unit: size.unit };
      return { quantity: 1, unit: fu };
    }
    // Weighed / measured foods: total amount in the food's unit.
    if (size && sameDimension(size.unit, fu)) {
      return { quantity: round(convert(size.quantity, size.unit, fu) * (count ?? 1)), unit: fu };
    }
    if (size && isCountUnit(size.unit)) return { quantity: size.quantity * (count ?? 1), unit: size.unit };
    if (count) return { quantity: count, unit: "item" };
    return { quantity: food.defaultQuantity, unit: fu };
  }

  if (size && count) {
    return isCountUnit(size.unit)
      ? { quantity: size.quantity * count, unit: size.unit }
      : { quantity: round(size.quantity * count), unit: size.unit };
  }
  if (size) return size;
  if (count) return { quantity: count, unit: "item" };
  return { quantity: 1, unit: "item" };
}

/** Sentence-case a product name for display: "FULL CREAM MILK" → "Full cream milk". */
export function tidyName(name: string): string {
  const n = name.replace(/\s+/g, " ").trim();
  if (!n) return n;
  const isShouty = n === n.toUpperCase() && /[A-Z]/.test(n);
  const base = isShouty ? n.toLowerCase() : n;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function lineToDraft(line: ParsedLine): ReviewDraft {
  const isFood = line.isFood ?? !isLikelyNonFood(`${line.name} ${line.rawText ?? ""}`);
  const match = isFood ? bestMatch(line.name, line.rawText) : undefined;
  // A low-confidence match is a guess: keep the shopper's own name and only suggest the food.
  const food = match && match.confidence !== "low" ? match.food : undefined;
  const { quantity, unit } = resolveQuantity(line, food);

  if (!food) {
    const guess = match?.food;
    return {
      key: draftKey(),
      rawText: line.rawText,
      name: tidyName(line.name) || "Unknown item",
      foodTypeId: null,
      ...unknownDefaults(line.name),
      quantity,
      unit,
      price: line.price,
      printedDate: line.printedDate,
      include: isFood,
      confidence: "low",
      isFood,
      ...(guess && looksLike(line.name, guess) ? { suggestion: { foodTypeId: guess.id, name: guess.name, emoji: guess.emoji } } : {}),
    };
  }

  return {
    key: draftKey(),
    rawText: line.rawText,
    name: food.name,
    foodTypeId: food.id,
    emoji: food.emoji,
    locationId: food.defaultLocation,
    quantity,
    unit,
    price: line.price,
    printedDate: line.printedDate,
    dateKind: food.dateKind,
    include: true,
    confidence: match?.confidence ?? "high",
    isFood: true,
  };
}

/** Words that say nothing about which food it is, so they can't carry a "Did you mean" on their own. */
const GENERIC_WORDS = new Set(["fresh", "frozen", "piece", "pieces", "root", "whole", "sliced", "diced", "loose", "large", "small", "bag", "pack", "organic", "free", "range", "baby", "mini", "red", "green", "white", "brown"]);

/** Edit distance with an early exit, for short words. */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Only suggest a weak match when one of the shopper's words is a near-spelling of a telling word in
 * the food's name ("gnger" → ginger), not when the overlap is a generic word like "pieces".
 */
function looksLike(text: string, food: FoodType): boolean {
  const words = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w));
  const theirs = words(text);
  const ours = [food.name, ...food.aliases].flatMap(words);
  return theirs.some((w) => ours.some((o) => o === w || o.startsWith(w) || editDistance(w, o) <= (o.length >= 6 ? 2 : 1)));
}

/** Match on the cleaned name, falling back to the raw line when the name matches nothing or only weakly. */
function bestMatch(name: string, rawText?: string) {
  const byName = matchFoodType(name);
  if (byName && byName.confidence !== "low") return byName;
  const byRaw = rawText && rawText !== name ? matchFoodType(rawText) : undefined;
  if (byRaw && (!byName || byRaw.score > byName.score)) return byRaw;
  return byName;
}

/** Draft for a food picked by hand from search. */
export function foodToDraft(food: FoodType): ReviewDraft {
  return {
    key: draftKey(),
    name: food.name,
    foodTypeId: food.id,
    emoji: food.emoji,
    locationId: food.defaultLocation,
    quantity: food.defaultQuantity,
    unit: food.defaultUnit,
    dateKind: food.dateKind,
    include: true,
    confidence: "high",
    isFood: true,
  };
}

/** Draft for free text that matched nothing (or the user chose to keep as typed). */
export function freeTextDraft(name: string): ReviewDraft {
  const parsed = parseLine(name);
  const line: ParsedLine = parsed ?? { name };
  const draft = lineToDraft({ ...line, isFood: true });
  return { ...draft, rawText: undefined, include: true };
}

/** Re-point a draft at a different food type (from the "change" picker). */
export function applyFoodType(draft: ReviewDraft, foodTypeId: string): ReviewDraft {
  const food = getFoodType(foodTypeId);
  if (!food) return draft;
  const keepAmount = draft.unit === food.defaultUnit || (sameDimension(draft.unit, food.defaultUnit) && draft.unit !== "item");
  return {
    ...draft,
    name: food.name,
    foodTypeId: food.id,
    emoji: food.emoji,
    locationId: food.defaultLocation,
    dateKind: food.dateKind,
    quantity: keepAmount ? draft.quantity : food.defaultQuantity,
    unit: keepAmount ? draft.unit : food.defaultUnit,
    confidence: "high",
    isFood: true,
    include: true,
    suggestion: undefined,
    mergeIntoId: undefined,
  };
}

/* ---------- Smart defaults and duplicates ---------- */

/**
 * Use where and how much this food went last time ("added" events record both), so a manual add
 * or "Add again" lands in the usual spot. `locationIds` are the household's current spots.
 */
export function withLastAdded(draft: ReviewDraft, events: ItemEvent[], locationIds: LocationId[]): ReviewDraft {
  const key = draft.foodTypeId ?? draft.name.toLowerCase();
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== "added") continue;
    if ((e.foodTypeId ?? e.itemName.toLowerCase()) !== key) continue;
    const next = { ...draft };
    if (e.locationId && locationIds.includes(e.locationId)) next.locationId = e.locationId;
    if (e.quantity && e.quantity > 0 && e.unit) {
      next.quantity = e.quantity;
      next.unit = e.unit;
    }
    return next;
  }
  return draft;
}

/**
 * An unopened larder item this draft could top up: same food, same spot, same printed date,
 * never opened or thawed, and an amount we can add to.
 */
export function findMergeTarget(
  draft: Pick<ReviewDraft, "foodTypeId" | "locationId" | "printedDate" | "unit">,
  items: PantryItem[],
): PantryItem | undefined {
  if (!draft.foodTypeId) return undefined;
  return items.find(
    (i) =>
      i.foodTypeId === draft.foodTypeId &&
      i.locationId === draft.locationId &&
      !i.openedAt &&
      !i.thawedAt &&
      !i.expiredWhenFrozen &&
      (i.printedDate ?? "") === (draft.printedDate ?? "") &&
      compatibleUnits(draft.unit, i.unit),
  );
}

/* ---------- Local text parser ---------- */

/** Lines in an order confirmation that carry no product. */
const EMAIL_NOISE: RegExp[] = [
  /^(hi|hello|dear|thanks|thank you|cheers|regards|kind regards)\b/,
  /^(order|invoice|receipt|tax invoice|reference|ref)\b.*(number|no\.?|#|:)/,
  /^order (summary|details|confirmation|confirmed|total)/,
  /^your (order|delivery|pick ?up|items|receipt|shopping|trolley)/,
  /\b(delivery|pick ?up|collection) (window|time|date|address|details|instructions)\b/,
  /^(delivery|delivered|deliver|pick ?up|collect) (to|on|by|at|from|between)\b/,
  /^(estimated|scheduled)\b/,
  /\b(unsubscribe|privacy|terms (and|&) conditions|view (in|this) (browser|online)|contact us|help centre|customer service|faq)\b/,
  /\b(everyday rewards|flybuys|points earned|member price|you saved|total savings)\b/,
  /^(sub ?total|total|gst|delivery fee|service fee|bag fee|packaging fee|discount|promo|voucher|amount paid|paid with|payment|card ending)\b/,
  /\b(abn|acn)\b\s*[\d ]{6,}/,
  /^(qty|quantity|price|item|items|product|description|unit price|amount)\s*$/,
  /^(substitut(ed|ions?)|unavailable items?|out of stock items?|items? you ordered|items? we couldn'?t)\s*:?\s*$/,
  /^(woolworths|coles|aldi|iga|harris farm)(\s+(online|supermarkets?|group|ltd|limited|pty|order|delivery))*\s*$/,
  /^(questions\?|need help\?|manage (your )?order|track (your )?order|download (the )?app|shop now|view order)/,
  /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+\d/,
  /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/,
  /^(from|to|sent|date|subject|cc|bcc):/,
  /^-{2,}|^_{2,}|^={2,}|^\*{3,}/,
  /^(page \d+|\d+ of \d+)$/,
  /https?:\/\/|www\./,
  /@[a-z0-9-]+\.[a-z]/,
  /^\d+\s+[a-z ]+(street|st|road|rd|avenue|ave|drive|dr|court|ct|place|pl|lane|ln|crescent|cres|parade|pde|way|close|terrace|tce)\b/,
  /\b(nsw|vic|qld|wa|sa|tas|act|nt)\s+\d{4}\b/,
];

/** Lines that only add detail to the product line above them. */
const QTY_ONLY = /^(?:qty|quantity|x)\s*[:x]?\s*(\d+(?:\.\d+)?)\s*$/i;
/** "$6.20", "2 x $3.10 $6.20", "2 x $13.00 / $26.00", "2 for $10", "$3.90/kg". */
const PRICE_ONLY =
  /^(?:(?:\d+\s*(?:x|×|@|for)\s*)?\$\s?\d+(?:\.\d{1,2})?(?:\s*(?:ea|each|\/\s*(?:kg|ea)))?\s*(?:[/=]\s*)?)+$/i;
/** "Unavailable", "Item unavailable: Raspberries 125g", "Out of stock - Lite milk". */
const UNAVAILABLE =
  /^(?:item\s+|product\s+)?(?:unavailable|out of stock|not available|refunded|removed|cancelled|no longer available)\b\s*(?:[:\-–—]\s*(.*))?$/i;
/** "Raspberries 125g - unavailable", "Lite milk (out of stock)". */
const UNAVAILABLE_SUFFIX = /[\s\-–—(:]+(?:unavailable|out of stock|not available|refunded)\)?\s*$/i;
/** Section headings that list missing items: everything under them until the next heading is skipped. */
const UNAVAILABLE_HEADING =
  /^(?:unavailable|out of stock|missing|refunded|not supplied)(?:\s+(?:items?|products?)\s*:?|\s*:)\s*$|^items? (?:we couldn'?t|not) (?:supply|supplied|available)\b.*$/i;
/** Headings that start an ordinary section again. */
const SECTION_HEADING =
  /^(?:your (?:items|order)|items? (?:delivered|ordered|picked|supplied|in (?:your|this) order)|delivered items?|order (?:summary|details)|substitut(?:ed|ions?)(?:\s+items?)?|sub ?total|total)\b.*$/i;

const BULLET = /^\s*(?:[-*•·▪◦‣⁃–—>]+|\[\s?[x✓ ]?\s?\]|☐|☑|✓|✔|\d{1,3}[.)])\s+/i;

/** Matches "500g", "1.5 kg", "2L", "6pk", "330 ml", "12 pack". */
const SIZE_RE = /(\d+(?:\.\d+)?)\s*(kg|kgs|g|gm|gms|grams?|ml|mls|l|lt|ltr|litres?|liters?|pk|pkt|packs?|packets?|doz|dozen)\b/i;
/** Matches "6 x 330ml" multi-packs. */
const MULTIPACK_RE = /(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|l|lt)\b/i;
const PRICE_RE = /(?:^|\s)\$\s?(\d+(?:\.\d{1,2})?)(?:\s*(?:ea|each))?\s*$/i;
const TRAILING_PRICE_RE = /\s+(\d+\.\d{2})\s*$/;
const COUNT_PREFIX = /^(\d+(?:\.\d+)?)\s*(?:x|×|\*)\s*(?=\S)/i; // "2x milk", "2 x milk"
const COUNT_SUFFIX = /\s*(?:x|×|\*)\s*(\d+)\s*$/i; // "milk x2"
const COUNT_WORD_PREFIX = /^(\d+)\s+(?=[a-z])/i; // "3 apples"
/** Multi-buy fragment left after the line total: "2 x $13.00", "2 @ $13.00 ea /". */
const MULTIBUY_RE = /\s*(\d+)\s*(?:x|×|@|for)\s*\$\s?\d+(?:\.\d{1,2})?(?:\s*(?:ea|each))?\s*[/=]?\s*$/i;
const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  dozen: 12,
  "a dozen": 12,
  "half a dozen": 6,
};

/** Parse one typed list line, e.g. "2 x milk 2L", "500g mince", "bananas x6". Returns null for empty lines. */
export function parseLine(input: string): ParsedLine | null {
  let text = input.replace(BULLET, "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const rawText = input.trim();

  let price: number | undefined;
  const pm = text.match(PRICE_RE);
  if (pm) {
    price = Number(pm[1]);
    text = text.slice(0, pm.index).trim();
  } else {
    // Receipt style: "BANANAS 1.20" (only when there are other words)
    const tm = text.match(TRAILING_PRICE_RE);
    if (tm && /[a-z]{3,}/i.test(text.slice(0, tm.index))) {
      price = Number(tm[1]);
      text = text.slice(0, tm.index).trim();
    }
  }
  let count: number | undefined;
  let size: ParsedLine["size"];

  // Multi-buy: "Beef mince 1kg 2 x $13.00 / $26.00" → count 2, line total 26.
  text = text.replace(/\s*[/=]\s*$/, "");
  const mb = text.match(MULTIBUY_RE);
  if (mb && /[a-z]{2,}/i.test(text.slice(0, mb.index))) {
    count = Number(mb[1]);
    text = text.slice(0, mb.index).trim();
  }
  // Strip "@ $2.00 each"/"@ 2.00" unit-price fragments.
  text = text.replace(/\s*@\s*\$?\d+(?:\.\d+)?(?:\s*(?:ea|each|\/\s*kg))?/i, "").trim();

  const cp = count === undefined ? text.match(COUNT_PREFIX) : null;
  if (cp) {
    count = Number(cp[1]);
    text = text.slice(cp[0].length).trim();
  } else if (count === undefined) {
    const cs = text.match(COUNT_SUFFIX);
    if (cs) {
      count = Number(cs[1]);
      text = text.slice(0, cs.index).trim();
    }
  }

  const mp = text.match(MULTIPACK_RE);
  if (mp) {
    const unit = normaliseUnit(mp[3]);
    if (unit) {
      const packs = Number(mp[1]);
      size = { quantity: round(packs * Number(mp[2])), unit };
      text = (text.slice(0, mp.index) + " " + text.slice((mp.index ?? 0) + mp[0].length)).trim();
    }
  }
  if (!size) {
    const sm = text.match(SIZE_RE);
    if (sm) {
      const unit = normaliseUnit(sm[2]);
      const n = Number(sm[1]);
      // "12pk" / "6 pack" (singular) says how many are in the pack; "2 packs" is a count of packs.
      const packOf = unit === "pack" && n >= 2 && !/s$/i.test(sm[2]);
      if (packOf) {
        size = { quantity: n, unit: "item" };
        text = (text.slice(0, sm.index) + " " + text.slice((sm.index ?? 0) + sm[0].length)).trim();
      } else if (unit) {
        size = { quantity: n, unit };
        text = (text.slice(0, sm.index) + " " + text.slice((sm.index ?? 0) + sm[0].length)).trim();
      }
    }
  }

  if (count === undefined) {
    const lower = text.toLowerCase();
    const word = Object.keys(WORD_NUMBERS)
      .sort((a, b) => b.length - a.length)
      .find((w) => lower.startsWith(`${w} `));
    if (word && word !== "a" && word !== "an") {
      // "a dozen eggs" / "half a dozen eggs" are amounts in items, not a count of dozens.
      if (word.includes("dozen")) {
        if (!size) size = { quantity: WORD_NUMBERS[word], unit: "item" };
      } else count = WORD_NUMBERS[word];
      text = text.slice(word.length).trim();
    } else {
      const cw = text.match(COUNT_WORD_PREFIX);
      if (cw) {
        count = Number(cw[1]);
        text = text.slice(cw[0].length).trim();
      }
    }
  }

  // "a dozen eggs" style: dozen as a unit
  text = text.replace(/^(?:of|x)\s+/i, "").replace(/\s*[-–,:]\s*$/, "").replace(/\s{2,}/g, " ").trim();
  if (!text) return null;
  if (!/[a-z]/i.test(text)) return null;

  return { rawText, name: text, count, size, price };
}

function normaliseName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function looksLikeOrderEmail(text: string): boolean {
  const t = text.toLowerCase();
  const signals = [
    /\border (number|no\.?|#|confirmation|summary|details)/,
    /\b(woolworths|coles|aldi|iga|harris farm|amazon fresh)\b/,
    /\b(delivery|pick ?up|click (&|and) collect) (window|fee|time|date|address)/,
    /\b(sub ?total|total \(incl|gst)\b/,
    /\b(qty|quantity)\s*[:x]?\s*\d/,
    /\bthanks? (you )?for (shopping|your order)/,
    /\b(everyday rewards|flybuys)\b/,
    /\bsubstitut/,
  ];
  return signals.filter((r) => r.test(t)).length >= 2;
}

export interface LocalParseResult {
  lines: ParsedLine[];
  /** Lines that were skipped as boilerplate. */
  skipped: number;
  orderEmail: boolean;
}

/**
 * Fast, offline parser for a typed list or a pasted supermarket order email.
 * Splits lines (and commas in short lists), strips bullets, reads "2x", "500g", "1kg",
 * attaches stand-alone "Qty: 2" / "$4.50" lines to the product above, and drops email boilerplate.
 */
export function parseLocalList(text: string): LocalParseResult {
  const orderEmail = looksLikeOrderEmail(text);
  let rawLines = text.split(/\r?\n/);

  // A one-line, comma-separated list: "milk, eggs, bread".
  if (!orderEmail && rawLines.filter((l) => l.trim()).length <= 2 && text.includes(",")) {
    rawLines = text.split(/[,;\n]/);
  }

  const lines: ParsedLine[] = [];
  let skipped = 0;
  let last: ParsedLine | undefined;
  /** Inside an "Unavailable items:" section: product lines there were not delivered. */
  let inUnavailable = false;

  /** Drop the already-read line that names this unavailable product (most recent first). */
  const dropNamed = (named: string): boolean => {
    const target = parseLine(named);
    if (!target) return false;
    const key = normaliseName(target.name);
    if (!key) return false;
    for (let i = lines.length - 1; i >= 0; i--) {
      const n = normaliseName(lines[i].name);
      if (n === key || n.includes(key) || key.includes(n)) {
        lines.splice(i, 1);
        last = lines[lines.length - 1];
        return true;
      }
    }
    return false;
  };

  for (const raw of rawLines) {
    const trimmed = raw.replace(/ /g, " ").trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();

    if (UNAVAILABLE_HEADING.test(trimmed)) {
      inUnavailable = true;
      last = undefined;
      skipped++;
      continue;
    }
    if (inUnavailable) {
      if (SECTION_HEADING.test(trimmed)) {
        inUnavailable = false;
        skipped++;
        continue;
      } else {
        // A product listed as unavailable: if it was also listed above, take it back off.
        if (!QTY_ONLY.test(trimmed) && !PRICE_ONLY.test(trimmed)) dropNamed(trimmed);
        skipped++;
        continue;
      }
    }

    // Detail lines that belong to the product above.
    const q = trimmed.match(QTY_ONLY);
    if (q && last) {
      last.count = Number(q[1]);
      continue;
    }
    if (PRICE_ONLY.test(trimmed)) {
      if (last && last.price === undefined) {
        const prices = [...trimmed.matchAll(/\$\s?(\d+(?:\.\d{1,2})?)/g)].map((m) => Number(m[1]));
        const countMatch = trimmed.match(/^(\d+)\s*(?:x|×|@|for)/i);
        if (countMatch && last.count === undefined) last.count = Number(countMatch[1]);
        // The last figure on a "2 x $3.00 $6.00" line is the line total.
        last.price = prices[prices.length - 1];
      }
      continue;
    }
    const un = trimmed.match(UNAVAILABLE);
    if (un) {
      const named = un[1]?.trim();
      if (named) {
        // "Item unavailable: Raspberries 125g" names its product: drop only that one, if it was listed.
        dropNamed(named);
      } else if (last) {
        // A bare "Unavailable" under a product line refers to the product just above.
        lines.splice(lines.lastIndexOf(last), 1);
        last = undefined;
      }
      skipped++;
      continue;
    }
    if (UNAVAILABLE_SUFFIX.test(trimmed)) {
      skipped++;
      last = undefined;
      continue;
    }
    const sub = trimmed.match(/^(?:substituted|replaced)\s+(?:with|by|for)\s*:?\s*(.+)$/i);
    if (sub) {
      const parsed = parseLine(sub[1]);
      if (parsed) {
        if (last) lines.pop();
        lines.push(parsed);
        last = parsed;
      }
      continue;
    }

    if (EMAIL_NOISE.some((r) => r.test(lower))) {
      skipped++;
      continue;
    }
    // Long prose lines in an email are not products.
    if (orderEmail && (trimmed.length > 90 || /[.!?]$/.test(trimmed) && trimmed.split(" ").length > 6)) {
      skipped++;
      continue;
    }

    const parsed = parseLine(trimmed);
    if (!parsed) {
      skipped++;
      continue;
    }
    if (isLikelyNonFood(parsed.name)) parsed.isFood = false;
    lines.push(parsed);
    last = parsed;
  }

  return { lines, skipped, orderEmail };
}

/** How well the local parse went: share of food lines that matched a known food. */
export function matchRate(drafts: Pick<ReviewDraft, "foodTypeId" | "isFood">[]): number {
  const food = drafts.filter((d) => d.isFood);
  if (food.length === 0) return 0;
  return food.filter((d) => d.foodTypeId).length / food.length;
}

/* ---------- API shapes shared by the add routes and the add flow ---------- */

export interface ParseResponse {
  drafts: ReviewDraft[];
  /** How the lines were read. */
  method: "ai" | "local";
  storeName?: string | null;
  date?: string | null;
  /** True when the text looked like a supermarket order confirmation. */
  orderEmail?: boolean;
  /** Set when AI was wanted but unavailable, so the result is the local parse. */
  note?: string;
}

export interface ApiError {
  error: string;
  message: string;
}

export interface BarcodeResponse {
  found: boolean;
  code: string;
  name?: string;
  brand?: string;
  quantity?: string;
  image?: string;
  draft?: ReviewDraft;
}

/* ---------- Open Food Facts product → draft ---------- */

export interface OffProduct {
  product_name?: string;
  brands?: string;
  quantity?: string;
  categories_tags?: string[];
  image_front_small_url?: string;
}

/** "en:dairies" → "dairies"; most specific category first (OFF lists them general → specific). */
function categoryWords(tags: string[] = []): string[] {
  return tags
    .filter((t) => t.startsWith("en:"))
    .map((t) => t.slice(3).replace(/-/g, " "))
    .reverse();
}

/** Map an Open Food Facts product to a review line: match on the name first, then the categories. */
export function offProductToResponse(code: string, p: OffProduct): BarcodeResponse {
  const name = (p.product_name ?? "").trim();
  const brand = p.brands?.split(",")[0]?.trim() || undefined;
  const size = p.quantity ? parseLine(`item ${p.quantity}`)?.size : undefined;

  const trusted = (t: string) => {
    const m = matchFoodType(t);
    return !!m && m.confidence !== "low";
  };
  let matchText = name;
  if (!trusted(name)) {
    const cat = categoryWords(p.categories_tags).find(trusted);
    if (cat) matchText = cat;
  }
  const draft = lineToDraft({
    rawText: [brand, name, p.quantity].filter(Boolean).join(" · "),
    name: matchText,
    size,
    isFood: true,
  });
  if (!draft.foodTypeId) draft.name = tidyName(name);

  return { found: true, code, name, brand, quantity: p.quantity, image: p.image_front_small_url, draft };
}
