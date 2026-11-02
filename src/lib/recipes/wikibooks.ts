import type { Recipe } from "@/lib/types";
import { finishImport, parseIngredientLine } from "@/lib/recipes/import";
import { localiseText } from "@/lib/recipes/map";

/**
 * Turns a Wikibooks Cookbook page (wikitext) into a Larder recipe.
 *
 * Wikibooks text is CC BY-SA 4.0: we may show it, as long as every recipe credits the page and its
 * contributors, links the licence and says that we changed it (we strip the wiki markup).
 */

export const WIKIBOOKS_LICENCE = "CC BY-SA 4.0";
export const WIKIBOOKS_LICENCE_URL = "https://creativecommons.org/licenses/by-sa/4.0/";

export function wikibooksUrl(title: string): string {
  return `https://en.wikibooks.org/wiki/${encodeURI(title.replace(/ /g, "_")).replace(/\?/g, "%3F")}`;
}

const ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", ndash: "–", mdash: "—", deg: "°",
  frac12: "½", frac14: "¼", frac34: "¾", times: "×", hellip: "…",
};

/** Strip wiki markup down to the words a reader sees. */
export function cleanWikitext(text: string): string {
  let s = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>/]*\/>/gi, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "");
  // Templates, innermost first ({{convert|..}} and friends carry no recipe words we can trust).
  for (let i = 0; i < 10 && /\{\{[^{}]*\}\}/.test(s); i++) s = s.replace(/\{\{[^{}]*\}\}/g, "");
  // Internal links, innermost first: [[Cookbook:Onion|onions]] -> onions, [[File:...]] -> nothing.
  for (let i = 0; i < 10 && /\[\[[^[\]]*\]\]/.test(s); i++) {
    s = s.replace(/\[\[([^[\]|]*)(?:\|([^[\]]*))?\]\]/g, (_m, target: string, label?: string) => {
      const t = target.trim();
      if (/^(file|image|category|media):/i.test(t)) return "";
      if (label !== undefined && label.trim()) return label.split("|").pop()!.trim();
      return t.replace(/^[a-z]+:/i, "").replace(/#.*$/, "");
    });
  }
  s = s
    .replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, "$1")
    .replace(/\[https?:\/\/[^\]]+\]/g, "")
    .replace(/'{2,}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|[a-z]+\d*);/gi, (m, e: string) => {
      if (e.startsWith("#")) return String.fromCharCode(Number(e.slice(1)));
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:)])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\(\s*\)/g, "")
    .trim();
  return s;
}

/** "1 hour 30 minutes", "45 min", "1½ hours", "2–3 hours" -> minutes. */
export function wikiMinutes(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const t = cleanWikitext(text).toLowerCase().replace(/½/g, ".5").replace(/¼/g, ".25").replace(/¾/g, ".75");
  let total = 0;
  const hours = t.match(/(\d+(?:\.\d+)?)\s*(?:[-–]\s*\d+(?:\.\d+)?\s*)?(?:hours?|hrs?|h)\b/);
  const mins = t.match(/(\d+)\s*(?:[-–]\s*\d+\s*)?(?:minutes?|mins?|m)\b/);
  if (hours) total += Number(hours[1]) * 60;
  if (mins) total += Number(mins[1]);
  return total > 0 && total < 24 * 60 ? Math.round(total) : undefined;
}

