"use client";

import { useMemo, useState } from "react";
import { Button, Sheet, Stepper, Switch, cx } from "@/components/ui";
import { StatusPill } from "@/components/freshness";
import { toast } from "@/components/toast";
import { useLarder } from "@/lib/store";
import { defaultDeduction, formatAmount, stepFor, tbspOf } from "@/lib/recipes/quantity";
import { formatQuantity } from "@/components/pantry/format";
import { getFoodType } from "@/lib/shelf-life/foods";
import { storageDays } from "@/lib/shelf-life/engine";
import type { RecipeUse } from "@/lib/recipes/suggest";
import type { DraftItem, PantryItem, Recipe } from "@/lib/types";
import { hasFoodData, recipeNutrition } from "@/lib/nutrition/engine";
import { scaleNutrients } from "@/lib/nutrition/nutrients";
import { useMealLog } from "@/lib/nutrition/meal-log";
import { toLocalISODate } from "@/lib/shelf-life/engine";

interface Props {
  open: boolean;
  onClose: () => void;
  recipe: Recipe;
  uses: RecipeUse[];
  /** servings scale factor applied on the detail page */
  factor: number;
}

export function CookSheet(props: Props) {
  // Re-mount on open/close so amounts re-prefill from the latest larder.
  return <CookSheetInner key={String(props.open)} {...props} />;
}

const QUICK: Array<{ label: string; fraction: number }> = [
  { label: "None", fraction: 0 },
  { label: "¼", fraction: 0.25 },
  { label: "½", fraction: 0.5 },
  { label: "All", fraction: 1 },
];

