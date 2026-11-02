// Turning recipes from the web (and from photos, via AI) into Larder recipes.
// Pure functions only, so they run on the server route and in tests.

import type { Recipe, RecipeIngredient } from "@/lib/types";
import { foodTypeIdFor, localiseText, slugId } from "./map";

/* ---------- ingredient lines ---------- */

const FRACTIONS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125 };

const UNIT_ALIASES: Record<string, string> = {
  g: "g", gm: "g", gms: "g", gram: "g", grams: "g", gramme: "g", grammes: "g",
  kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  ml: "ml", millilitre: "ml", millilitres: "ml", milliliter: "ml", milliliters: "ml",
  l: "L", litre: "L", litres: "L", liter: "L", liters: "L",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp", t: "tsp",
  tbsp: "tbsp", tbs: "tbsp", tbl: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp", T: "tbsp",
  cup: "cup", cups: "cup", c: "cup",
  clove: "clove", cloves: "clove", slice: "slice", slices: "slice", pinch: "pinch", pinches: "pinch",
  package: "pack", packages: "pack", pkt: "pack", pkts: "pack", pkg: "pack",
  bunch: "bunch", bunches: "bunch", can: "tin", cans: "tin", tin: "tin", tins: "tin",
  jar: "jar", jars: "jar", packet: "pack", packets: "pack", pack: "pack", packs: "pack",
  sprig: "sprig", sprigs: "sprig", handful: "handful", handfuls: "handful", stick: "stick", sticks: "stick",
  // Imperial units are converted to metric below.
  oz: "oz", ounce: "oz", ounces: "oz", lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  "fl oz": "fl oz", "fluid ounce": "fl oz", "fluid ounces": "fl oz", quart: "qt", quarts: "qt", qt: "qt", pint: "pt", pints: "pt", pt: "pt",
};

/** Imperial to metric: [metric unit, factor]. Pints and quarts use US sizes, the common case online. */
const IMPERIAL: Record<string, [string, number]> = {
  oz: ["g", 28.35],
  lb: ["g", 453.6],
  "fl oz": ["ml", 29.57],
  pt: ["ml", 473],
  qt: ["ml", 946],
};

function num(token: string): number | undefined {
  let t = token.trim();
  let extra = 0;
  for (const [ch, v] of Object.entries(FRACTIONS)) {
    if (t.includes(ch)) {
      extra += v;
      t = t.replace(ch, "");
    }
  }
  if (t === "") return extra || undefined;
  if (t.includes("/")) {
    const [a, b] = t.split("/").map(Number);
    return b ? a / b + extra : undefined;
  }
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n + extra : undefined;
}

// Longest forms first: "1 1/2", "1½", "1/2", "½", then plain "1.5".
const NUM = String.raw`(?:\d+\s+\d+\/\d+|\d+\s*[½¼¾⅓⅔⅛]|\d+\/\d+|[½¼¾⅓⅔⅛]|\d+(?:[.,]\d+)?)(?![\d/])`;
const LEAD = new RegExp(String.raw`^(${NUM})(?:\s*(?:-|–|—|to)\s*(${NUM}))?\s*`, "i");

export function parseNumberWithMixed(token: string): number | undefined {
  const t = token.trim().replace(/(\d)\s*([½¼¾⅓⅔⅛])/, "$1 $2");
  const parts = t.split(/\s+/);
  if (parts.length === 2) return (num(parts[0]) ?? 0) + (num(parts[1]) ?? 0);
  return num(t);
}

/** Round a converted metric amount to something a cook would measure. */
function niceMetric(n: number, unit: string): number {
  if (unit === "g" || unit === "ml") return n >= 100 ? Math.round(n / 5) * 5 : Math.round(n);
  return Math.round(n * 100) / 100;
}

/**
 * Parse a free-text ingredient line such as "6–8 tbsp butter, softened", "1 (400g) tin tomatoes",
 * "2 lb chicken thighs" or "Salt, to taste". Keeps ranges and converts imperial weights to metric.
 */
