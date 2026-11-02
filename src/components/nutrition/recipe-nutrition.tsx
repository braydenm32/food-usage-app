"use client";

import { useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { Card, SectionTitle, cx } from "@/components/ui";
import { toast } from "@/components/toast";
import { hasFoodData, recipeNutrition } from "@/lib/nutrition/engine";
import { quickAddText } from "@/lib/nutrition/meal-log";
import { NUTRIENT, NUTRIENTS, formatNutrient, kcal, type NutrientKey } from "@/lib/nutrition/nutrients";
import type { Recipe } from "@/lib/types";

const MAIN: NutrientKey[] = ["protein", "carbs", "fat", "fibre"];
const SECOND: NutrientKey[] = ["satFat", "sugars", "sodium"];

/** Per-serving nutrition on a recipe page, with the working shown so people can trust (and fix) it. */
export function RecipeNutritionCard({ recipe }: { recipe: Recipe }) {
  const [showMicros, setShowMicros] = useState(false);
  const [showWorking, setShowWorking] = useState(false);
  const n = useMemo(() => (hasFoodData() ? recipeNutrition(recipe) : null), [recipe]);
  if (!n || n.rows.every((r) => !r.food)) return null;
  const p = n.perServing;
  const show = (k: NutrientKey) => (p[k] === undefined ? "n/a" : formatNutrient(p[k], NUTRIENT[k].unit));
  const anyGaps = [...MAIN, ...SECOND].some((k) => p[k] === undefined);
  const lowCoverage = n.coverage < 0.8;
  const micros = NUTRIENTS.filter((x) => x.group === "micro" && x.key !== "sodium" && p[x.key] !== undefined);

  async function copy() {
    try {
      await navigator.clipboard.writeText(quickAddText(`${recipe.title} (1 serving)`, p));
      toast("Copied for Quick Add");
    } catch {
      toast("Couldn't copy. Try again.", { tone: "error" });
    }
  }

  return (
    <section aria-labelledby="nutrition-h" className="mt-8">
      <SectionTitle
        action={
          <button
            type="button"
            onClick={copy}
            aria-label="Copy for MacroFactor or MyFitnessPal"
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-primary hover:underline"
          >
            <Copy size={16} aria-hidden /> Copy macros
          </button>
        }
      >
        <span id="nutrition-h">Nutrition per serving</span>
      </SectionTitle>
      <Card className="p-4">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <p className="font-display text-3xl text-ink">{kcal(p.energyKj) ?? "–"} Cal</p>
          <p className="text-sm text-ink-2">{formatNutrient(p.energyKj, "kJ")}</p>
          {lowCoverage && (
            <p className="rounded-full bg-soon-soft px-2.5 py-0.5 text-xs font-semibold text-ink">Partial: {Math.round(n.coverage * 100)}% of the recipe matched</p>
          )}
        </div>
        <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
          {MAIN.map((k) => (
            <div key={k} className="rounded-2xl bg-surface-2 px-1 py-2">
              <dt className="text-xs text-ink-2">{NUTRIENT[k].label}</dt>
              <dd className="font-semibold tabular-nums text-ink">{show(k)}</dd>
            </div>
          ))}
        </dl>
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2">
          {SECOND.map((k) => (
            <div key={k} className="flex gap-1">
              <dt>{NUTRIENT[k].label}</dt>
              <dd className="font-semibold tabular-nums text-ink">{show(k)}</dd>
            </div>
          ))}
        </dl>

        {micros.length > 0 && (
          <div className="mt-3">
            <button type="button" aria-expanded={showMicros} onClick={() => setShowMicros((v) => !v)} className="min-h-11 text-sm font-medium text-primary hover:underline">
              {showMicros ? "Hide vitamins and minerals" : "Vitamins and minerals"}
            </button>
            {showMicros && (
              <dl className="grid grid-cols-2 gap-x-5 gap-y-1 text-sm sm:grid-cols-3">
                {micros.map((x) => (
                  <div key={x.key} className="flex justify-between gap-2 border-b border-line py-1">
                    <dt className="text-ink-2">{x.label}</dt>
                    <dd className="tabular-nums text-ink">{formatNutrient(p[x.key], x.unit)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}

        <p className={cx("mt-3 text-xs", n.coverage < 0.8 || n.missing.length ? "text-ink-2" : "text-ink-3")}>
          Estimated from the Australian Food Composition Database (FSANZ).
          {anyGaps && " n/a means the database doesn't list that nutrient for these foods."}
          {n.missing.length > 0 && ` Leaves out ${n.missing.map((m) => m.ingredient.name.toLowerCase()).join(", ")}.`}{" "}
          <button type="button" aria-expanded={showWorking} onClick={() => setShowWorking((v) => !v)} className="inline-flex min-h-11 items-center font-medium text-primary hover:underline">
            {showWorking ? "Hide the working" : "How we worked this out"}
          </button>
        </p>
        {showWorking && (
          <ul className="mt-1 divide-y divide-line text-sm">
            {n.rows.map((r, i) => (
              <li key={i} className="flex items-start justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="text-ink">{r.ingredient.name}</span>
                  <span className="block text-xs text-ink-3">
                    {r.food ? `Matched to “${r.food.name}”` : "No match, left out"}
                    {r.grams !== null ? ` · ${Math.round(r.grams)} g (${r.basis})` : " · amount unknown"}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-ink-2">{r.food && r.grams !== null ? `${kcal(r.nutrients.energyKj) ?? 0} Cal` : ""}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
