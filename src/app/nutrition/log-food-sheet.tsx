"use client";

import { useId, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button, Chip, Input, Segmented, Sheet, cx } from "@/components/ui";
import { toast } from "@/components/toast";
import type { FoodComposition } from "@/lib/nutrition/engine";
import { foodMealEntry, leftoversEntry, recentCooked, searchFoods, shortFoodName } from "@/lib/nutrition/food-search";
import { useMealLog } from "@/lib/nutrition/meal-log";
import { kcal } from "@/lib/nutrition/nutrients";

type Tab = "food" | "leftovers";
const GRAMS = [50, 100, 150, 200, 300];

/**
 * "Log a food": weigh or guess grams of any food in the FSANZ database, or log another serving
 * of something you cooked this week ("Ate leftovers").
 */
export function LogFoodSheet({ open, onClose, today, initialTab = "food" }: { open: boolean; onClose: () => void; today: string; initialTab?: Tab }) {
  return (
    <Sheet open={open} onClose={onClose} title="Log what you ate">
      {open && <Body key={initialTab} onClose={onClose} today={today} initialTab={initialTab} />}
    </Sheet>
  );
}

function Body({ onClose, today, initialTab }: { onClose: () => void; today: string; initialTab: Tab }) {
  const meals = useMealLog((s) => s.meals);
  const logMeal = useMealLog((s) => s.logMeal);
  const removeMeal = useMealLog((s) => s.removeMeal);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<FoodComposition | null>(null);
  const [grams, setGrams] = useState("100");
  const searchId = useId();
  const gramsId = useId();
  const results = useMemo(() => searchFoods(query, 8), [query]);
  const cooked = useMemo(() => recentCooked(meals, today), [meals, today]);
  const g = Number(grams);
  const gramsOk = Number.isFinite(g) && g > 0 && g <= 5000;

  const log = (entry: Parameters<typeof logMeal>[0]) => {
    const id = logMeal(entry);
    onClose();
    toast(`Logged ${entry.title}`, { action: { label: "Undo", onClick: () => removeMeal(id) } });
  };

  return (
    <div className="flex flex-col gap-4 pt-1">
      <Segmented<Tab>
        label="What to log"
        value={tab}
        onChange={setTab}
        options={[
          { value: "food", label: "A food" },
          { value: "leftovers", label: "Ate leftovers" },
        ]}
      />

      {tab === "food" ? (
        picked ? (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (gramsOk) log(foodMealEntry(picked, g, today));
            }}
          >
            <div className="rounded-2xl bg-surface-2 px-4 py-3">
              <p className="font-semibold text-ink">{shortFoodName(picked.name)}</p>
              <p className="text-sm text-ink-2">{picked.name}</p>
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor={gramsId} className="text-sm font-medium text-ink-2">
                How many grams?
              </label>
              <div className="flex items-center gap-2">
                <Input id={gramsId} inputMode="decimal" value={grams} onChange={(e) => setGrams(e.target.value)} className="w-28" autoFocus />
                <span className="text-sm text-ink-2">g</span>
                {gramsOk && (
                  <span className="ml-auto text-sm tabular-nums text-ink-2">
                    about {kcal(((picked.n.energyKj ?? 0) * g) / 100) ?? 0} Cal
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {GRAMS.map((n) => (
                  <Chip key={n} selected={grams === String(n)} onClick={() => setGrams(String(n))}>
                    {n} g
                  </Chip>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={!gramsOk}>
                Log {gramsOk ? `${Math.round(g)} g` : "it"}
              </Button>
              <Button variant="ghost" onClick={() => setPicked(null)}>
                Pick another food
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-2">
            <label htmlFor={searchId} className="text-sm font-medium text-ink-2">
              Find a food
            </label>
            <div className="relative">
              <Search size={18} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" />
              <Input
                id={searchId}
                type="search"
                autoFocus
                placeholder="Apple, toast, yoghurt…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-11"
                autoComplete="off"
              />
            </div>
            {query.trim() && (
              <p role="status" className="sr-only">
                {results.length === 0 ? "No foods found" : `${results.length} foods found`}
              </p>
            )}
            {query.trim() && results.length === 0 ? (
              <p className="py-3 text-sm text-ink-2">Nothing by that name. Try a simpler word, like “bread” or “apple”.</p>
            ) : (
              <ul className="divide-y divide-line">
                {results.map((f) => (
                  <li key={f.key}>
                    <button
                      type="button"
                      onClick={() => setPicked(f)}
                      className="flex min-h-12 w-full flex-col justify-center rounded-lg py-2 text-left hover:bg-surface-2"
                    >
                      <span className="text-[15px] text-ink">{shortFoodName(f.name)}</span>
                      <span className="text-xs text-ink-3">
                        {f.name} · {kcal(f.n.energyKj) ?? 0} Cal per 100 g
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-ink-3">Figures from the Australian Food Composition Database (FSANZ), per 100 g.</p>
          </div>
        )
      ) : cooked.length === 0 ? (
        <p className="py-3 text-[15px] text-ink-2">
          Nothing cooked in the last few days. When you tap “I cooked this” on a recipe, its leftovers can be logged here in one tap.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {cooked.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] text-ink">{m.title.replace(/ \(leftovers\)$/, "")}</span>
                <span className={cx("block text-xs text-ink-3")}>
                  {kcal(m.perServing.energyKj) ?? 0} Cal a serving · cooked{" "}
                  {new Date(m.at).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })}
                </span>
              </span>
              <Button size="sm" variant="secondary" className="h-11" onClick={() => log(leftoversEntry(m, today))}>
                Log a serving
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
