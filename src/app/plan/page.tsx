"use client";

import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useLarder } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";
import { useNow } from "@/lib/use-now";
import { addDays, startOfDay, toLocalISODate } from "@/lib/shelf-life/engine";
import { getFoodType, matchFoodType } from "@/lib/shelf-life/foods";
import type { Recipe, RecipeIngredient } from "@/lib/types";
import { Button, Card, EmptyState, IconButton, PageHeader, buttonClass, cx } from "@/components/ui";
import { toast } from "@/components/toast";

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

/** Ingredients a set of recipes needs that the larder doesn't have, matched by food type. */
function missingIngredients(
  recipes: Recipe[],
  larderFoodIds: Set<string>,
  larderNames: Set<string>,
): Array<RecipeIngredient & { foodTypeId: string | null; recipeId: string }> {
  const out: Array<RecipeIngredient & { foodTypeId: string | null; recipeId: string }> = [];
  const seen = new Set<string>();
  for (const r of recipes) {
    for (const ing of r.ingredients) {
      if (ing.optional) continue;
      const foodId = ing.foodTypeId ?? (() => {
        const m = matchFoodType(ing.name);
        return m && m.confidence !== "low" ? m.food.id : null;
      })();
      const key = foodId ?? ing.name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const have = foodId ? larderFoodIds.has(foodId) : larderNames.has(key);
      if (have) continue;
      out.push({ ...ing, foodTypeId: foodId, recipeId: r.id });
    }
  }
  return out;
}