function CookSheetInner({ open, onClose, recipe, uses, factor }: Props) {
  const items = useLarder((s) => s.items);
  const cookRecipe = useLarder((s) => s.cookRecipe);

  const rows = useMemo(
    () =>
      uses
        .map((u) => {
          const item = items.find((i) => i.id === u.itemId);
          const ing = recipe.ingredients.find((i) => i.name === u.ingredient);
          return item && ing ? { use: u, item, ing } : null;
        })
        .filter((r): r is { use: RecipeUse; item: PantryItem; ing: Recipe["ingredients"][number] } => r !== null),
    [uses, items, recipe],
  );

  const [amounts, setAmounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(rows.map((r) => [r.item.id, defaultDeduction(r.ing, r.item, factor, tbspOf(recipe))])),
  );

  const changed = rows.filter((r) => (amounts[r.item.id] ?? 0) > 0);

  const [saveLeftovers, setSaveLeftovers] = useState(false);
  const leftoverFood = getFoodType("leftovers-meal");
  const leftoverDays = leftoverFood ? storageDays(leftoverFood, undefined, "fridge") : 3;

  // Nutrition: log how many servings you ate (only when the food database is in this build).
  const logMeal = useMealLog((s) => s.logMeal);
  const removeMeal = useMealLog((s) => s.removeMeal);
  // Only offer logging when we could actually work out some nutrition for this recipe.
  const nutrition = useMemo(() => (hasFoodData() ? recipeNutrition(recipe, recipe.servings) : null), [recipe]);
  const canLog = !!nutrition && nutrition.rows.some((r) => r.food && r.grams) && nutrition.coverage >= 0.5;
  const [logIt, setLogIt] = useState(canLog);
  const [ate, setAte] = useState(1);

  function logEaten(): string | null {
    if (!canLog || !nutrition || !logIt || ate <= 0) return null;
    const nut = nutrition;
    const per = 1 / Math.max(1, recipe.servings);
    const now = new Date();
    return logMeal({
      at: now.toISOString(),
      date: toLocalISODate(now),
      recipeId: recipe.id,
      title: recipe.title,
      servings: ate,
      perServing: nut.perServing,
      contributors: nut.rows.filter((r) => r.food && r.grams).map((r) => ({ name: r.ingredient.name, n: scaleNutrients(r.nutrients, per) })),
    });
  }

  function confirm() {
    const mealId = logEaten();
    const logged = mealId ? `Logged ${ate} serving${ate === 1 ? "" : "s"}` : "";
    const parts = changed.map((r) => {
      const left = Math.round((r.item.quantity - (amounts[r.item.id] ?? 0)) * 1000) / 1000;
      return left <= 0 ? `${r.item.name} used up` : `${r.item.name}: ${formatQuantity(left, r.item.unit)} left`;
    });
    const summary = parts.length > 2 ? `${parts.slice(0, 2).join(", ")} and ${parts.length - 2} more updated` : parts.join(", ");

    let leftovers: DraftItem | undefined;
    if (saveLeftovers) {
      leftovers = {
        key: "leftovers",
        name: `Leftovers – ${recipe.title}`,
        foodTypeId: leftoverFood?.id ?? "leftovers-meal",
        emoji: leftoverFood?.emoji ?? "🍲",
        locationId: "fridge",
        quantity: 1,
        unit: "item",
        dateKind: leftoverFood?.dateKind ?? "use-by",
        include: true,
      };
    }
    if (changed.length > 0 || leftovers) {
      cookRecipe(
        recipe,
        changed.map((r) => ({ itemId: r.item.id, quantity: amounts[r.item.id] })),
        leftovers,
      );
      const tail = leftovers ? `Leftovers saved in the fridge for ${leftoverDays} days` : "";
      const message = [summary, tail, logged].filter(Boolean).join(". ");
      if (mealId) {
        // One Undo puts back the larder and takes the meal off the log.
        const undoId = useLarder.getState().undo?.id;
        toast(message, {
          action: {
            label: "Undo",
            onClick: () => {
              if (undoId) useLarder.getState().performUndo(undoId);
              removeMeal(mealId);
            },
          },
        });
      } else {
        toast(message, { undoable: true });
      }
    } else if (mealId) {
      toast(`Logged ${ate} serving${ate === 1 ? "" : "s"} of ${recipe.title}`, { action: { label: "Undo", onClick: () => removeMeal(mealId) } });
    } else {
      toast("Enjoy! Nothing in your larder changed.");
    }
    onClose();
  }

  const willLog = canLog && logIt && ate > 0;
  const actions = [
    changed.length > 0 ? `update ${changed.length} ${changed.length === 1 ? "item" : "items"}` : "",
    saveLeftovers ? "save leftovers" : "",
    willLog ? `log ${ate} ${ate === 1 ? "serving" : "servings"}` : "",
  ].filter(Boolean);
  const footerLabel = actions.length
    ? (actions.length > 1 ? `${actions.slice(0, -1).join(", ")} and ${actions[actions.length - 1]}` : actions[0]).replace(/^./, (c) => c.toUpperCase())
    : "Done, change nothing";

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Finished cooking?"
      footer={
        <Button block size="lg" onClick={confirm}>
          {footerLabel}
        </Button>
      }
    >
      {canLog && (
        <section aria-label="Nutrition" className="mb-2 border-b border-line">
          <Switch checked={logIt} onChange={setLogIt} label="Log what I ate" description="Adds it to today's nutrition. Only on this device." />
          {logIt && (
            <div className="flex items-center justify-between gap-3 pb-3">
              <span className="text-[15px] text-ink-2">Servings I ate</span>
              <Stepper label="servings eaten" value={ate} step={0.5} min={0.5} onChange={(v) => setAte(Math.max(0.5, v))} />
            </div>
          )}
        </section>
      )}
      {rows.length === 0 ? (
        <p className="py-6 text-[15px] text-ink-2">
          Nothing in your larder matches this recipe, so there is nothing to take off.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-2">
            We&apos;ve estimated what you used from the recipe. Adjust anything that&apos;s off and we&apos;ll update your larder.
          </p>
          <ul className="divide-y divide-line">
            {rows.map(({ use, item }) => {
              const value = amounts[item.id] ?? 0;
              const set = (v: number) => setAmounts((a) => ({ ...a, [item.id]: Math.min(item.quantity, Math.max(0, v)) }));
              return (
                <li key={item.id} className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">
                        <span aria-hidden>{item.emoji}</span> {item.name}
                      </p>
                      <p className="text-sm text-ink-2">
                        {formatAmount(item.quantity, item.unit)} {item.quantity === 1 && item.unit === "item" ? "" : "in your larder"}
                      </p>
                    </div>
                    <StatusPill status={use.status} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <div role="group" aria-label={`How much ${item.name}`} className="flex gap-1.5">
                      {QUICK.map((q) => {
                        const target = Math.round(item.quantity * q.fraction * 100) / 100;
                        const selected = Math.abs(value - target) < 0.005;
                        return (
                          <button
                            key={q.label}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => set(target)}
                            className={cx(
                              "h-11 min-w-12 rounded-full border px-3 text-sm font-semibold transition-colors",
                              selected ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface text-ink-2 hover:text-ink",
                            )}
                          >
                            {q.label}
                          </button>
                        );
                      })}
                    </div>
                    <Stepper
                      label={`${item.name} used`}
                      value={Math.round(value * 100) / 100}
                      step={stepFor(item.unit)}
                      onChange={set}
                      suffix={item.unit === "item" ? undefined : item.unit}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <div className="mt-2 border-t border-line">
        <Switch
          checked={saveLeftovers}
          onChange={setSaveLeftovers}
          label="Save leftovers"
          description={`Adds “Leftovers – ${recipe.title}” to the fridge, good for ${leftoverDays} days.`}
        />
      </div>
    </Sheet>
  );
}
