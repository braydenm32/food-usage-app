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
  "btl", "ctn", "ltr", "litre", "litres",
]);

/**
 * Sugar claims on a label. "No added sugar" says nothing about which food it is, so it goes;
 * "no sugar" / "sugar free" marks a diet product, so it becomes "zero" ("Coke No Sugar" → "coke zero").
 * Without this, the word "sugar" pulls these lines towards the sugar food.
 */
const SUGAR_CLAIMS: [RegExp, string][] = [
  [/\b(?:no|less|low|reduced|lite)\s+added\s+sugars?\b|\bno\s+sugars?\s+added\b|\b(?:less|low|reduced|lite)\s+sugars?\b/g, " "],
  [/\b(?:no|zero)\s+sugars?\b|\bsugar\s*-?\s*free\b|\b0\s*sugar\b/g, " zero "],
];

export function normalise(text: string): string {
  let t = text.toLowerCase();
  for (const [re, sub] of SUGAR_CLAIMS) t = t.replace(re, sub);
  return t
    .replace(/[0-9]+(\.[0-9]+)?\s*(kg|g|gms?|ml|l|lt|ltr|litres?|pk|pack|x)\b/g, " ")
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

function termWords(text: string): string[] {
  return normalise(text).split(" ").filter(Boolean).map(singular);
}

/** The form a name or alias takes inside the matcher. Two foods sharing a key would compete for the same text. */
export function termKey(text: string): string {
  return termWords(text).join(" ");
}

interface Indexed {
  food: FoodType;
  terms: string[][]; // each alias as singular words
}

const INDEX: Indexed[] = FOOD_TYPES.map((food) => ({
  food,
  terms: [food.name, ...food.aliases].map(termWords),
}));

export interface FoodMatch {
  food: FoodType;
  score: number;
  confidence: "high" | "medium" | "low";
}

/** Cooked food and leftovers: what "cooked …", "leftover …" and "homemade …" lines can match. */
const COOKED_ID = /^(?:cooked-|leftovers-)|-cooked(?:-|$)|^eggs-boiled$|^ready-mash$|^slow-cooked-meat$/;
const COOKED_INDEX = INDEX.filter((x) => COOKED_ID.test(x.food.id));
const LEFTOVERS_ID = "leftovers-meal";
const COOKED_PREFIX = /^\s*(?:cooked|left ?overs?|last night'?s)\b/i;
const HOMEMADE_PREFIX = /^\s*(?:home ?made|home ?cooked)\b/i;

/**
 * Best-effort match from free text ("WW BABY SPINACH 120G", "milk", "2x tins tomatoes")
 * to a food type. Returns undefined when nothing plausible matches.
 *
 * Lines that start "cooked", "leftover" or "homemade" are cooked food: they only match the cooked
 * and leftover types (cooked lentils are not two-year dried lentils), falling back to leftovers.
 */
export function matchFoodType(text: string): FoodMatch | undefined {
  const best = bestMatch(termWords(text), INDEX);
  if (COOKED_PREFIX.test(text)) {
    // An exact name ("cooked mussels pack") still wins; otherwise only cooked types.
    if (best && best.score >= 100) return best;
    return bestMatch(termWords(text), COOKED_INDEX) ?? leftovers();
  }
  if (HOMEMADE_PREFIX.test(text)) {
    // Homemade bread is still bread; homemade soup or pesto keeps like leftovers, not like a tin or jar.
    const f = best?.food;
    if (!f || (f.pantryDays ?? 0) >= 60 || f.category === "meat" || f.category === "seafood") {
      return bestMatch(termWords(text), COOKED_INDEX) ?? leftovers();
    }
  }
  return best;
}

function leftovers(): FoodMatch | undefined {
  const food = BY_ID.get(LEFTOVERS_ID);
  return food ? { food, score: 60, confidence: "medium" } : undefined;
}

function bestMatch(words: string[], index: Indexed[]): FoodMatch | undefined {
  if (words.length === 0) return undefined;
  const joined = words.join(" ");
  let best: FoodMatch | undefined;

  for (const { food, terms } of index) {
    for (const term of terms) {
      if (term.length === 0) continue;
      const t = term.join(" ");
      let score = 0;
      if (t === joined) score = 100;
      else if (` ${joined} `.includes(` ${t} `)) score = 70 + term.length * 5; // whole alias inside text
      else {
        // Partial: share of alias words found, with prefix matching for receipt abbreviations
        // ("SPIN" for spinach). Three letters is too loose: "LOL" would read as lollies.
        const hits = term.filter((tw) => words.some((w) => w === tw || (w.length >= 4 && tw.startsWith(w)))).length;
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
