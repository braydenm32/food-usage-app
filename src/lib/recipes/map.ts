import type { Recipe, RecipeIngredient } from "@/lib/types";
import { matchFoodType } from "@/lib/shelf-life/foods";

export function foodTypeIdFor(name: string): string | null {
  const m = matchFoodType(name);
  return m && m.score >= 45 ? m.food.id : null;
}

const UNIT_WORDS: Record<string, string> = {
  g: "g", gram: "g", grams: "g", kg: "kg", ml: "ml", l: "L", litre: "L", litres: "L",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp", tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  cup: "cup", cups: "cup", clove: "clove", cloves: "clove", can: "tin", tin: "tin", tins: "tin",
  slice: "slice", slices: "slice", pinch: "pinch", bunch: "bunch",
};

const FRACTIONS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3 };

function parseNumber(token: string): number | undefined {
  let t = token;
  let extra = 0;
  for (const [ch, v] of Object.entries(FRACTIONS)) {
    if (t.includes(ch)) {
      extra += v;
      t = t.replace(ch, "");
    }
  }
  if (t.includes("/")) {
    const [a, b] = t.split("/").map(Number);
    if (b) return (a || 0) / b + extra;
    return undefined;
  }
  if (t === "") return extra || undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n + extra : undefined;
}

/** Loose parse of strings like "1 1/2 cups", "200g", "2 tbsp", "Pinch of", "to taste". */
export function parseMeasure(measure: string): { quantity?: number; unit?: string } {
  const m = measure.trim().toLowerCase();
  if (!m) return {};
  const parts = m.split(/\s+/);
  let quantity: number | undefined;
  let i = 0;
  // numbers may be split: "1 1/2"
  const first = parts[0].match(/^([0-9./½¼¾⅓⅔]+)([a-z]*)$/);
  if (first) {
    quantity = parseNumber(first[1]);
    i = 1;
    if (first[2] && UNIT_WORDS[first[2]]) return { quantity, unit: UNIT_WORDS[first[2]] };
    if (parts[1] && /^[0-9/]+$/.test(parts[1]) && parts[1].includes("/")) {
      quantity = (quantity ?? 0) + (parseNumber(parts[1]) ?? 0);
      i = 2;
    }
  } else if (UNIT_WORDS[parts[0]]) {
    return { quantity: 1, unit: UNIT_WORDS[parts[0]] };
  }
  const unit = parts[i] ? UNIT_WORDS[parts[i].replace(/[.,]/g, "")] : undefined;
  return { quantity, unit };
}

/* ---------- Australian kitchen words ---------- */

/** US and UK cooking words, and what an Australian cook calls them. */
const AU_TERMS: Array<[RegExp, string]> = [
  [/\ball[- ]purpose flour\b/gi, "plain flour"],
  [/\bself[- ]rising flour\b/gi, "self-raising flour"],
  [/\b(?:white )?granulated sugar\b/gi, "white sugar"],
  [/\bsuperfine sugar\b/gi, "caster sugar"],
  [/\b(?:powdered|confectioners'?) sugar\b/gi, "icing sugar"],
  [/\bcilantro\b/gi, "coriander"],
  [/\bscallions?\b/gi, "spring onion"],
  [/\bgreen onions?\b/gi, "spring onion"],
  [/\b(?:bell|sweet) peppers\b/gi, "capsicums"],
  [/\b(?:bell|sweet) pepper\b/gi, "capsicum"],
  [/\bcourgettes?\b/gi, "zucchini"],
  [/\baubergines?\b/gi, "eggplant"],
  [/\barugula\b/gi, "rocket"],
  [/\bgarbanzo beans?\b/gi, "chickpeas"],
  [/\bheavy (?:whipping )?cream\b/gi, "thickened cream"],
  [/\bdouble cream\b/gi, "thickened cream"],
  [/\bground beef\b/gi, "beef mince"],
  [/\bground pork\b/gi, "pork mince"],
  [/\bminced beef\b/gi, "beef mince"],
  [/\bbaking soda\b/gi, "bicarb soda"],
  [/\bcornstarch\b/gi, "cornflour"],
  [/\bshrimps?\b/gi, "prawns"],
  [/\bskillet\b/gi, "frying pan"],
  [/\bbroil(?:er)?\b/gi, "grill"],
  [/\bplastic wrap\b/gi, "cling wrap"],
  [/\bparchment paper\b/gi, "baking paper"],
  [/\bstove ?top\b/gi, "stovetop"],
];

const INCH_NUM = String.raw`(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|[½¼¾])`;
const INCH_RE = new RegExp(`${INCH_NUM}(?:\\s*(?:-|–|to)\\s*${INCH_NUM})?\\s*(?:-?\\s*inch(?:es)?\\b|in\\.|″|")`, "gi");

function inchNumber(t: string): number {
  const f: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75 };
  if (f[t]) return f[t];
  const parts = t.trim().split(/\s+/);
  return parts.reduce((sum, p) => {
    if (p.includes("/")) {
      const [a, b] = p.split("/").map(Number);
      return sum + (b ? a / b : 0);
    }
    return sum + Number(p);
  }, 0);
}

const cm = (inches: number) => {
  const v = inches * 2.54;
  return v < 1 ? "0.5" : String(Math.round(v));
};

/** "½ inch slices" -> "1 cm slices"; "all-purpose flour" -> "plain flour". */
export function localiseText(text: string): string {
  let t = text.replace(INCH_RE, (_, a: string, b?: string) => (b ? `${cm(inchNumber(a))}–${cm(inchNumber(b))} cm` : `${cm(inchNumber(a))} cm`));
  for (const [re, au] of AU_TERMS) t = t.replace(re, au);
  return t;
}

export function ingredient(name: string, measure?: string): RecipeIngredient {
  const clean = localiseText(name.trim());
  const { quantity, unit } = measure ? parseMeasure(measure) : {};
  return { name: clean, quantity, unit, foodTypeId: foodTypeIdFor(clean) };
}

/** Break a block of method text into steps. */
export function splitSteps(text: string): string[] {
  const lines = text
    .replace(/\r/g, "")
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(step\s*)?\d+[.):]?\s*/i, "").trim())
    .filter((l) => l.length > 2);
  const steps = lines.length > 2 ? lines : text.split(/(?<=[.!?])\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
  return steps.filter((s) => !/^step \d+$/i.test(s)).map(localiseText);
}

export function slugId(prefix: string, title: string): string {
  return `${prefix}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-${Math.random().toString(36).slice(2, 7)}`;
}

export type { Recipe };
