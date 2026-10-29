import type { FoodType } from "@/lib/types";
import { FOOD_TYPES } from "./foods-data";

export { FOOD_TYPES };

const BY_ID = new Map(FOOD_TYPES.map((f) => [f.id, f]));

export function getFoodType(id: string | null | undefined): FoodType | undefined {
  return id ? BY_ID.get(id) : undefined;
}

/** Words that say nothing about what the food is. */
const NOISE = new Set([
  "ww", "woolworths", "coles", "aldi", "iga", "essentials", "homebrand", "macro", "organic", "fresh", "free", "range",
  "australian", "aus", "pk", "pack", "pkt", "ea", "each", "kg", "g", "ml", "l", "lt", "x", "the", "of", "and", "with",
  "brand", "select", "finest", "own", "prepack", "loose", "per", "large", "small", "medium", "lge", "sml", "med",
]);

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0-9]+(\.[0-9]+)?\s*(kg|g|ml|l|lt|pk|pack|x)\b/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !NOISE.has(w))
    .join(" ")
    .trim();
}

function singular(w: string): string {
  if (w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.endsWith("oes")) return w.slice(0, -2);
  if (w.endsWith("es") && /(ch|sh|x|s)es$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

interface Indexed {
  food: FoodType;
  terms: string[][]; // each alias as singular words
}

const INDEX: Indexed[] = FOOD_TYPES.map((food) => ({
  food,
  terms: [food.name, ...food.aliases].map((t) => normalise(t).split(" ").filter(Boolean).map(singular)),
}));

export interface FoodMatch {
  food: FoodType;
  score: number;
  confidence: "high" | "medium" | "low";
}

/**
 * Best-effort match from free text ("WW BABY SPINACH 120G", "milk", "2x tins tomatoes")
 * to a food type. Returns undefined when nothing plausible matches.
 */
export function matchFoodType(text: string): FoodMatch | undefined {
  const words = normalise(text).split(" ").filter(Boolean).map(singular);
  if (words.length === 0) return undefined;
  const joined = words.join(" ");
  let best: FoodMatch | undefined;

  for (const { food, terms } of INDEX) {
    for (const term of terms) {
      if (term.length === 0) continue;
      const t = term.join(" ");
      let score = 0;
      if (t === joined) score = 100;
      else if (` ${joined} `.includes(` ${t} `)) score = 70 + term.length * 5; // whole alias inside text
      else {
        // Partial: share of alias words found, with prefix matching for receipt abbreviations.
        const hits = term.filter((tw) => words.some((w) => w === tw || (w.length >= 3 && tw.startsWith(w)))).length;
        if (hits === 0) continue;
        score = (hits / term.length) * 50 + hits * 4 - Math.max(0, words.length - hits) * 2;
      }
      if (!best || score > best.score) {
        best = { food, score, confidence: score >= 80 ? "high" : score >= 45 ? "medium" : "low" };
      }
    }
  }
  return best && best.score >= 25 ? best : undefined;
}

export function searchFoodTypes(query: string, limit = 8): FoodType[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored = FOOD_TYPES.map((f) => {
    const name = f.name.toLowerCase();
    let s = 0;
    if (name === q) s = 100;
    else if (f.aliases.includes(q)) s = 90; // "milk" → full cream milk, not milk powder
    else if (name.startsWith(q)) s = 80;
    else if (name.split(" ").some((w) => w.startsWith(q))) s = 60;
    else if (f.aliases.some((a) => a.startsWith(q))) s = 50;
    else if (name.includes(q) || f.aliases.some((a) => a.includes(q))) s = 30;
    return { f, s };
  }).filter((x) => x.s > 0);
  scored.sort((a, b) => b.s - a.s || Number(!!b.f.staple) - Number(!!a.f.staple) || a.f.name.length - b.f.name.length);
  return scored.slice(0, limit).map((x) => x.f);
}
