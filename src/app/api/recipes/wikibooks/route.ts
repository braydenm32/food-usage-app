import { NextResponse } from "next/server";
import { searchWikibooks, wikibooksRecipe } from "@/lib/recipes/wikibooks-search";

/**
 * GET /api/recipes/wikibooks?ingredient=lentils&limit=4 (full recipes), or ?id=wb-red-lentil-soup for one.
 * Served from a bundled snapshot of the Wikibooks Cookbook (CC BY-SA 4.0, see scripts/import-wikibooks.ts):
 * Wikimedia rate-limits live API calls from cloud servers, and a snapshot is faster and works offline.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const ing = searchParams.get("ingredient")?.trim().slice(0, 60);
  const limit = Math.min(Number(searchParams.get("limit")) || 4, 8);

  if (id) {
    const recipe = wikibooksRecipe(id.startsWith("wb-") ? id : `wb-${id}`);
    if (!recipe) return NextResponse.json({ error: "not_found", message: "That recipe wasn't found." }, { status: 404 });
    return NextResponse.json({ recipes: [recipe] });
  }
  if (!ing) return NextResponse.json({ error: "bad_request", message: "Add an ingredient to search for." }, { status: 400 });
  return NextResponse.json({ recipes: searchWikibooks(ing, limit) });
}
