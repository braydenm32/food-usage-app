"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BookOpen, CalendarDays, CircleAlert, Globe, Sparkles, WifiOff, X } from "lucide-react";
import { Button, Chip, EmptyState, PageHeader, Segmented, SectionTitle, buttonClass } from "@/components/ui";
import { toast } from "@/components/toast";
import { RecipeCard, RecipeCardSkeleton } from "@/components/recipes/recipe-card";
import { BUILTIN_RECIPES } from "@/lib/recipes/builtin";
import { cacheRecipes } from "@/lib/recipes/cache";
import { allergenHits, analyseRecipe, isRecipeAllowed, rankRecipes, scoreOf, type RankedRecipe } from "@/lib/recipes/suggest";
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
const LIB_FAILED_KEY = "larder-recipe-library-failed";

function readLibFailed(): boolean {
  try {
    return sessionStorage.getItem(LIB_FAILED_KEY) === "1";
  } catch {
    return false;
  }
}
function rememberLibFailed() {
  try {
    sessionStorage.setItem(LIB_FAILED_KEY, "1");
  } catch {
    // fine: we just retry next time
  }
}

/** "?plan=2025-10-27" -> { iso, long: "Monday 27 Oct", day: "Monday" }, or null when absent or invalid. */
function parsePlanDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime()) || date.getDate() !== d) return null;
  const day = date.toLocaleDateString("en-AU", { weekday: "long" });
  const rest = date.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  return { iso: value, day, long: `${day} ${rest}` };
}

