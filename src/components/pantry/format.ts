import type { ItemView } from "@/lib/selectors";
import { daysBetween } from "@/lib/shelf-life/engine";
import type { ItemEvent, Unit } from "@/lib/types";

const FRACTIONS: Record<string, string> = { "0.25": "¼", "0.5": "½", "0.75": "¾", "0.33": "⅓", "0.67": "⅔" };

/** 0.5 → "½", 1.5 → "1½", 0.333 → "0.33", 250 → "250". */
export function formatAmount(q: number): string {
  const whole = Math.floor(q);
  const frac = Math.round((q - whole) * 100) / 100;
  if (frac === 0) return String(whole);
  const glyph = FRACTIONS[String(frac)];
  if (glyph) return whole > 0 ? `${whole}${glyph}` : glyph;
  return String(Math.round(q * 100) / 100);
}

const PLURAL: Partial<Record<Unit, string>> = {
  pack: "packs",
  bunch: "bunches",
  loaf: "loaves",
  tin: "tins",
  jar: "jars",
  bottle: "bottles",
  dozen: "dozen",
};

/** "×2", "500 g", "1 L", "2 tins", "½ loaf". */
export function formatQuantity(q: number, unit: Unit): string {
  const amount = formatAmount(q);
  if (unit === "item") return `×${amount}`;
  if (unit === "g" || unit === "kg" || unit === "ml" || unit === "L") return `${amount} ${unit}`;
  const word = q > 1 ? (PLURAL[unit] ?? unit) : unit;
  return `${amount} ${word}`;
}

/** Share of the starting quantity still left (0-1), or undefined when it is all there. */
export function shareLeft(quantity: number, initialQuantity: number): number | undefined {
  if (!initialQuantity || quantity >= initialQuantity) return undefined;
  return Math.max(0, quantity / initialQuantity);
}

/** "60% left" when partly used. */
export function describeShareLeft(quantity: number, initialQuantity: number): string | undefined {
  const s = shareLeft(quantity, initialQuantity);
  return s === undefined ? undefined : `${Math.max(1, Math.round(s * 100))}% left`;
}

/** When the item's current clock started: frozen, thawed, opened or added. */
export function clockStart(view: ItemView): Date {
  const { item, location } = view;
  if (location?.kind === "freezer") return new Date(item.frozenAt ?? item.addedAt);
  if (item.thawedAt) return new Date(item.thawedAt);
  if (item.openedAt) return new Date(item.openedAt);
  return new Date(item.addedAt);
}

/** Fraction of shelf life remaining, for FreshnessBar (1 = just bought). */
export function freshnessFraction(view: ItemView): number {
  const { expiry } = view;
  if (expiry.daysLeft < 0) return 0;
  const total = Math.max(1, daysBetween(clockStart(view), expiry.expiresOn));
  return Math.max(0, Math.min(1, expiry.daysLeft / total));
}

const aud = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
export function formatAUD(n: number): string {
  return aud.format(n);
}

/** "Sat 1 Nov" */
export function formatShortDate(d: Date): string {
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
}

export interface WasteTotals {
  used: number;
  binned: number;
  usedValue: number;
  binnedValue: number;
  /** True when at least one binned event has a known value. */
  binnedPriced: boolean;
  usedPriced: boolean;
}

export function wasteTotals(events: ItemEvent[], since?: Date): WasteTotals {
  const t: WasteTotals = { used: 0, binned: 0, usedValue: 0, binnedValue: 0, binnedPriced: false, usedPriced: false };
  for (const e of events) {
    if (since && new Date(e.at) < since) continue;
    if (e.type === "used") {
      t.used++;
      if (e.value !== undefined) {
        t.usedValue += e.value;
        t.usedPriced = true;
      }
    } else if (e.type === "binned") {
      t.binned++;
      if (e.value !== undefined) {
        t.binnedValue += e.value;
        t.binnedPriced = true;
      }
    }
  }
  return t;
}

export function startOfMonth(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
