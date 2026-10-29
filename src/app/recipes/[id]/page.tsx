"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Bookmark, BookmarkCheck, CalendarPlus, ChevronLeft, CircleAlert, Clock, ExternalLink, ShoppingBasket, Users, ChefHat } from "lucide-react";
import { Button, Card, EmptyState, Field, Input, SectionTitle, Sheet, Stepper, buttonClass, cx } from "@/components/ui";
import { StatusPill, STATUS_META } from "@/components/freshness";
import { toast } from "@/components/toast";
import { CookSheet } from "@/components/recipes/cook-sheet";
import { getBuiltinRecipe } from "@/lib/recipes/builtin";
import { readCachedRecipe, cacheRecipes } from "@/lib/recipes/cache";
import { formatAmount, scaleIngredient } from "@/lib/recipes/quantity";
import { allergenHits, analyseRecipe, dislikeHits, exclusionReason, isStaple } from "@/lib/recipes/suggest";
import { getFoodType } from "@/lib/shelf-life/foods";
import { toLocalISODate } from "@/lib/shelf-life/engine";
import { useItemViews } from "@/lib/selectors";
import { useLarder } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";
import type { Recipe } from "@/lib/types";

export default function RecipeDetailPage() {
  return (
    <Suspense fallback={null}>
      <RecipeLoader />
    </Suspense>
  );
}