/** Fields of the {{Recipe summary | ... }} template at the top of most Cookbook pages. */
export function recipeSummaryFields(wikitext: string): Record<string, string> {
  const start = wikitext.search(/\{\{\s*recipe[ _]?summary/i);
  if (start < 0) return {};
  // Find the matching close, allowing nested templates inside it.
  let depth = 0;
  let end = -1;
  for (let i = start; i < wikitext.length - 1; i++) {
    if (wikitext[i] === "{" && wikitext[i + 1] === "{") {
      depth++;
      i++;
    } else if (wikitext[i] === "}" && wikitext[i + 1] === "}") {
      depth--;
      i++;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return {};
  const body = wikitext.slice(start + 2, end - 2);
  const fields: Record<string, string> = {};
  // Split on top-level pipes only.
  let level = 0;
  let cur = "";
  const parts: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === "{{" || two === "[[") {
      level++;
      cur += two;
      i++;
    } else if (two === "}}" || two === "]]") {
      level--;
      cur += two;
      i++;
    } else if (body[i] === "|" && level === 0) {
      parts.push(cur);
      cur = "";
    } else cur += body[i];
  }
  parts.push(cur);
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq > 0) fields[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
  }
  return fields;
}

interface Section {
  title: string;
  level: number;
  lines: string[];
}

function sections(wikitext: string): Section[] {
  const out: Section[] = [{ title: "", level: 0, lines: [] }];
  for (const line of wikitext.replace(/\r/g, "").split("\n")) {
    const h = line.match(/^(={2,6})\s*(.*?)\s*\1\s*$/);
    if (h) out.push({ title: cleanWikitext(h[2]).toLowerCase(), level: h[1].length, lines: [] });
    else out[out.length - 1].lines.push(line);
  }
  return out;
}

/** The lines under a matching heading, including its subsections ("=== For the dough ==="). */
function sectionLines(all: Section[], match: RegExp): string[] {
  const i = all.findIndex((s) => s.level > 0 && match.test(s.title));
  if (i < 0) return [];
  const lines = [...all[i].lines];
  for (let j = i + 1; j < all.length && all[j].level > all[i].level; j++) lines.push(...all[j].lines);
  return lines;
}

const INGREDIENTS = /^ingredients?\b/;
const METHOD = /^(procedure|method|directions|preparation|instructions|steps)\b/;

function tagsFrom(wikitext: string, summaryCategory?: string): string[] {
  const cats = [
    ...(summaryCategory ? [summaryCategory] : []),
    ...[...wikitext.matchAll(/\[\[\s*category\s*:\s*([^\]|]+)/gi)].map((m) => m[1]),
  ].map((c) => cleanWikitext(c).toLowerCase());
  const tags = new Set<string>();
  for (const c of cats) {
    if (/vegan|vegetarian/.test(c)) tags.add("vegetarian");
    if (/gluten[- ]free/.test(c)) tags.add("gluten-free");
    const m = c.match(/^([a-z][a-z -]{2,20}) recipes$/);
    if (m && !/^recipes using/.test(c) && !/vegan|vegetarian/.test(m[1])) tags.add(m[1].trim());
  }
  return [...tags].slice(0, 4);
}

/**
 * Parse one Cookbook page. Returns null for pages that aren't a usable recipe
 * (no ingredient list, ingredients in a table, fewer than two steps).
 */
export function recipeFromWikibooks(page: { pageid: number; title: string; wikitext: string; url?: string }): Recipe | null {
  const { wikitext } = page;
  if (/^#redirect/i.test(wikitext.trim())) return null;
  const all = sections(wikitext);
  const ingLines = sectionLines(all, INGREDIENTS)
    .filter((l) => /^\*+/.test(l))
    .map((l) => cleanWikitext(l.replace(/^\*+\s*/, "")))
    .filter((l) => l.length > 1 && l.length < 160);
  const steps = sectionLines(all, METHOD)
    .filter((l) => /^[#*]+(?![:;])/.test(l))
    .map((l) => cleanWikitext(l.replace(/^[#*]+\s*/, "")))
    .filter((l) => l.length > 3);
  if (ingLines.length < 2 || steps.length < 2) return null;

  const fields = recipeSummaryFields(wikitext);
  const title = page.title.replace(/^cookbook:/i, "").trim();
  const url = page.url ?? wikibooksUrl(page.title);
  const statedServings = Number(cleanWikitext(fields.servings ?? fields.yield ?? "").match(/\d+/)?.[0]);
  const servings = statedServings || 4;

  // The intro paragraph(s) before the first heading, minus the template lines.
  const intro = all[0].lines
    .filter((l) => l.trim() && !/^[{|}]/.test(l.trim()) && !/^\[\[/.test(l.trim()))
    .map(cleanWikitext)
    .filter((l) => l.length > 20)
    .join(" ");

  const recipe = finishImport({
    title,
    summary: intro ? intro.slice(0, 280) : undefined,
    servings,
    minutes: wikiMinutes(fields.time ?? fields["total time"]),
    ingredients: ingLines.map((l) => parseIngredientLine(localiseText(l))).filter((i) => i.name),
    steps: steps.map(localiseText),
    tags: tagsFrom(wikitext, fields.category),
    sourceUrl: url,
    tbspMl: 15,
  });
  return {
    ...recipe,
    id: `wb-${page.pageid}`,
    source: "database",
    ...(statedServings ? {} : { servingsEstimated: true }),
    credit: {
      name: "Wikibooks Cookbook",
      url,
      licence: WIKIBOOKS_LICENCE,
      licenceUrl: WIKIBOOKS_LICENCE_URL,
      authorsUrl: `${url}?action=history`,
      changes: "Reformatted for Larder",
    },
  };
}