export function parseIngredientLine(raw: string): RecipeIngredient {
  let line = raw
    .replace(/\s+/g, " ")
    .replace(/^[-•*▢□☐\s]+/, "")
    .trim();
  const optional = /\(optional\)|,?\s*optional\b/i.test(line);
  line = line.replace(/\(optional\)|,?\s*optional\b/gi, "").trim();

  let quantity: number | undefined;
  let quantityMax: number | undefined;
  const lead = line.match(LEAD);
  if (lead && /\d|[½¼¾⅓⅔⅛]/.test(lead[1])) {
    quantity = parseNumberWithMixed(lead[1]);
    quantityMax = lead[2] ? parseNumberWithMixed(lead[2]) : undefined;
    line = line.slice(lead[0].length);
  } else if (/^an?\s/i.test(line)) {
    quantity = 1;
    line = line.replace(/^an?\s/i, "");
  }

  // "1 (400g) tin tomatoes" and "2 x 400g tins tomatoes": keep the pack size as a note.
  const notes: string[] = [];
  const takeSize = () => {
    const paren = line.match(/^\(([^)]{1,24})\)\s*/);
    if (paren) {
      notes.push(paren[1].trim());
      line = line.slice(paren[0].length);
      return;
    }
    const times = line.match(/^[x×]\s*(\d+(?:\.\d+)?\s*(?:g|kg|ml|l|oz|lb)\b)\s*/i);
    if (times) {
      notes.push(times[1].replace(/\s+/g, ""));
      line = line.slice(times[0].length);
    }
  };
  if (quantity !== undefined) takeSize();

  let unit: string | undefined;
  if (quantity !== undefined) {
    const two = line.match(/^(fl\.? oz|fluid ounces?)\b\.?\s*/i);
    const one = line.match(/^([a-zA-Z]+)\.?(?:\s+|(?=[/(])|$)/);
    if (two) {
      unit = "fl oz";
      line = line.slice(two[0].length);
    } else if (one) {
      const word = one[1];
      const key = word === "T" ? "T" : word.toLowerCase();
      // A lone "c" or "t" is only a unit when the word is exactly that letter.
      if (UNIT_ALIASES[key] && !(key.length === 1 && word.length !== 1)) {
        unit = UNIT_ALIASES[key];
        line = line.slice(one[0].length);
      }
    }
    // "200g/7oz butter": drop the second measure. "1 cup (250ml) milk": keep it as a note.
    line = line.replace(/^\/\s*\d+(?:[.,]\d+)?\s*(?:oz|lb|g|kg|ml|l|cups?)\b\.?\s*/i, "");
    takeSize();
    line = line.replace(/^of\s+/i, "");
  }

  if (unit && IMPERIAL[unit] && quantity !== undefined) {
    const [metric, factor] = IMPERIAL[unit];
    quantity = niceMetric(quantity * factor, metric);
    if (quantityMax !== undefined) quantityMax = niceMetric(quantityMax * factor, metric);
    unit = metric;
  }

  // Pull out "(about 200g)" anywhere, then split "butter, softened" into the name and a prep note.
  let name = line.trim().replace(/\s*\(([^)]*)\)\s*/g, (_, inner: string) => {
    if (inner.trim()) notes.push(inner.trim());
    return " ";
  });
  name = name.replace(/\s+/g, " ").trim();
  const comma = name.indexOf(",");
  if (comma >= 2) {
    const rest = name.slice(comma + 1).trim();
    name = name.slice(0, comma).trim();
    if (rest) notes.push(rest);
  }
  if (/to taste|as needed|to serve/i.test(name)) {
    name = name.replace(/,?\s*(to taste|as needed|to serve)/i, "").trim();
    notes.push("to taste");
  }
  const note = notes.length ? [...new Set(notes)].join(", ") : undefined;
  name = name || raw.trim();

  const ing: RecipeIngredient = { name, foodTypeId: foodTypeIdFor(name) };
  if (quantity !== undefined) ing.quantity = quantity;
  if (quantityMax !== undefined && quantityMax > (quantity ?? 0)) ing.quantityMax = quantityMax;
  if (unit) ing.unit = unit;
  if (note) ing.note = note;
  if (optional) ing.optional = true;
  return ing;
}

/* ---------- method text ---------- */

/** "Bake at 350°F" becomes "Bake at 180°C (350°F)". Already-Celsius text is left alone. */
export function toCelsius(text: string): string {
  return text.replace(/(\d{3})\s*°?\s*(?:degrees\s*)?F\b(?!\))/gi, (_, f: string) => {
    const c = Math.round(((Number(f) - 32) * 5) / 9 / 10) * 10;
    return `${c}°C (${f}°F)`;
  });
}

/* ---------- schema.org Recipe (JSON-LD) ---------- */

type Json = unknown;

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function isRecipeNode(n: Json): n is Record<string, Json> {
  if (!n || typeof n !== "object") return false;
  const t = (n as Record<string, Json>)["@type"];
  return asArray(t as string | string[]).some((x) => typeof x === "string" && x.toLowerCase() === "recipe");
}

function findRecipeNode(data: Json, depth = 0): Record<string, Json> | null {
  if (depth > 6 || !data || typeof data !== "object") return null;
  if (Array.isArray(data)) {
    for (const d of data) {
      const r = findRecipeNode(d, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (isRecipeNode(data)) return data;
  const obj = data as Record<string, Json>;
  for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item"]) {
    if (key in obj) {
      const r = findRecipeNode(obj[key], depth + 1);
      if (r) return r;
    }
  }
  return null;
}

const decodeEntities = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#8217;|&rsquo;/g, "'")
    .replace(/&#8211;|&ndash;/g, "–")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

const text = (v: Json): string => (typeof v === "string" ? decodeEntities(v) : typeof v === "number" ? String(v) : "");

/** ISO 8601 duration ("PT1H15M") to minutes. */
export function durationMinutes(v: Json): number | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:\d+S)?)?$/i);
  if (!m) return undefined;
  const mins = Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return mins > 0 ? mins : undefined;
}