export default function PlanPage() {
  const hydrated = useHydrated();
  const enabled = useLarder((s) => s.settings.mealPlannerEnabled);
  const setSettings = useLarder((s) => s.setSettings);
  const mealPlan = useLarder((s) => s.mealPlan);
  const savedRecipes = useLarder((s) => s.savedRecipes);
  const items = useLarder((s) => s.items);
  const unplanMeal = useLarder((s) => s.unplanMeal);
  const addToList = useLarder((s) => s.addToList);
  const shoppingList = useLarder((s) => s.shoppingList);

  const [weekOffset, setWeekOffset] = useState(0);
  const now = useNow();
  const today = useMemo(() => startOfDay(new Date(now)), [now]);
  const monday = useMemo(() => addDays(startOfWeek(today), weekOffset * 7), [today, weekOffset]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(monday, i)), [monday]);

  const recipeById = useMemo(() => new Map(savedRecipes.map((r) => [r.id, r])), [savedRecipes]);

  const weekEntries = useMemo(() => {
    const from = toLocalISODate(monday);
    const to = toLocalISODate(addDays(monday, 6));
    return mealPlan.filter((m) => m.date >= from && m.date <= to);
  }, [mealPlan, monday]);

  const missing = useMemo(() => {
    const recipes = weekEntries.map((m) => recipeById.get(m.recipeId)).filter((r): r is Recipe => !!r);
    const ids = new Set(items.map((i) => i.foodTypeId).filter((x): x is string => !!x));
    const names = new Set(items.map((i) => i.name.trim().toLowerCase()));
    const all = missingIngredients(recipes, ids, names);
    // Skip anything already waiting on the list.
    const listed = new Set(shoppingList.filter((l) => !l.checked).map((l) => l.foodTypeId ?? l.name.toLowerCase()));
    return all.filter((m) => !listed.has(m.foodTypeId ?? m.name.trim().toLowerCase()));
  }, [weekEntries, recipeById, items, shoppingList]);

  const addMissing = () => {
    if (missing.length === 0) return;
    addToList(
      missing.map((m) => {
        const food = getFoodType(m.foodTypeId);
        return {
          name: food?.name ?? m.name,
          foodTypeId: m.foodTypeId,
          aisle: food?.aisle,
          quantity: m.quantity,
          unit: m.unit,
          reason: "plan" as const,
          recipeId: m.recipeId,
        };
      }),
    );
    toast(`Added ${missing.length} ingredient${missing.length === 1 ? "" : "s"} to the list`);
  };

  if (!hydrated) {
    return (
      <div>
        <PageHeader title="Meal plan" subtitle=" " />
        <div className="space-y-3 px-5 lg:px-0" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-surface-2" />
          ))}
        </div>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div>
        <PageHeader title="Meal plan" showSettings />
        <div className="px-5 lg:px-0">
          <EmptyState
            emoji="📅"
            title="The meal planner is off"
            body="Plan a week of dinners from your saved recipes, then add whatever you're missing to the shopping list in one go. It's optional, and you can turn it off again in Settings."
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
        </div>
      </div>
    );
  }

  const plannedCount = weekEntries.length;
  const weekName =
    weekOffset === 0 ? "This week" : weekOffset === 1 ? "Next week" : weekOffset === -1 ? "Last week" : "Week of";
  const weekButton = "h-11 w-11 border border-line bg-surface shadow-card hover:border-primary";

  return (
    <div className="lg:pb-8">
      <PageHeader title="Meal plan" subtitle="Dinners for the week, and a list for what's missing." showSettings />

      <div className="px-5 lg:px-0">
        {/* Week switcher: visible circles either side of the week name. */}
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
            <p className="text-sm text-ink-2">
              Nothing planned this week. Pick something from{" "}
              <Link href="/recipes" className="font-semibold text-primary underline-offset-2 hover:underline">
                Recipes
              </Link>{" "}
              and plan it for a day.
            </p>
          ) : missing.length === 0 ? (
            <p className="text-sm text-ink-2">
              You have everything for this week&apos;s {plannedCount} meal{plannedCount === 1 ? "" : "s"}, or it&apos;s
              already on the list.
            </p>
          ) : (
            <>
              <p className="mb-3 text-sm text-ink-2">
                {missing.length} ingredient{missing.length === 1 ? "" : "s"} for this week&apos;s meals{" "}
                {missing.length === 1 ? "isn't" : "aren't"} in the larder:{" "}
                <span className="text-ink">
                  {missing
                    .slice(0, 5)
                    .map((m) => getFoodType(m.foodTypeId)?.name ?? m.name)
                    .join(", ")}
                  {missing.length > 5 ? ` and ${missing.length - 5} more` : ""}
                </span>
                .
              </p>
              <Button onClick={addMissing} className="w-full sm:w-auto">
                Add {missing.length} missing ingredient{missing.length === 1 ? "" : "s"} to the list
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
              <h2
                className={cx(
                  "flex items-center gap-2 font-display text-lg",
                  isToday ? "text-primary" : isPast ? "text-ink-3" : "text-ink",
                )}
              >
                {DAY_NAMES[i]}
                {isToday && (
                  <span className="rounded-full bg-primary px-2 py-0.5 font-sans text-[11px] font-semibold leading-4 text-primary-ink">
                    Today
                  </span>
                )}
              </h2>
            );
            if (entries.length === 0) {
              // Nothing planned: one compact row, so a quiet week doesn't become seven tall cards.
              return (
                <li key={iso}>
                  <Card className={cx("flex items-center gap-3 py-1 pl-4 pr-1", isToday && "border-primary ring-1 ring-primary")}>
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      {heading}
                      <span className="text-sm tabular-nums text-ink-3">{shortDate(d)}</span>
                    </div>
                    <Link
                      href={addHref}
                      className="flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-primary hover:bg-surface-2"
                    >
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
                      const r = recipeById.get(m.recipeId);
                      return (
                        <div key={m.id} className="flex items-center gap-2 pl-2">
                          <span aria-hidden className="text-lg">
                            🍽️
                          </span>
                          <span className="min-w-0 flex-1 py-2">
                            <span className="block truncate text-[15px] font-medium text-ink">
                              {r?.title ?? "A recipe that's no longer saved"}
                            </span>
                            {r && (
                              <span className="block text-xs text-ink-3">
                                {r.servings} serve{r.servings === 1 ? "" : "s"}
                                {r.minutes ? ` · ${r.minutes} min` : ""}
                              </span>
                            )}
                          </span>
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
                    <Link
                      href={addHref}
                      className="flex h-11 items-center gap-2 rounded-xl px-2 text-sm font-medium text-primary hover:bg-surface-2"
                    >
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
      </div>
    </div>
  );
}