function RecipeLoader() {
  const hydrated = useHydrated();
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const saved = useLarder((s) => s.savedRecipes);

  const local = useMemo<Recipe | null>(
    () => (hydrated ? (getBuiltinRecipe(id) ?? saved.find((r) => r.id === id) ?? readCachedRecipe(id)) : null),
    [hydrated, id, saved],
  );
  // Database recipes can be re-fetched when opened from a bookmark or a fresh tab.
  const [fetched, setFetched] = useState<{ id: string; recipe: Recipe | null } | null>(null);
  useEffect(() => {
    if (!hydrated || local || !id.startsWith("db-")) return;
    let live = true;
    fetch(`/api/recipes/search?id=${encodeURIComponent(id.slice(3))}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { recipes: Recipe[] }) => {
        if (!live) return;
        cacheRecipes(d.recipes);
        setFetched({ id, recipe: d.recipes[0] ?? null });
      })
      .catch(() => live && setFetched({ id, recipe: null }));
    return () => {
      live = false;
    };
  }, [hydrated, local, id]);

  const recipe = local ?? (fetched?.id === id ? fetched.recipe : null);
  const loading = !hydrated || (!local && id.startsWith("db-") && fetched?.id !== id);

  if (loading) {
    return (
      <div className="animate-pulse px-5 pt-8 lg:px-0" aria-hidden>
        <div className="h-10 w-3/4 rounded-xl bg-surface-2" />
        <div className="mt-4 h-5 w-1/3 rounded bg-surface-2" />
        <div className="mt-8 h-40 rounded-3xl bg-surface-2" />
      </div>
    );
  }
  if (!recipe) {
    return (
      <EmptyState
        emoji="🍽️"
        title="We can't find that recipe"
        body="Ideas from the AI helper only last for this visit unless you save them. Head back and find it again."
        action={
          <Link href="/recipes" className={buttonClass("primary")}>
            Back to recipes
          </Link>
        }
      />
    );
  }
  return <RecipeDetail recipe={recipe} />;
}

function RecipeDetail({ recipe }: { recipe: Recipe }) {
  const views = useItemViews();
  const savedRecipes = useLarder((s) => s.savedRecipes);
  const saveRecipe = useLarder((s) => s.saveRecipe);
  const unsaveRecipe = useLarder((s) => s.unsaveRecipe);
  const addToList = useLarder((s) => s.addToList);
  const planMeal = useLarder((s) => s.planMeal);
  const plannerOn = useLarder((s) => s.settings.mealPlannerEnabled);
  const profile = useLarder((s) => s.profile);
  const defaultPeople = profile.people;
  const router = useRouter();
  const planParam = useSearchParams().get("plan");

  const isSaved = savedRecipes.some((r) => r.id === recipe.id);
  // Scale to the household by default; the recipe's own serving count is shown beside it.
  const [servings, setServings] = useState(() => Math.max(1, defaultPeople));
  const [cookOpen, setCookOpen] = useState(false);
  const planPrefill = planParam && /^\d{4}-\d{2}-\d{2}$/.test(planParam) ? planParam : null;
  const [planOpen, setPlanOpen] = useState(false);
  const [planDate, setPlanDate] = useState(() => planPrefill ?? toLocalISODate(new Date()));

  const hits = useMemo(() => allergenHits(recipe, profile), [recipe, profile]);
  const dislikes = useMemo(() => dislikeHits(recipe, profile), [recipe, profile]);
  const dietNote = useMemo(() => (hits.length === 0 && dislikes.length === 0 ? exclusionReason(recipe, profile) : null), [recipe, profile, hits.length, dislikes.length]);

  const factor = servings / recipe.servings;
  const analysis = useMemo(() => analyseRecipe(recipe, views), [recipe, views]);
  const useByIngredient = new Map(analysis.uses.map((u) => [u.ingredient, u]));
  const missingNames = new Set(analysis.missing.map((m) => m.name));

  function addMissing() {
    const entries = analysis.missing.map((m) => {
      const s = scaleIngredient(m, factor);
      const name = getFoodType(m.foodTypeId)?.name ?? capitalise(m.name);
      return { name, foodTypeId: m.foodTypeId ?? null, quantity: s.quantity, unit: s.unit, reason: "recipe" as const, recipeId: recipe.id };
    });
    addToList(entries);
    toast(`Added ${entries.length} ${entries.length === 1 ? "item" : "items"} to your list`);
  }

  return (
    <article className="px-5 pb-10 pt-[calc(1rem+env(safe-area-inset-top))] lg:px-0 lg:pt-8">
      <Link href="/recipes" className="-ml-2 inline-flex h-11 items-center gap-1 rounded-full px-2 text-sm font-medium text-ink-2 hover:text-ink">
        <ChevronLeft size={18} aria-hidden /> Recipes
      </Link>

      <header className="mt-2">
        {recipe.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={recipe.image} alt="" className="mb-5 aspect-[16/9] w-full rounded-3xl bg-surface-2 object-cover lg:max-h-72" />
        )}
        {hits.length > 0 && (
          <div role="alert" className="mb-4 flex items-start gap-3 rounded-2xl border border-spoiled bg-spoiled-soft p-4 text-ink">
            <CircleAlert size={22} className="mt-0.5 shrink-0 text-spoiled" aria-hidden />
            <div>
              <p className="font-semibold">Contains an allergen in your household</p>
              <ul className="mt-1 text-[15px]">
                {hits.map((h) => (
                  <li key={h.allergy}>
                    {capitalise(h.allergy)}: <span className="font-medium">{h.ingredient.toLowerCase()}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-sm text-ink-2">Check the labels and swap this out before cooking, or pick another recipe.</p>
            </div>
          </div>
        )}
        {hits.length === 0 && (dislikes.length > 0 || dietNote) && (
          <p className="mb-4 flex items-start gap-2 rounded-2xl bg-soon-soft p-3 text-sm text-ink">
            <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
            {dislikes.length > 0 ? `Has ${dislikes.join(", ")}, which your household dislikes.` : `${dietNote}. This doesn't fit your household's diet.`}
          </p>
        )}
        <h1 className="font-display text-4xl leading-[1.1] text-ink lg:text-5xl">{recipe.title}</h1>
        {recipe.summary && <p className="mt-3 max-w-2xl text-lg text-ink-2">{recipe.summary}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 text-[15px] text-ink-2">
          {recipe.minutes && (
            <span className="inline-flex items-center gap-1.5">
              <Clock size={16} aria-hidden /> {recipe.minutes} min
            </span>
          )}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Users size={16} aria-hidden /> Serves
            <Stepper label="servings" value={servings} min={1} onChange={(v) => setServings(Math.max(1, Math.round(v)))} />
            <span className="whitespace-nowrap text-sm text-ink-3">Recipe serves {recipe.servings}</span>
            {servings !== recipe.servings && (
              <button type="button" className="inline-flex h-11 items-center whitespace-nowrap text-sm font-medium text-primary hover:underline" onClick={() => setServings(recipe.servings)}>
                Use {recipe.servings}
              </button>
            )}
          </div>
        </div>
        {recipe.tags.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Tags">
            {recipe.tags.slice(0, 6).map((t) => (
              <li key={t} className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-ink-2">
                {t}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <Button size="lg" onClick={() => setCookOpen(true)} className="w-full sm:w-auto">
            <ChefHat size={20} aria-hidden /> I cooked this
          </Button>
          <Button
            variant="secondary"
            size="lg"
            aria-pressed={isSaved}
            onClick={() => {
              if (isSaved) {
                unsaveRecipe(recipe.id);
                toast("Removed from saved recipes");
              } else {
                saveRecipe(recipe);
                toast("Saved to your recipes");
              }
            }}
          >
            {isSaved ? <BookmarkCheck size={20} aria-hidden /> : <Bookmark size={20} aria-hidden />} {isSaved ? "Saved" : "Save"}
          </Button>
          {plannerOn && (
            <Button variant="secondary" size="lg" onClick={() => setPlanOpen(true)}>
              <CalendarPlus size={20} aria-hidden /> Add to plan
            </Button>
          )}
        </div>
      </header>

      <div className="mt-8 grid gap-x-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <section aria-labelledby="ingredients-h">
          <SectionTitle>
            <span id="ingredients-h">Ingredients</span>
          </SectionTitle>
          <Card>
            <ul className="divide-y divide-line">
              {recipe.ingredients.map((ing, i) => {
                const s = scaleIngredient(ing, factor);
                const use = useByIngredient.get(ing.name);
                const missing = missingNames.has(ing.name);
                return (
                  <li key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-[15px] text-ink">
                        {ing.name}
                        {ing.optional && <span className="text-ink-3"> (optional)</span>}
                      </p>
                      {s.quantity !== undefined && <p className="text-sm text-ink-2">{formatAmount(s.quantity, s.unit)}</p>}
                    </div>
                    {use ? (
                      <StatusPill status={use.status}>In larder{use.status !== "fresh" ? ` · ${STATUS_META[use.status].label.toLowerCase()}` : ""}</StatusPill>
                    ) : missing ? (
                      <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-ink-2">Missing</span>
                    ) : isStaple(ing) ? (
                      <span className="shrink-0 text-xs text-ink-3">Pantry staple</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Card>
          {analysis.missing.length > 0 ? (
            <Button variant="secondary" block className="mt-3" onClick={addMissing}>
              <ShoppingBasket size={18} aria-hidden /> Add {analysis.missing.length} missing to list
            </Button>
          ) : (
            <p className="mt-3 text-sm text-ink-2">You have everything you need.</p>
          )}
        </section>

        <section aria-labelledby="method-h" className="mt-8 lg:mt-0">
          <SectionTitle>
            <span id="method-h">Method</span>
          </SectionTitle>
          <ol className="space-y-5">
            {recipe.steps.map((step, i) => (
              <li key={i} className="flex gap-4">
                <span
                  aria-hidden
                  className={cx("flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft font-display text-base text-primary")}
                >
                  {i + 1}
                </span>
                <p className="pt-0.5 text-[16px] leading-relaxed text-ink">{step}</p>
              </li>
            ))}
          </ol>
          {recipe.sourceUrl && (
            <p className="mt-6 text-sm text-ink-3">
              <a href={recipe.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
                Original recipe <ExternalLink size={12} aria-hidden />
              </a>
              {recipe.source === "database" && " (TheMealDB)"}
            </p>
          )}
        </section>
      </div>

      <CookSheet open={cookOpen} onClose={() => setCookOpen(false)} recipe={recipe} uses={analysis.uses} factor={factor} />

      <Sheet
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        title="Add to plan"
        footer={
          <Button
            block
            size="lg"
            onClick={() => {
              planMeal(planDate, { ...recipe, servings });
              setPlanOpen(false);
              toast(`Planned ${recipe.title}`, { action: { label: "View plan", onClick: () => router.push("/plan") } });
            }}
          >
            Add to plan
          </Button>
        }
      >
        <div className="py-2">
          <Field label="Which day?">{(id) => <Input id={id} type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} />}</Field>
        </div>
      </Sheet>
    </article>
  );
}

function capitalise(text: string): string {
  const t = text.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
