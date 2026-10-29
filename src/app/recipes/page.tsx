"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BookOpen, Sparkles, WifiOff } from "lucide-react";
import { Button, Chip, EmptyState, PageHeader, Segmented, SectionTitle, buttonClass } from "@/components/ui";
import { RecipeCard, RecipeCardSkeleton } from "@/components/recipes/recipe-card";
import { BUILTIN_RECIPES } from "@/lib/recipes/builtin";
import { cacheRecipes } from "@/lib/recipes/cache";
import { analyseRecipe, rankRecipes, scoreOf, type RankedRecipe } from "@/lib/recipes/suggest";
import { useItemViews } from "@/lib/selectors";
import { useLarder } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";
import type { Recipe } from "@/lib/types";

export default function RecipesPage() {
  return (
    <Suspense fallback={<PageHeader title="Recipes" />}>
      <RecipesView />
    </Suspense>
  );
}

type Tab = "ideas" | "saved";
const INITIAL_SHOWN = 8;

function RecipesView() {
  const hydrated = useHydrated();
  const params = useSearchParams();
  const useParam = params.get("use");
  const views = useItemViews();
  const profile = useLarder((s) => s.profile);
  const saved = useLarder((s) => s.savedRecipes);

  const [tab, setTab] = useState<Tab>("ideas");
  const [quick, setQuick] = useState(false);
  const [veg, setVeg] = useState(false);
  const [useItem, setUseItem] = useState<string | null>(useParam);
  const [showAll, setShowAll] = useState(false);
  const [prevParam, setPrevParam] = useState(useParam);
  if (prevParam !== useParam) {
    setPrevParam(useParam);
    setUseItem(useParam);
  }

  const ranked = useMemo(() => rankRecipes(BUILTIN_RECIPES, views, profile), [views, profile]);

  // Items worth offering as "uses ..." chips: at-risk, and actually used by some recipe.
  const useChips = useMemo(() => {
    const used = new Set(ranked.flatMap((r) => r.itemIds));
    const chips = views.filter((v) => (v.expiry.status === "use-today" || v.expiry.status === "use-soon") && used.has(v.item.id)).slice(0, 4);
    if (useItem && !chips.some((c) => c.item.id === useItem)) {
      const v = views.find((x) => x.item.id === useItem);
      if (v) chips.unshift(v);
    }
    return chips;
  }, [views, ranked, useItem]);

  const filtered = useMemo(
    () =>
      ranked.filter(
        (r) =>
          (!quick || (r.recipe.minutes ?? 99) <= 30) &&
          (!veg || r.recipe.tags.includes("vegetarian")) &&
          (!useItem || r.itemIds.includes(useItem)),
      ),
    [ranked, quick, veg, useItem],
  );
  const filtering = quick || veg || !!useItem;
  const atRiskCount = views.filter((v) => v.expiry.status === "use-today" || v.expiry.status === "use-soon").length;

  // --- AI ideas
  const [ai, setAi] = useState<{ state: "idle" | "loading" | "done" | "unconfigured" | "error"; recipes: Recipe[]; message?: string }>({
    state: "idle",
    recipes: [],
  });
  async function getIdeas() {
    setAi((a) => ({ ...a, state: "loading", message: undefined }));
    try {
      const res = await fetch("/api/recipes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: views.filter((v) => v.expiry.status !== "expired").slice(0, 40).map((v) => ({ name: v.item.name, daysLeft: v.expiry.daysLeft })),
          profile,
          mustUse: useItem ? [views.find((v) => v.item.id === useItem)?.item.name].filter(Boolean) : undefined,
          count: 3,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503) return setAi({ state: "unconfigured", recipes: [] });
      if (!res.ok) return setAi({ state: "error", recipes: [], message: data.message });
      cacheRecipes(data.recipes);
      setAi({ state: "done", recipes: data.recipes });
    } catch {
      setAi({ state: "error", recipes: [], message: "You seem to be offline. The built-in recipes below still work." });
    }
  }

  // --- Recipe library (TheMealDB) for the most urgent ingredient
  const libraryTerm = useMemo(() => {
    const v = views.find((x) => x.expiry.status === "use-today" || x.expiry.status === "use-soon") ?? views.find((x) => x.expiry.status === "fresh" && x.food?.category !== "pantry");
    return v ? v.item.name : null;
  }, [views]);
  const [lib, setLib] = useState<{ term: string; recipes: Recipe[]; failed: boolean } | null>(null);
  useEffect(() => {
    if (!libraryTerm || tab !== "ideas") return;
    const ctl = new AbortController();
    fetch(`/api/recipes/search?ingredient=${encodeURIComponent(libraryTerm)}&limit=4`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { recipes: Recipe[] }) => {
        cacheRecipes(d.recipes);
        setLib({ term: libraryTerm, recipes: d.recipes, failed: false });
      })
      .catch(() => {
        if (!ctl.signal.aborted) setLib({ term: libraryTerm, recipes: [], failed: true });
      });
    return () => ctl.abort();
  }, [libraryTerm, tab]);
  const libLoading = !!libraryTerm && lib?.term !== libraryTerm;

  const analyse = (r: Recipe): RankedRecipe => {
    const a = analyseRecipe(r, views);
    return { ...a, score: scoreOf(a) };
  };

  if (!hydrated) {
    return (
      <>
        <PageHeader title="Recipes" />
        <div className="space-y-3 px-5 lg:px-0">
          {[0, 1, 2].map((i) => (
            <RecipeCardSkeleton key={i} />
          ))}
        </div>
      </>
    );
  }

  const shown = showAll || filtering ? filtered : filtered.slice(0, INITIAL_SHOWN);

  return (
    <>
      <PageHeader
        title="Recipes"
        subtitle={atRiskCount > 0 ? `${atRiskCount} ${atRiskCount === 1 ? "thing needs" : "things need"} using up` : "Nothing is close to its date. Nice."}
      />
      <div className="px-5 pb-8 lg:px-0">
        <Segmented
          label="Recipe view"
          value={tab}
          onChange={setTab}
          options={[
            { value: "ideas", label: "Use it up" },
            { value: "saved", label: `Saved${saved.length ? ` (${saved.length})` : ""}` },
          ]}
          className="max-w-sm"
        />

        {tab === "ideas" ? (
          <>
            <div className="-mx-5 mt-4 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:flex-wrap lg:px-0" role="group" aria-label="Filters">
              <Chip selected={quick} onClick={() => setQuick((v) => !v)}>
                Quick
              </Chip>
              <Chip selected={veg} onClick={() => setVeg((v) => !v)}>
                Vegetarian
              </Chip>
              {useChips.map((v) => (
                <Chip key={v.item.id} selected={useItem === v.item.id} onClick={() => setUseItem((cur) => (cur === v.item.id ? null : v.item.id))}>
                  <span aria-hidden>{v.item.emoji}</span> Uses {v.item.name.toLowerCase()}
                </Chip>
              ))}
            </div>

            <SectionTitle
              action={<span className="text-sm text-ink-3">{filtered.length} {filtered.length === 1 ? "recipe" : "recipes"}</span>}
            >
              {atRiskCount > 0 ? "Use it up first" : "Ideas from your larder"}
            </SectionTitle>
            {filtered.length === 0 ? (
              <EmptyState
                emoji="🍳"
                title={filtering ? "No recipes match those filters" : "No recipes fit your household"}
                body={filtering ? "Try clearing a filter, or ask for fresh ideas below." : "Your diets and allergies rule out the built-in recipes. Fresh ideas are tailored to you."}
                action={
                  filtering ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setQuick(false);
                        setVeg(false);
                        setUseItem(null);
                      }}
                    >
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <ul className="grid gap-3 lg:grid-cols-2">
                {shown.map((r) => (
                  <li key={r.recipe.id}>
                    <RecipeCard ranked={r} />
                  </li>
                ))}
              </ul>
            )}
            {!showAll && !filtering && filtered.length > INITIAL_SHOWN && (
              <div className="mt-4 flex justify-center">
                <Button variant="secondary" onClick={() => setShowAll(true)}>
                  Show all {filtered.length} recipes
                </Button>
              </div>
            )}
            {views.length === 0 && (
              <p className="mt-4 text-sm text-ink-2">
                Your larder is empty, so these are just popular dinners.{" "}
                <Link href="/add" className="font-semibold text-primary underline-offset-2 hover:underline">
                  Add what you have
                </Link>{" "}
                to see what to cook first.
              </p>
            )}

            <SectionTitle>Fresh ideas</SectionTitle>
            <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
              <p className="text-[15px] text-ink-2">
                Let Claude write three recipes around what is going off first, for {profile.people} {profile.people === 1 ? "person" : "people"}
                {useItem ? ` and including ${views.find((v) => v.item.id === useItem)?.item.name.toLowerCase() ?? "your pick"}` : ""}.
              </p>
              <Button className="mt-3" onClick={getIdeas} disabled={ai.state === "loading" || views.length === 0}>
                <Sparkles size={18} aria-hidden /> {ai.state === "loading" ? "Thinking up recipes…" : ai.state === "done" ? "Get more ideas" : "Get fresh ideas"}
              </Button>
              {views.length === 0 && <p className="mt-2 text-sm text-ink-3">Add a few items to your larder first.</p>}
              {ai.state === "unconfigured" && (
                <p role="status" className="mt-3 rounded-2xl bg-soon-soft p-3 text-sm text-ink">
                  AI ideas are not set up on this device yet. Ask whoever runs Larder to add an Anthropic API key. The built-in recipes above work without it.
                </p>
              )}
              {ai.state === "error" && (
                <p role="alert" className="mt-3 flex items-start gap-2 rounded-2xl bg-spoiled-soft p-3 text-sm text-ink">
                  <WifiOff size={16} className="mt-0.5 shrink-0" aria-hidden /> {ai.message ?? "Couldn't get ideas just now. Try again in a moment."}
                </p>
              )}
            </div>
            {ai.state === "loading" && (
              <div className="mt-3 space-y-3" aria-label="Loading ideas" role="status">
                {[0, 1, 2].map((i) => (
                  <RecipeCardSkeleton key={i} />
                ))}
              </div>
            )}
            {ai.state === "done" && (
              <ul className="mt-3 grid gap-3 lg:grid-cols-2">
                {ai.recipes.map((r) => (
                  <li key={r.id}>
                    <RecipeCard ranked={analyse(r)} />
                  </li>
                ))}
              </ul>
            )}

            {libraryTerm && (
              <>
                <SectionTitle>More from the recipe library</SectionTitle>
                <p className="-mt-1 mb-3 text-sm text-ink-2">Recipes using {libraryTerm.toLowerCase()}, from TheMealDB.</p>
                {libLoading ? (
                  <div className="space-y-3" aria-label="Loading library recipes" role="status">
                    {[0, 1].map((i) => (
                      <RecipeCardSkeleton key={i} />
                    ))}
                  </div>
                ) : lib && lib.failed ? (
                  <p className="text-sm text-ink-2">The recipe library can&apos;t be reached right now. Check your connection and come back later.</p>
                ) : lib && lib.recipes.length === 0 ? (
                  <p className="text-sm text-ink-2">Nothing in the library for {libraryTerm.toLowerCase()} yet.</p>
                ) : (
                  <ul className="grid gap-3 lg:grid-cols-2">
                    {lib?.recipes.map((r) => (
                      <li key={r.id}>
                        <RecipeCard ranked={analyse(r)} />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        ) : (
          <div className="mt-4">
            {saved.length === 0 ? (
              <EmptyState
                emoji="🔖"
                title="No saved recipes yet"
                body="Save recipes you want to cook again and they will live here, even offline."
                action={
                  <button type="button" onClick={() => setTab("ideas")} className={buttonClass("secondary")}>
                    <BookOpen size={18} aria-hidden /> Browse recipes
                  </button>
                }
              />
            ) : (
              <ul className="grid gap-3 lg:grid-cols-2">
                {saved.map((r) => (
                  <li key={r.id}>
                    <RecipeCard ranked={analyse(r)} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </>
  );
}
