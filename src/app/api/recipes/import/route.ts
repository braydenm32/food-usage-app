import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL, getAnthropic } from "@/lib/ai";
import { finishImport, pageText, parseIngredientLine, recipeFromHtml, toCelsius } from "@/lib/recipes/import";
import type { Recipe } from "@/lib/types";

const MAX_HTML_BYTES = 3 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
}

/* ---------- safe fetching of a user-supplied URL ---------- */

function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
}

async function assertPublicUrl(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocol");
  if (url.username || url.password || (url.port && url.port !== "80" && url.port !== "443")) throw new Error("url");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("private");
  return url;
}

/** Fetch a public web page, following up to 3 redirects and re-checking each hop. */
async function fetchPage(raw: string): Promise<{ html: string; url: string }> {
  let current = raw;
  for (let hop = 0; hop < 4; hop++) {
    const url = await assertPublicUrl(current);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; LarderRecipeImport/1.0)", accept: "text/html,application/xhtml+xml" },
    });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) throw new Error("redirect");
      current = new URL(next, url).toString();
      continue;
    }
    if (!res.ok) throw new Error(`status ${res.status}`);
    const type = res.headers.get("content-type") ?? "";
    if (!/html|xml/.test(type)) throw new Error("not html");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("empty");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_HTML_BYTES) {
        await reader.cancel();
        break; // recipe data is usually near the top; keep what we have
      }
      chunks.push(value);
    }
    return { html: Buffer.concat(chunks).toString("utf8"), url: url.toString() };
  }
  throw new Error("too many redirects");
}

/* ---------- AI extraction (pages without recipe data, and photos) ---------- */

const AiRecipe = z.object({
  found: z.boolean(),
  title: z.string(),
  summary: z.string(),
  servings: z.number(),
  minutes: z.number().nullable(),
  ingredients: z.array(z.string()),
  steps: z.array(z.string()),
  tags: z.array(z.string()),
});

const AI_SYSTEM = `You copy a recipe out of a web page or a photo (cookbook page, screenshot, handwritten card) exactly as written.
- found=false when there is no recipe.
- ingredients: one line each, exactly as written including amounts and ranges ("6-8 tbsp butter, softened"). Do not convert units.
- steps: the method, one step per item, without step numbers. Keep the author's wording.
- servings: the number it serves (4 if not stated). minutes: total time if stated, otherwise null.
- tags: 2 to 4 lowercase words such as dinner, vegetarian, baking.
- Ignore ads, comments, life stories and navigation.`;

async function aiExtract(client: Anthropic, content: Anthropic.MessageParam["content"]): Promise<z.infer<typeof AiRecipe> | null> {
  const response = await client.messages.parse({
    model: AI_MODEL,
    max_tokens: 4000,
    system: AI_SYSTEM,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(AiRecipe), effort: "low" },
  });
  const out = response.parsed_output;
  if (response.stop_reason === "refusal" || !out || !out.found || out.ingredients.length === 0) return null;
  return out;
}

function fromAi(r: z.infer<typeof AiRecipe>, sourceUrl?: string, tbspMl?: 15 | 20): Recipe {
  return finishImport({
    title: r.title.trim() || "Imported recipe",
    summary: r.summary.trim() || undefined,
    servings: r.servings,
    minutes: r.minutes ?? undefined,
    ingredients: r.ingredients.map(parseIngredientLine),
    steps: r.steps.map((s) => toCelsius(s.trim())).filter(Boolean),
    tags: r.tags.map((t) => t.toLowerCase()),
    sourceUrl,
    tbspMl,
  });
}

function aiError(err: unknown) {
  if (err instanceof Anthropic.RateLimitError) return fail(429, "rate_limited", "Too many requests right now. Wait a moment and try again.");
  if (err instanceof Anthropic.AuthenticationError) return fail(503, "ai_not_configured", "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.");
  return fail(502, "ai_error", "Couldn't read that recipe right now. Try again shortly.");
}

/** GET: whether the AI fallback (photos, pages without recipe data) is available. */
export async function GET() {
  await connection();
  return NextResponse.json({ ai: !!getAnthropic() });
}

/**
 * POST JSON `{ url }` to import from a web page, or multipart form data with `image` to read a photo.
 * Returns `{ recipe, method: "page-data" | "ai" }` for the user to review before saving.
 */
export async function POST(req: Request) {
  const type = req.headers.get("content-type") ?? "";

  if (type.startsWith("multipart/form-data")) {
    const client = getAnthropic();
    if (!client) return fail(503, "ai_not_configured", "Reading recipe photos needs the AI helper, which isn't set up yet. Paste a link instead.");
    if (Number(req.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES + 64 * 1024) return fail(413, "image_too_large", "That photo is too big. Try one under 8 MB.");
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return fail(400, "bad_request", "Send the photo as form data with an 'image' field.");
    }
    const file = form.get("image");
    if (!(file instanceof File) || file.size === 0) return fail(400, "no_image", "No photo was received. Choose a photo and try again.");
    if (file.size > MAX_IMAGE_BYTES) return fail(413, "image_too_large", "That photo is too big. Try one under 8 MB.");
    if (!IMAGE_TYPES.has(file.type)) return fail(415, "unsupported_image", "That file type isn't supported. Use a JPEG, PNG or WebP photo.");
    const data = Buffer.from(await file.arrayBuffer()).toString("base64");
    try {
      const r = await aiExtract(client, [
        { type: "image", source: { type: "base64", media_type: file.type as "image/jpeg", data } },
        { type: "text", text: "Copy the recipe in this photo." },
      ]);
      if (!r) return fail(422, "no_recipe", "Couldn't find a recipe in that photo. Try a closer, well-lit shot of the whole page.");
      return NextResponse.json({ recipe: fromAi(r, undefined, 20), method: "ai" });
    } catch (err) {
      return aiError(err);
    }
  }

  let url: string;
  try {
    const body = z.object({ url: z.string().trim().min(4).max(2000) }).parse(await req.json());
    url = /^https?:\/\//i.test(body.url) ? body.url : `https://${body.url}`;
    new URL(url);
  } catch {
    return fail(400, "bad_url", "That doesn't look like a web link. Paste the full address of the recipe page.");
  }

  let page: { html: string; url: string };
  try {
    page = await fetchPage(url);
  } catch {
    return fail(422, "fetch_failed", "Couldn't open that page. Check the link, or save a screenshot and import the photo instead.");
  }

  const recipe = recipeFromHtml(page.html, page.url);
  if (recipe) return NextResponse.json({ recipe, method: "page-data" });

  const client = getAnthropic();
  if (!client) return fail(422, "no_recipe_data", "That page doesn't share its recipe in a standard way. Try a screenshot of it as a photo once the AI helper is set up.");
  try {
    const r = await aiExtract(client, `Page: ${page.url}\n\n${pageText(page.html)}`);
    if (!r) return fail(422, "no_recipe", "Couldn't find a recipe on that page.");
    return NextResponse.json({ recipe: fromAi(r, page.url), method: "ai" });
  } catch (err) {
    return aiError(err);
  }
}