function RecipesView() {
  const hydrated = useHydrated();
  const params = useSearchParams();
  const useParam = params.get("use");
  const router = useRouter();
  const planDay = parsePlanDay(params.get("plan"));
  const plannerOn = useLarder((s) => s.settings.mealPlannerEnabled);
  const planMeal = useLarder((s) => s.planMeal);
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
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    fetch("/api/recipes", { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { configured?: boolean }) => setAiConfigured(!!d.configured))
      .catch(() => {
        // Offline or the check failed: leave the button available and let the real call explain.
        if (!ctl.signal.aborted) setAiConfigured(null);
      });
    return () => ctl.abort();
  }, []);

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
      if (res.status === 503) {
        setAiConfigured(false);
        return setAi({ state: "unconfigured", recipes: [] });
      }
      if (!res.ok) return setAi({ state: "error", recipes: [], message: data.message });
      cacheRecipes(data.recipes);
      setAi({ state: "done", recipes: data.recipes });
    } catch {
      setAi({ state: "error", recipes: [], message: "You seem to be offline. The built-in recipes below still work." });
    }
  }

  // --- Recipe library (TheMealDB): only fetched when asked, and not retried after a failure this session
  const libraryTerm = useMemo(() => {
    const v = views.find((x) => x.expiry.status === "use-today" || x.expiry.status === "use-soon") ?? views.find((x) => x.expiry.status === "fresh" && x.food?.category !== "pantry");
    return v ? v.item.name : null;
  }, [views]);
  const [lib, setLib] = useState<{ term: string; recipes: Recipe[]; failed: boolean } | null>(null);
  const [libLoading, setLibLoading] = useState(false);
  const [libFailed, setLibFailed] = useState(readLibFailed);
  async function findOnline() {
    if (!libraryTerm) return;
    const term = libraryTerm;
    setLibLoading(true);
    try {
      const res = await fetch(`/api/recipes/search?ingredient=${encodeURIComponent(term)}&limit=6`);
      if (!res.ok) throw new Error("bad");
      const d = (await res.json()) as { recipes: Recipe[] };
      cacheRecipes(d.recipes);
      setLib({ term, recipes: d.recipes, failed: false });
    } catch {
      rememberLibFailed();
      setLibFailed(true);
      setLib({ term, recipes: [], failed: true });
    } finally {
      setLibLoading(false);
    }
  }

  // Everything that didn't come from our own vetted list is filtered the same way.
  const aiAllowed = useMemo(() => ai.recipes.filter((r) => isRecipeAllowed(r, profile)), [ai.recipes, profile]);
  const libAllowed = useMemo(() => (lib?.recipes ?? []).filter((r) => isRecipeAllowed(r, profile)), [lib, profile]);
  const aiHidden = ai.recipes.length - aiAllowed.length;
  const libHidden = (lib?.recipes.length ?? 0) - libAllowed.length;

  function planRecipe(r: Recipe) {
    if (!planDay) return;
    planMeal(planDay.iso, r);
    toast(`Planned ${r.title} for ${planDay.day}`, { action: { label: "View plan", onClick: () => router.push("/plan") } });
  }
  const planProps = (r: Recipe) =>
    planDay && plannerOn
      ? { planLabel: `Plan for ${planDay.day}`, onPlan: () => planRecipe(r), href: `/recipes/${encodeURIComponent(r.id)}?plan=${planDay.iso}` }
      : {};
  /** Saved recipes can pre-date a newly added allergy, so flag them. */
  const warningFor = (r: Recipe) => {
    const hit = allergenHits(r, profile)[0];
    return hit ? `Contains ${hit.allergy.toLowerCase()} (${hit.ingredient.toLowerCase()})` : undefined;
  };

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
        showSettings
        actions={
          plannerOn ? (
            <Link
              href="/plan"
              aria-label="Meal plan"
              title="Meal plan"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink lg:hidden"
            >
              <CalendarDays size={22} aria-hidden />
            </Link>
          ) : undefined
        }
      />
      <div className="px-5 pb-8 lg:px-0">
        {planDay && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-primary-soft px-4 py-3 text-ink">
            <p className="flex items-center gap-2 text-[15px] font-medium">
              <CalendarDays size={18} className="shrink-0 text-primary" aria-hidden /> Planning {planDay.long}
            </p>
            <Link href="/plan" aria-label="Cancel planning and go back to the plan" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 hover:bg-surface/60 hover:text-ink">
              <X size={18} aria-hidden />
            </Link>
          </div>
        )}
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
            <div className="fade-x -mx-5 mt-4 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:flex-wrap lg:px-0" role="group" aria-label="Filters">
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
                    <RecipeCard ranked={r} {...planProps(r.recipe)} />
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
            {aiConfigured === false || ai.state === "unconfigured" ? (
              <p className="rounded-[var(--radius-card)] border border-line bg-surface p-4 text-sm text-ink-2">
                AI-written ideas aren&apos;t set up on this device. The built-in recipes above work without them.
              </p>
            ) : (
              <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
                <p className="text-[15px] text-ink-2">
                  Let Claude write three recipes around what is going off first, for {profile.people} {profile.people === 1 ? "person" : "people"}
                  {useItem ? ` and including ${views.find((v) => v.item.id === useItem)?.item.name.toLowerCase() ?? "your pick"}` : ""}.
                </p>
                <Button className="mt-3" onClick={getIdeas} disabled={ai.state === "loading" || views.length === 0}>
                  <Sparkles size={18} aria-hidden /> {ai.state === "loading" ? "Thinking up recipes…" : ai.state === "done" ? "Get more ideas" : "Get fresh ideas"}
                </Button>
                {views.length === 0 && <p className="mt-2 text-sm text-ink-3">Add a few items to your larder first.</p>}
                {ai.state === "error" && (
                  <p role="alert" className="mt-3 flex items-start gap-2 rounded-2xl bg-spoiled-soft p-3 text-sm text-ink">
                    <WifiOff size={16} className="mt-0.5 shrink-0" aria-hidden /> {ai.message ?? "Couldn't get ideas just now. Try again in a moment."}
                  </p>
                )}
              </div>
            )}
            {ai.state === "loading" && (
              <div className="mt-3 space-y-3" aria-label="Loading ideas" role="status">
                {[0, 1, 2].map((i) => (
                  <RecipeCardSkeleton key={i} />
                ))}
              </div>
            )}
            {ai.state === "done" && (
              <ul className="mt-3 grid gap-3 lg:grid-cols-2">
                {aiAllowed.map((r) => (
                  <li key={r.id}>
                    <RecipeCard ranked={analyse(r)} {...planProps(r)} />
                  </li>
                ))}
              </ul>
            )}
            {ai.state === "done" && <FilteredNote hidden={aiHidden} total={ai.recipes.length} />}

            {libraryTerm && (
              <>
                <SectionTitle>More from the recipe library</SectionTitle>
                {lib?.term === libraryTerm && !lib.failed ? (
                  <>
                    <p className="-mt-1 mb-3 text-sm text-ink-2">Recipes using {libraryTerm.toLowerCase()}, from TheMealDB.</p>
                    {libAllowed.length === 0 ? (
                      <p className="text-sm text-ink-2">
                        {lib.recipes.length === 0 ? `Nothing in the library for ${libraryTerm.toLowerCase()} yet.` : "None of them suit your household."}
                      </p>
                    ) : (
                      <ul className="grid gap-3 lg:grid-cols-2">
                        {libAllowed.map((r) => (
                          <li key={r.id}>
                            <RecipeCard ranked={analyse(r)} {...planProps(r)} />
                          </li>
                        ))}
                      </ul>
                    )}
                    <FilteredNote hidden={libHidden} total={lib.recipes.length} />
                  </>
                ) : libLoading ? (
                  <div className="space-y-3" aria-label="Loading library recipes" role="status">
                    {[0, 1].map((i) => (
                      <RecipeCardSkeleton key={i} />
                    ))}
                  </div>
                ) : libFailed ? (
                  <p className="text-sm text-ink-2">The online recipe library can&apos;t be reached right now. Check your connection and try again later.</p>
                ) : (
                  <div className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
                    <p className="text-[15px] text-ink-2">Look up recipes that use {libraryTerm.toLowerCase()} on TheMealDB. This sends the ingredient name over the internet.</p>
                    <Button variant="secondary" className="mt-3" onClick={findOnline}>
                      <Globe size={18} aria-hidden /> Find more online
                    </Button>
                  </div>
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
                    <RecipeCard ranked={analyse(r)} warning={warningFor(r)} {...planProps(r)} />
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

/** Quiet note when recipes were dropped for the household's allergies, diets or dislikes. */
function FilteredNote({ hidden, total }: { hidden: number; total: number }) {
  if (hidden <= 0) return null;
  return (
    <p role="status" className="mt-3 flex items-start gap-2 text-sm text-ink-2">
      <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
      {hidden} of {total} {total === 1 ? "recipe was" : "recipes were"} hidden because of your household&apos;s diets, allergies or dislikes.
    </p>
  );
}
