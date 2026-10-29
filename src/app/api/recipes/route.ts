import { NextResponse } from "next/server";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL, AI_NOT_CONFIGURED, getAnthropic } from "@/lib/ai";
import { ingredient, slugId } from "@/lib/recipes/map";
import type { Recipe } from "@/lib/types";


const RequestSchema = z.object({
  items: z.array(z.object({ name: z.string().min(1).max(80), daysLeft: z.number() })).max(80),
  profile: z.object({
    people: z.number().int().min(1).max(20).default(2),
    diets: z.array(z.string()).default([]),
    allergies: z.array(z.string()).default([]),
    likes: z.array(z.string()).default([]),
    dislikes: z.array(z.string()).default([]),
  }),
  mustUse: z.array(z.string()).max(20).optional(),
  count: z.number().int().min(1).max(5).optional(),
});

const OutputSchema = z.object({
  recipes: z.array(
    z.object({
      title: z.string(),
      summary: z.string(),
      minutes: z.number(),
      servings: z.number(),
      tags: z.array(z.string()),
      ingredients: z.array(
        z.object({ name: z.string(), quantity: z.number().nullable(), unit: z.string().nullable(), optional: z.boolean() }),
      ),
      steps: z.array(z.string()),
    }),
  ),
});

const SYSTEM = `You write practical home-cooking recipes for Australian households trying to waste less food.
Rules:
- Australian English (capsicum, zucchini, mince, spring onion, coriander) and metric units only (g, kg, ml, L, tsp, tbsp, 180°C fan-forced).
- Build each recipe mainly around the ingredients that are closest to going off (smallest daysLeft). Name those ingredients plainly in the ingredient list.
- Beyond the listed pantry items, only assume very common staples: oil, salt, pepper, plain flour, sugar, butter, stock, soy sauce, dried herbs and spices. Keep any other extra ingredients to a minimum and mark them optional where reasonable.
- Scale quantities for the stated number of servings.
- Strictly respect the diets, allergies and dislikes. Never include an allergen or disliked food, even as an optional extra.
- Steps are short, imperative sentences. 4 to 7 steps. Titles are plain dish names, no marketing words.
- Use simple ingredient names without brands ("beef mince", not "Coles beef mince 500g"). Quantity null when it is "to taste".
- Give each recipe 2 to 4 lowercase tags such as vegetarian, gluten-free, quick, freezer-friendly, dinner, lunch.`;

export async function POST(req: Request) {
  const client = getAnthropic();
  if (!client) return NextResponse.json(AI_NOT_CONFIGURED, { status: 503 });

  let input: z.infer<typeof RequestSchema>;
  try {
    input = RequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "bad_request", message: "That request was not in the right shape." }, { status: 400 });
  }

  const count = input.count ?? 3;
  const { profile } = input;
  const sorted = [...input.items].sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 40);
  const list = sorted.map((i) => `- ${i.name} (${i.daysLeft < 0 ? "past its date" : i.daysLeft === 0 ? "use today" : `${i.daysLeft} days left`})`).join("\n");
  const prompt = [
    `Write ${count} different recipes for ${profile.people} ${profile.people === 1 ? "person" : "people"} (servings: ${profile.people}).`,
    input.mustUse?.length ? `Every recipe must use: ${input.mustUse.join(", ")}.` : "",
    `What is in the larder, most urgent first:\n${list || "- (nothing listed, use common staples)"}`,
    `Diets: ${profile.diets.join(", ") || "none"}`,
    `Allergies (never include): ${profile.allergies.join(", ") || "none"}`,
    `Dislikes (avoid): ${profile.dislikes.join(", ") || "none"}`,
    profile.likes.length ? `They enjoy: ${profile.likes.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const response = await client.messages.parse({
      model: AI_MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
      output_config: { format: zodOutputFormat(OutputSchema), effort: "low" },
    });

    if (response.stop_reason === "refusal" || !response.parsed_output) {
      return NextResponse.json(
        { error: "no_recipes", message: "Couldn't come up with recipes this time. Try again in a moment." },
        { status: 502 },
      );
    }

    const recipes: Recipe[] = response.parsed_output.recipes.slice(0, count).map((r) => ({
      id: slugId("ai", r.title),
      title: r.title.trim(),
      source: "ai",
      servings: r.servings > 0 ? Math.round(r.servings) : profile.people,
      minutes: r.minutes > 0 ? Math.round(r.minutes) : undefined,
      summary: r.summary.trim(),
      tags: r.tags.map((t) => t.toLowerCase()).slice(0, 5),
      ingredients: r.ingredients.map((i) => ({
        ...ingredient(i.name),
        quantity: i.quantity ?? undefined,
        unit: i.unit ?? undefined,
        optional: i.optional || undefined,
      })),
      steps: r.steps.map((s) => s.trim()).filter(Boolean),
    }));
    return NextResponse.json({ recipes });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: "rate_limited", message: "Too many requests right now. Wait a moment and try again." }, { status: 429 });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ ...AI_NOT_CONFIGURED, message: "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY." }, { status: 503 });
    }
    return NextResponse.json({ error: "ai_error", message: "Couldn't reach the recipe helper. Try again shortly." }, { status: 502 });
  }
}
