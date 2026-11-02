"use client";

import Link from "next/link";
import { CalendarDays, Check, ChefHat, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLarder } from "@/lib/store";
import { useNow } from "@/lib/use-now";
import { useItemViews } from "@/lib/selectors";
import { addDays, startOfDay, toLocalISODate } from "@/lib/shelf-life/engine";
import { cacheRecipes, refetchUrl } from "@/lib/recipes/cache";
import { resolveRecipe } from "@/lib/recipes/resolve";
import { planShoppingNeeds } from "@/lib/recipes/plan";
import { analyseRecipe } from "@/lib/recipes/suggest";
import type { MealPlanEntry, Recipe } from "@/lib/types";
import { Button, Card, EmptyState, IconButton, buttonClass, cx } from "@/components/ui";
import { toast } from "@/components/toast";
import { CookSheet } from "./cook-sheet";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Monday of the week containing d (Australian weeks start on Monday). */
function startOfWeek(d: Date): Date {
  const s = startOfDay(d);
  const offset = (s.getDay() + 6) % 7; // Mon=0 … Sun=6
  return addDays(s, -offset);
}

function shortDate(d: Date): string {
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function weekLabel(monday: Date): string {
  const sunday = addDays(monday, 6);
  const sameMonth = monday.getMonth() === sunday.getMonth();
  const left = sameMonth ? String(monday.getDate()) : shortDate(monday);
  return `${left} – ${shortDate(sunday)}`;
}

/** Library recipes planned before they were kept as a copy: fetch them again by id. */
function useFetchedRecipes(ids: string[]): Map<string, Recipe> {
  const [fetched, setFetched] = useState<Map<string, Recipe>>(() => new Map());
  const key = ids.join(",");
  useEffect(() => {
    if (!key) return;
    let live = true;
    for (const id of key.split(",")) {
      const url = refetchUrl(id);
      if (!url) continue;
      fetch(url)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d: { recipes: Recipe[] }) => {
          if (!live || !d.recipes[0]) return;
          cacheRecipes(d.recipes);
          setFetched((m) => new Map(m).set(id, d.recipes[0]));
        })
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [key]);
  return fetched;
}

/** The week's dinners: open or cook each one, and shop for what's missing. */
export function PlanView() {
  const enabled = useLarder((s) => s.settings.mealPlannerEnabled);
  const setSettings = useLarder((s) => s.setSettings);
  const mealPlan = useLarder((s) => s.mealPlan);
  const savedRecipes = useLarder((s) => s.savedRecipes);
  const people = useLarder((s) => s.profile.people);
  const unplanMeal = useLarder((s) => s.unplanMeal);
  const setPlanCooked = useLarder((s) => s.setPlanCooked);
  const addToList = useLarder((s) => s.addToList);
  const shoppingList = useLarder((s) => s.shoppingList);
  const views = useItemViews();

  const [weekOffset, setWeekOffset] = useState(0);
  const now = useNow();
  const today = useMemo(() => startOfDay(new Date(now)), [now]);
  const monday = useMemo(() => addDays(startOfWeek(today), weekOffset * 7), [today, weekOffset]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);

  const weekEntries = useMemo(() => {
    const from = toLocalISODate(monday);
    const to = toLocalISODate(addDays(monday, 6));
    return mealPlan.filter((m) => m.date >= from && m.date <= to);
  }, [mealPlan, monday]);

  const local = useMemo(() => new Map(weekEntries.map((m) => [m.recipeId, resolveRecipe(m.recipeId, savedRecipes, mealPlan)])), [weekEntries, savedRecipes, mealPlan]);
  const toFetch = useMemo(() => [...local].filter(([, r]) => !r).map(([id]) => id).filter((id) => refetchUrl(id)), [local]);
  const fetched = useFetchedRecipes(toFetch);
  const recipeFor = (m: MealPlanEntry) => local.get(m.recipeId) ?? fetched.get(m.recipeId) ?? null;
  const servingsFor = (m: MealPlanEntry, r: Recipe) => m.servings ?? r.servings ?? people;

  // Only meals from today on, not cooked yet, still need shopping (last Monday's skipped dinner doesn't).
  const needs = useMemo(() => {
    const todayISO = toLocalISODate(today);
    const meals = weekEntries
      .filter((m) => !m.cookedAt && m.date >= todayISO)
      .map((m) => {
        const r = local.get(m.recipeId) ?? fetched.get(m.recipeId);
        return r ? { recipe: r, servings: m.servings ?? r.servings } : null;
      })
      .filter((x): x is { recipe: Recipe; servings: number } => !!x);
    // Views, so food past its use-by doesn't count as on hand.
    return planShoppingNeeds(meals, views, shoppingList);
  }, [weekEntries, local, fetched, views, shoppingList, today]);

  const addMissing = () => {
    if (needs.length === 0) return;
    addToList(needs.map((n) => ({ name: n.name, foodTypeId: n.foodTypeId, quantity: n.quantity, unit: n.unit, note: n.note, reason: "plan" as const, recipeId: n.recipeIds[0] })));
    toast(`Added ${needs.length} ${needs.length === 1 ? "item" : "items"} to the list`);
  };

  const [cooking, setCooking] = useState<{ entry: MealPlanEntry; recipe: Recipe } | null>(null);
  const cookingAnalysis = useMemo(() => (cooking ? analyseRecipe(cooking.recipe, views) : null), [cooking, views]);

  if (!enabled) {
    return (
      <EmptyState
        emoji="📅"
        title="The meal planner is off"
        body="Plan the week's dinners, then add whatever you're missing to the shopping list in one go. You can turn it off again in Settings."
        action={
          <Button
            size="lg"
            onClick={() => {
              setSettings({ mealPlannerEnabled: true });
              toast("Meal planner turned on");
            }}
          >
            Turn on the meal planner
          </Button>
        }
      />
    );
  }

  const plannedCount = weekEntries.length;
  const weekName = weekOffset === 0 ? "This week" : weekOffset === 1 ? "Next week" : weekOffset === -1 ? "Last week" : "Week of";
  const weekButton = "h-11 w-11 border border-line bg-surface shadow-card hover:border-primary";

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <IconButton label="Previous week" onClick={() => setWeekOffset((w) => w - 1)} className={weekButton}>
          <ChevronLeft size={22} />
        </IconButton>
        <div className="min-w-0 flex-1 text-center" aria-live="polite">
          <p className="font-display text-xl leading-tight text-ink">{weekName}</p>
          <p className="text-sm tabular-nums text-ink-2">
            <CalendarDays size={14} aria-hidden className="mr-1.5 inline-block align-[-2px]" />
            {weekLabel(monday)}
          </p>
        </div>
        <IconButton label="Next week" onClick={() => setWeekOffset((w) => w + 1)} className={weekButton}>
          <ChevronRight size={22} />
        </IconButton>
      </div>
      {weekOffset !== 0 && (
        <div className="mb-4 text-center">
          <Button variant="ghost" size="sm" onClick={() => setWeekOffset(0)}>
            Back to this week
          </Button>
        </div>
      )}

      <div className="mb-5 rounded-[var(--radius-card)] bg-surface-2 p-4">
        {plannedCount === 0 ? (
          <p className="text-sm text-ink-2">Nothing planned yet. Tap “Add a meal” on a day to pick a recipe for it.</p>
        ) : needs.length === 0 ? (
          <p className="text-sm text-ink-2">
            You have what this week&apos;s {plannedCount} meal{plannedCount === 1 ? "" : "s"} need{plannedCount === 1 ? "s" : ""}, apart from pantry staples, or it&apos;s already on the list.
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-ink-2">
              For this week&apos;s meals you&apos;re short of{" "}
              <span className="text-ink">
                {needs
                  .slice(0, 5)
                  .map((n) => n.name.toLowerCase())
                  .join(", ")}
                {needs.length > 5 ? ` and ${needs.length - 5} more` : ""}
              </span>
              . Pantry staples aren&apos;t included.
            </p>
            <Button onClick={addMissing} className="w-full sm:w-auto">
              Add {needs.length} {needs.length === 1 ? "item" : "items"} to the list
            </Button>
          </>
        )}
      </div>

      <ol className="flex flex-col gap-2.5" aria-label="Days of the week">
        {days.map((d, i) => {
          const iso = toLocalISODate(d);
          const isToday = d.getTime() === today.getTime();
          const isPast = d < today;
          const entries = weekEntries.filter((m) => m.date === iso);
          const addHref = `/recipes?plan=${iso}`;
          const heading = (
            <h2 className={cx("flex items-center gap-2 font-display text-lg", isToday ? "text-primary" : isPast ? "text-ink-3" : "text-ink")}>
              {DAY_NAMES[i]}
              {isToday && <span className="rounded-full bg-primary px-2 py-0.5 font-sans text-[11px] font-semibold leading-4 text-primary-ink">Today</span>}
            </h2>
          );
          if (entries.length === 0) {
            return (
              <li key={iso}>
                <Card className={cx("flex items-center gap-3 py-1 pl-4 pr-1", isToday && "border-primary ring-1 ring-primary")}>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {heading}
                    <span className="text-sm tabular-nums text-ink-3">{shortDate(d)}</span>
                  </div>
                  <Link href={addHref} className="flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-primary hover:bg-surface-2">
                    <Plus size={16} aria-hidden />
                    Add a meal
                    <span className="sr-only"> for {DAY_NAMES[i]}</span>
                  </Link>
                </Card>
              </li>
            );
          }
          return (
            <li key={iso}>
              <Card className={cx("overflow-hidden", isToday && "border-primary ring-1 ring-primary")}>
                <div className="flex items-center justify-between gap-3 px-4 pt-3">
                  {heading}
                  <span className="text-sm tabular-nums text-ink-3">{shortDate(d)}</span>
                </div>
                <div className="px-2 pb-2 pt-1">
                  {entries.map((m) => {
                    const r = recipeFor(m);
                    const serves = r ? servingsFor(m, r) : m.servings;
                    const title = r?.title ?? (toFetch.includes(m.recipeId) ? "Loading recipe…" : "A recipe that's no longer available");
                    const href = `/recipes/${encodeURIComponent(m.recipeId)}?planEntry=${encodeURIComponent(m.id)}${serves ? `&servings=${serves}` : ""}`;
                    return (
                      <div key={m.id} className="flex items-center gap-1 pl-2">
                        {r ? (
                          <Link href={href} className="min-w-0 flex-1 rounded-xl py-2 pr-2 hover:bg-surface-2">
                            <span className={cx("block truncate text-[15px] font-medium", m.cookedAt ? "text-ink-2" : "text-ink")}>{title}</span>
                            <span className="block text-xs text-ink-3">
                              {m.cookedAt ? "Cooked · " : ""}For {serves}
                              {r.minutes ? ` · ${r.minutes} min` : ""}
                            </span>
                          </Link>
                        ) : (
                          <span className="min-w-0 flex-1 py-2 text-[15px] text-ink-2">{title}</span>
                        )}
                        {r && !m.cookedAt && (
                          <button
                            type="button"
                            onClick={() => setCooking({ entry: m, recipe: r })}
                            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-sm font-semibold text-primary hover:bg-surface-2"
                          >
                            <ChefHat size={16} aria-hidden /> Cooked<span className="sr-only"> {title}</span>
                          </button>
                        )}
                        {m.cookedAt && (
                          <span className="inline-flex h-10 shrink-0 items-center gap-1 px-2 text-sm font-semibold text-fresh">
                            <Check size={16} aria-hidden /> Done
                          </span>
                        )}
                        <IconButton
                          label={`Remove ${r?.title ?? "meal"} from ${DAY_NAMES[i]}`}
                          onClick={() => {
                            unplanMeal(m.id);
                            toast(`Removed ${r?.title ?? "meal"} from ${DAY_NAMES[i]}`);
                          }}
                          className="h-10 w-10"
                        >
                          <X size={18} />
                        </IconButton>
                      </div>
                    );
                  })}
                  <Link href={addHref} className="flex h-11 items-center gap-2 rounded-xl px-2 text-sm font-medium text-primary hover:bg-surface-2">
                    <Plus size={16} aria-hidden />
                    Add another meal
                    <span className="sr-only"> for {DAY_NAMES[i]}</span>
                  </Link>
                </div>
              </Card>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 text-center">
        <Link href="/settings" className={buttonClass("ghost", "sm")}>
          Meal planner settings
        </Link>
      </div>

      {cooking && cookingAnalysis && (
        <CookSheet
          open
          onClose={() => setCooking(null)}
          recipe={cooking.recipe}
          uses={cookingAnalysis.uses}
          factor={servingsFor(cooking.entry, cooking.recipe) / Math.max(1, cooking.recipe.servings)}
          onCooked={() => setPlanCooked(cooking.entry.id, true)}
        />
      )}
    </div>
  );
}