function servingsOf(v: Json): number {
  for (const y of asArray(v as Json[])) {
    const n = typeof y === "number" ? y : Number(String(y).match(/\d+/)?.[0]);
    if (Number.isFinite(n) && n > 0 && n < 100) return n;
  }
  return 4;
}

function stepsOf(v: Json): string[] {
  const out: string[] = [];
  const walk = (n: Json) => {
    if (typeof n === "string") {
      // Some sites put the whole method in one string.
      const parts = n
        .replace(/<br\s*\/?>|<\/p>/gi, "\n")
        .split(/\n+|(?<=\.)\s+(?=\d+\.\s)/)
        .map((s) => decodeEntities(s).replace(/^\d+[.)]\s*/, "").trim());
      out.push(...parts.filter((s) => s.length > 1));
      return;
    }
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === "object") {
      const o = n as Record<string, Json>;
      if (o.itemListElement) return walk(o.itemListElement);
      const t = text(o.text) || text(o.name);
      if (t) out.push(t);
    }
  };
  walk(v);
  return out.map((step) => localiseText(toCelsius(step)));
}

function tagsOf(node: Record<string, Json>): string[] {
  const raw = [
    ...asArray(node.recipeCategory as Json[]),
    ...asArray(node.recipeCuisine as Json[]),
    ...(typeof node.keywords === "string" ? node.keywords.split(",") : asArray(node.keywords as Json[])),
  ];
  const seen = new Set<string>();
  for (const r of raw) {
    const t = text(r).toLowerCase();
    if (t && t.length <= 24) seen.add(t);
  }
  return [...seen].slice(0, 6);
}

/** Australian sites use 20 ml tablespoons; most others (including NZ) use 15 ml. */
export function tablespoonFor(url: string | undefined): 15 | 20 {
  if (!url) return 20;
  try {
    const host = new URL(url).hostname;
    return /\.au$/.test(host) ? 20 : 15;
  } catch {
    return 20;
  }
}

/** Find and convert the schema.org Recipe in a page's HTML, or null when there isn't one. */
export function recipeFromHtml(html: string, url?: string): Recipe | null {
  const scripts = html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi);
  for (const s of scripts) {
    let data: Json;
    try {
      data = JSON.parse(s[1].trim());
    } catch {
      continue;
    }
    const node = findRecipeNode(data);
    if (!node) continue;
    const title = text(node.name);
    const ingredients = asArray(node.recipeIngredient as Json[]).map(text).filter(Boolean).map(parseIngredientLine);
    const steps = stepsOf(node.recipeInstructions);
    if (!title || ingredients.length === 0) continue;
    return finishImport({
      title,
      summary: text(node.description).slice(0, 300) || undefined,
      servings: servingsOf(node.recipeYield),
      minutes: durationMinutes(node.totalTime) ?? sumMinutes(durationMinutes(node.prepTime), durationMinutes(node.cookTime)),
      // The page's photo belongs to the site: not stored, so it isn't hotlinked on every view.
      ingredients,
      steps,
      tags: tagsOf(node),
      sourceUrl: url,
    });
  }
  return null;
}

function sumMinutes(a?: number, b?: number): number | undefined {
  return a || b ? (a ?? 0) + (b ?? 0) : undefined;
}

export interface ImportDraft {
  title: string;
  summary?: string;
  servings: number;
  minutes?: number;
  image?: string;
  ingredients: RecipeIngredient[];
  steps: string[];
  tags: string[];
  sourceUrl?: string;
  tbspMl?: 15 | 20;
}

/** Shared last step for every import path: ids, limits and the tablespoon size. */
export function finishImport(d: ImportDraft): Recipe {
  return {
    id: slugId("imp", d.title),
    title: d.title.slice(0, 120),
    source: "saved",
    sourceUrl: d.sourceUrl,
    image: d.image,
    servings: Math.max(1, Math.round(d.servings || 4)),
    minutes: d.minutes && d.minutes < 24 * 60 ? d.minutes : undefined,
    ingredients: d.ingredients.slice(0, 60),
    steps: d.steps.slice(0, 40),
    tags: d.tags.slice(0, 6),
    summary: d.summary,
    tbspMl: d.tbspMl ?? tablespoonFor(d.sourceUrl),
  };
}

/** Visible page text for the AI fallback, with scripts, styles and navigation removed. */
export function pageText(html: string, max = 30_000): string {
  return html
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|iframe)[\s\S]*?<\/\1>/gi, " ")
    .split(/<(?:br|p|li|h\d|div|tr)[^>]*>/i)
    .map(decodeEntities)
    .filter(Boolean)
    .join("\n")
    .slice(0, max);
}
