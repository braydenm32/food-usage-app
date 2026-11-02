import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL, getAnthropic } from "@/lib/ai";
import { finishImport, pageText, parseIngredientLine, recipeFromHtml, toCelsius } from "@/lib/recipes/import";
import { SafeFetchError, safeFetchPage } from "@/lib/safe-fetch";
import type { Recipe } from "@/lib/types";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function fail(status: number, error: string, message: string) {
  return NextResponse.json({ error, message }, { status });
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
      // A photo could be from any cookbook: assume Australian 20 ml unless the user says otherwise in the preview.
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

  // Only suggest a photo when photos can actually be read here.
  const client = getAnthropic();
  const fallback = client ? "import a screenshot of it as a photo" : "write it in yourself";
  let page: { html: string; url: string };
  try {
    page = await safeFetchPage(url);
  } catch (e) {
    const code = e instanceof SafeFetchError ? e.code : "network";
    const message =
      code === "blocked"
        ? "That link points somewhere Larder can't open. Use the recipe's public web address."
        : code === "timeout"
          ? `That site took too long to answer. Try again, or ${fallback}.`
          : code === "http" && (e as SafeFetchError).status === 404
            ? "That page wasn't found. Check the link is complete."
            : code === "http" && [401, 403, 429].includes((e as SafeFetchError).status ?? 0)
              ? `That site blocks other apps from reading its pages. You can ${fallback} instead.`
              : code === "not_html"
                ? "That link isn't a web page. Paste the link to the recipe itself."
                : `Couldn't open that page. Check the link, or ${fallback} instead.`;
    return fail(422, "fetch_failed", message);
  }

  const recipe = recipeFromHtml(page.html, page.url);
  if (recipe) return NextResponse.json({ recipe, method: "page-data" });

  if (!client) return fail(422, "no_recipe_data", "That page doesn't share its recipe in a standard way, so Larder can't read it. You can write it in yourself.");
  try {
    const r = await aiExtract(client, `Page: ${page.url}\n\n${pageText(page.html)}`);
    if (!r) return fail(422, "no_recipe", "Couldn't find a recipe on that page.");
    return NextResponse.json({ recipe: fromAi(r, page.url), method: "ai" });
  } catch (err) {
    return aiError(err);
  }
}
