import { NextResponse } from "next/server";
import { recipeFromWikibooks } from "@/lib/recipes/wikibooks";
import type { Recipe } from "@/lib/types";

const API = "https://en.wikibooks.org/w/api.php";
const WEEK = 60 * 60 * 24 * 7;
/** Wikimedia asks every API client to identify itself. */
const HEADERS = { "user-agent": "Larder/1.0 (https://the-larder-psi.vercel.app; food waste app)" };
/** The Cookbook: namespace on Wikibooks. */
const COOKBOOK_NS = 102;

interface WikiPage {
  pageid: number;
  title: string;
  index?: number;
  fullurl?: string;
  missing?: boolean;
  revisions?: { slots?: { main?: { content?: string } } }[];
}

async function query(params: Record<string, string>): Promise<WikiPage[]> {
  const qs = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    prop: "revisions|info",
    rvprop: "content",
    rvslots: "main",
    inprop: "url",
    ...params,
  });
  const res = await fetch(`${API}?${qs}`, { headers: HEADERS, next: { revalidate: WEEK }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`wikibooks ${res.status}`);
  const data = (await res.json()) as { query?: { pages?: WikiPage[] } };
  return (data.query?.pages ?? []).filter((p) => !p.missing).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}

function toRecipes(pages: WikiPage[]): Recipe[] {
  return pages
    .map((p) => {
      const wikitext = p.revisions?.[0]?.slots?.main?.content;
      return wikitext ? recipeFromWikibooks({ pageid: p.pageid, title: p.title, wikitext, url: p.fullurl }) : null;
    })
    .filter((r): r is Recipe => r !== null);
}

/**
 * GET /api/recipes/wikibooks?ingredient=lentils&limit=4 (full recipes), or ?id=12345 for one page.
 * Recipes come from the Wikibooks Cookbook under CC BY-SA 4.0, each with its credit attached.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const ing = searchParams.get("ingredient")?.trim().slice(0, 60);
  const limit = Math.min(Number(searchParams.get("limit")) || 4, 8);

  try {
    if (id) {
      if (!/^\d{1,10}$/.test(id)) return NextResponse.json({ error: "bad_request", message: "That recipe id isn't valid." }, { status: 400 });
      const recipes = toRecipes(await query({ pageids: id }));
      if (!recipes.length) return NextResponse.json({ error: "not_found", message: "That recipe wasn't found." }, { status: 404 });
      return NextResponse.json({ recipes });
    }
    if (!ing) return NextResponse.json({ error: "bad_request", message: "Add an ingredient to search for." }, { status: 400 });

    const term = ing.replace(/["\\]/g, " ");
    // Ask for extra pages: some are ingredient articles or use tables we can't read.
    const search = (q: string) =>
      query({ generator: "search", gsrsearch: q, gsrnamespace: String(COOKBOOK_NS), gsrlimit: String(limit * 3) });
    let recipes = toRecipes(await search(`${term} incategory:Recipes`));
    if (recipes.length === 0) recipes = toRecipes(await search(term));
    return NextResponse.json({ recipes: recipes.slice(0, limit) });
  } catch {
    return NextResponse.json(
      { error: "unavailable", message: "The recipe library couldn't be reached. Check your connection and try again." },
      { status: 502 },
    );
  }
}
