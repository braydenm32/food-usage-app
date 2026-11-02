import { NextResponse } from "next/server";
import type { Recipe } from "@/lib/types";
import { ingredient, splitSteps } from "@/lib/recipes/map";


/**
 * TheMealDB's shared test key is "1". Before a public launch, set THEMEALDB_API_KEY to a
 * supporter key (https://www.themealdb.com/api.php), which its terms expect for production apps.
 */
const KEY = process.env.THEMEALDB_API_KEY?.trim() || "1";
const VERSION = KEY === "1" ? "v1" : "v2";
const BASE = `https://www.themealdb.com/api/json/${VERSION}/${encodeURIComponent(KEY)}`;
const WEEK = 60 * 60 * 24 * 7;

interface MealSummary {
  idMeal: string;
  strMeal: string;
  strMealThumb: string;
}
type MealFull = MealSummary & Record<string, string | null>;

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { next: { revalidate: WEEK }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

function mapMeal(m: MealFull): Recipe {
  const ingredients = [];
  for (let n = 1; n <= 20; n++) {
    const name = m[`strIngredient${n}`]?.trim();
    if (!name) continue;
    ingredients.push(ingredient(name, m[`strMeasure${n}`] ?? undefined));
  }
  const tags = [m.strCategory, m.strArea, ...(m.strTags?.split(",") ?? [])]
    .filter((t): t is string => !!t && t.toLowerCase() !== "unknown")
    .map((t) => t.trim().toLowerCase());
  if (m.strCategory === "Vegetarian" || m.strCategory === "Vegan") tags.push("vegetarian");
  return {
    id: `db-${m.idMeal}`,
    title: m.strMeal,
    source: "database",
    sourceUrl: m.strSource || `https://www.themealdb.com/meal/${m.idMeal}`,
    // TheMealDB's terms ask apps to name it as the source of its data and images.
    credit: { name: "TheMealDB", url: `https://www.themealdb.com/meal/${m.idMeal}` },
    image: m.strMealThumb,
    // TheMealDB doesn't say how many a meal serves.
    servings: 4,
    servingsEstimated: true,
    ingredients,
    steps: splitSteps(m.strInstructions ?? ""),
    tags: [...new Set(tags)],
  };
}

/** GET /api/recipes/search?ingredient=chicken&limit=6 (sends full recipes), or ?id=52772 for one. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const ing = searchParams.get("ingredient")?.trim();
  const limit = Math.min(Number(searchParams.get("limit")) || 6, 10);

  try {
    if (id !== null) {
      const notFound = () => NextResponse.json({ error: "not_found", message: "That recipe wasn't found." }, { status: 404 });
      if (!/^\d{1,10}$/.test(id)) return notFound();
      const data = await getJson<{ meals: MealFull[] | null }>(`${BASE}/lookup.php?i=${encodeURIComponent(id)}`);
      const meal = data?.meals?.[0];
      if (!meal) return notFound();
      const recipe = mapMeal(meal);
      // A meal with no ingredient list or method isn't a recipe anyone can cook.
      if (recipe.ingredients.length === 0 || recipe.steps.length === 0) return notFound();
      return NextResponse.json({ recipes: [recipe] });
    }
    if (!ing) return NextResponse.json({ error: "bad_request", message: "Add an ingredient to search for." }, { status: 400 });

    // TheMealDB filters on single, underscore-joined ingredient names ("chicken_breast").
    const term = ing.toLowerCase().replace(/\s+/g, "_");
    const words = ing.toLowerCase().split(/\s+/).filter(Boolean);
    const candidates = [...new Set([term, words[0], words[words.length - 1]])];
    let list: { meals: MealSummary[] | null } | null = null;
    for (const c of candidates) {
      list = await getJson<{ meals: MealSummary[] | null }>(`${BASE}/filter.php?i=${encodeURIComponent(c)}`);
      if (list?.meals?.length) break;
    }
    const metas = (list?.meals ?? []).slice(0, limit);
    const full = await Promise.all(
      metas.map((m) => getJson<{ meals: MealFull[] | null }>(`${BASE}/lookup.php?i=${m.idMeal}`).then((d) => d?.meals?.[0])),
    );
    const recipes = full.filter((m): m is MealFull => !!m).map(mapMeal).filter((r) => r.steps.length > 0);
    return NextResponse.json({ recipes });
  } catch {
    return NextResponse.json(
      { error: "unavailable", message: "The recipe library couldn't be reached. Check your connection and try again." },
      { status: 502 },
    );
  }
}
