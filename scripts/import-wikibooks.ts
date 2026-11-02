// Build src/lib/recipes/data/wikibooks.json from the Wikibooks Cookbook (CC BY-SA 4.0).
//
//   NODE_USE_ENV_PROXY=1 node scripts/import-wikibooks.ts [--limit 100]
//
// Why a snapshot: Wikimedia rate-limits anonymous API calls from cloud servers (Vercel included),
// so live search is unreliable. Instead this walks Category:Recipes once, politely (one request
// at a time, identified by User-Agent), reads each page's wikitext with ?action=raw, and keeps the
// pages our parser can read cleanly. Re-run it now and then to pick up new recipes.
// Raw page text is cached in .cache/wikibooks/ so re-runs only fetch what's new.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": join(root, "src") } });
const { recipeFromWikibooks } = (await jiti.import(join(root, "src/lib/recipes/wikibooks.ts"))) as typeof import("../src/lib/recipes/wikibooks.ts");

const UA = "Larder/1.0 (https://the-larder-psi.vercel.app; one-off recipe snapshot)";
const BASE = "https://en.wikibooks.org";
const CACHE = join(root, ".cache/wikibooks");
const OUT = join(root, "src/lib/recipes/data/wikibooks.json");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { "user-agent": UA } });
    if (res.ok) return res.text();
    if (res.status === 404) return "";
    await sleep(2000 * 2 ** attempt);
  }
  throw new Error(`failed: ${url}`);
}

function decode(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

async function categoryTitles(): Promise<string[]> {
  const titles = new Set<string>();
  let next: string | null = `${BASE}/wiki/Category:Recipes`;
  while (next && titles.size < LIMIT) {
    const html = await get(next);
    const list = html.split('id="mw-pages"')[1] ?? "";
    for (const m of list.matchAll(/<li><a href="\/wiki\/(Cookbook:[^"]+)" title="([^"]+)"/g)) titles.add(decode(m[2]));
    const more = list.match(/<a href="(\/w\/index\.php\?title=Category:Recipes&amp;pagefrom=[^"]+)"[^>]*>next page<\/a>/);
    next = more ? BASE + decode(more[1]) : null;
    process.stdout.write(`\rcategory: ${titles.size} pages`);
    await sleep(500);
  }
  console.log();
  return [...titles].slice(0, LIMIT);
}

function cachePath(title: string) {
  return join(CACHE, encodeURIComponent(title) + ".txt");
}

async function wikitext(title: string): Promise<{ title: string; text: string }> {
  let t = title;
  for (let hop = 0; hop < 2; hop++) {
    const file = cachePath(t);
    let text: string;
    if (existsSync(file)) text = readFileSync(file, "utf8");
    else {
      text = await get(`${BASE}/wiki/${encodeURIComponent(t.replace(/ /g, "_")).replace(/%3A/g, ":")}?action=raw`);
      writeFileSync(file, text);
      await sleep(250);
    }
    const redirect = text.match(/^#redirect\s*\[\[([^\]|#]+)/i);
    if (!redirect) return { title: t, text };
    t = redirect[1].trim();
  }
  return { title: t, text: "" };
}

/** Pages that aren't something a household would want suggested as a meal. */
const SKIP_TITLES = /placenta|food colou?ring|cannabis|marijuana|dog food|cat food|pet food|soap|play ?dough|baby formula|breast milk/i;

mkdirSync(CACHE, { recursive: true });
mkdirSync(dirname(OUT), { recursive: true });
const titles = await categoryTitles();
const recipes = [];
const seen = new Set<string>();
let skipped = 0;
// Three requests at a time, each followed by a short pause: well within Wikimedia's guidance.
const pages: { title: string; text: string }[] = [];
for (let i = 0; i < titles.length; i += 3) {
  pages.push(...(await Promise.all(titles.slice(i, i + 3).map(wikitext))));
  if (i % 60 === 0) process.stdout.write(`\rfetched: ${pages.length}/${titles.length}`);
}
console.log();
for (let i = 0; i < pages.length; i++) {
  const { title, text } = pages[i];
  if (seen.has(title)) continue;
  seen.add(title);
  const r = text && !SKIP_TITLES.test(title) ? recipeFromWikibooks({ title, wikitext: text }) : null;
  if (r) recipes.push(r);
  else skipped++;
  if (i % 25 === 0) process.stdout.write(`\rpages: ${i + 1}/${titles.length}, kept ${recipes.length}, skipped ${skipped}`);
}
console.log(`\rpages: ${titles.length}/${titles.length}, kept ${recipes.length}, skipped ${skipped}`);
recipes.sort((a, b) => a.title.localeCompare(b.title));
writeFileSync(OUT, JSON.stringify({ source: "Wikibooks Cookbook, Category:Recipes", licence: "CC BY-SA 4.0", fetched: new Date().toISOString().slice(0, 10), recipes }) + "\n");
console.log(`wrote ${OUT}`);
