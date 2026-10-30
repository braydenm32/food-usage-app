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

export function ingredient(name: string, measure?: string): RecipeIngredient {
  const clean = name.trim();
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
  return steps.filter((s) => !/^step \d+$/i.test(s));
}

export function slugId(prefix: string, title: string): string {
  return `${prefix}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)}-${Math.random().toString(36).slice(2, 7)}`;
}

export type { Recipe };
