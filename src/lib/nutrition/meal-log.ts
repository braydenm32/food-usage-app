"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { NUTRIENTS, addNutrients, kcal, scaleNutrients, type NutrientKey, type Nutrients } from "./nutrients";

/**
 * What you ate, from recipes you cooked. Nutrition is personal, so the log stays on this device
 * and is not shared with the household like the larder is.
 */

export interface MealEntry {
  id: string;
  /** ISO date-time eaten. */
  at: string;
  /** Local ISO date (YYYY-MM-DD) it counts towards. */
  date: string;
  recipeId?: string;
  title: string;
  servings: number;
  /** Snapshot per serving at the time, so later recipe edits don't rewrite history. */
  perServing: Nutrients;
  /** Per-ingredient amounts for one serving, for "top contributors". */
  contributors?: { name: string; n: Nutrients }[];
}

export interface Target {
  min?: number;
  goal?: number;
  max?: number;
}

interface MealLogState {
  meals: MealEntry[];
  targets: Partial<Record<NutrientKey, Target>>;
  /** Nutrients pinned to the top of the Nutrition screen. */
  pinned: NutrientKey[];
  logMeal: (m: Omit<MealEntry, "id">) => string;
  updateMeal: (id: string, patch: Partial<Pick<MealEntry, "servings" | "date">>) => void;
  removeMeal: (id: string) => MealEntry | undefined;
  restoreMeal: (m: MealEntry) => void;
  setTarget: (key: NutrientKey, t: Target | undefined) => void;
  setPinned: (keys: NutrientKey[]) => void;
}

const newId = () => `meal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const useMealLog = create<MealLogState>()(
  persist(
    (set, get) => ({
      meals: [],
      targets: {},
      pinned: ["energyKj", "protein", "carbs", "fat", "fibre"],
      logMeal: (m) => {
        const id = newId();
        set((s) => ({ meals: [{ ...m, id }, ...s.meals].slice(0, 3000) }));
        return id;
      },
      updateMeal: (id, patch) => set((s) => ({ meals: s.meals.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
      removeMeal: (id) => {
        const m = get().meals.find((x) => x.id === id);
        set((s) => ({ meals: s.meals.filter((x) => x.id !== id) }));
        return m;
      },
      restoreMeal: (m) => set((s) => ({ meals: [m, ...s.meals].sort((a, b) => b.at.localeCompare(a.at)) })),
      setTarget: (key, t) =>
        set((s) => {
          const targets = { ...s.targets };
          if (!t || (t.min === undefined && t.goal === undefined && t.max === undefined)) delete targets[key];
          else targets[key] = t;
          return { targets };
        }),
      setPinned: (keys) => set({ pinned: keys }),
    }),
    { name: "larder-meal-log", storage: createJSONStorage(() => localStorage), version: 1 },
  ),
);

/* ---------- maths for the Nutrition screen ---------- */

export const mealTotal = (m: MealEntry) => scaleNutrients(m.perServing, m.servings);

export function totalsFor(meals: MealEntry[], dates: Set<string>): Nutrients {
  return meals.filter((m) => dates.has(m.date)).reduce<Nutrients>((t, m) => addNutrients(t, m.perServing, m.servings), {});
}

/** Average per day over the days you logged anything in the window (empty days would drag it down unfairly). */
export function dailyAverage(meals: MealEntry[], from: string, to: string): { avg: Nutrients; days: number } {
  const inRange = meals.filter((m) => m.date >= from && m.date <= to);
  const days = new Set(inRange.map((m) => m.date)).size;
  if (days === 0) return { avg: {}, days: 0 };
  const sum = inRange.reduce<Nutrients>((t, m) => addNutrients(t, m.perServing, m.servings), {});
  return { avg: scaleNutrients(sum, 1 / days), days };
}

/** Which foods supplied the most of a nutrient across these meals. */
export function contributorsFor(meals: MealEntry[], key: NutrientKey, limit = 5): { name: string; amount: number; share: number }[] {
  const by = new Map<string, number>();
  for (const m of meals) {
    for (const c of m.contributors ?? []) {
      const v = (c.n[key] ?? 0) * m.servings;
      if (v > 0) by.set(c.name.toLowerCase(), (by.get(c.name.toLowerCase()) ?? 0) + v);
    }
  }
  const sum = [...by.values()].reduce((a, b) => a + b, 0);
  return [...by]
    .map(([name, amount]) => ({ name, amount, share: sum ? amount / sum : 0 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

/** Where a value sits against a target: under the minimum, within, or over the maximum. */
export function targetState(value: number | undefined, t: Target | undefined): "under" | "ok" | "over" | null {
  if (!t || value === undefined) return null;
  if (t.max !== undefined && value > t.max) return "over";
  if (t.min !== undefined && value < t.min) return "under";
  return "ok";
}

/* ---------- export ---------- */

/**
 * The numbers MacroFactor and MyFitnessPal ask for in Quick Add, in that order.
 * Neither app has an open API, so this is copied and pasted (or typed) in.
 */
export function quickAddText(label: string, n: Nutrients): string {
  const r = (v?: number) => (v === undefined ? "0" : String(Math.round(v)));
  return [
    label,
    `Calories: ${kcal(n.energyKj) ?? 0} kcal (${r(n.energyKj)} kJ)`,
    `Protein: ${r(n.protein)} g`,
    `Carbs: ${r(n.carbs)} g`,
    `Fat: ${r(n.fat)} g`,
    `Fibre: ${r(n.fibre)} g`,
    `Sugars: ${r(n.sugars)} g`,
    `Sodium: ${r(n.sodium)} mg`,
  ].join("\n");
}

const csvCell = (v: string | number | undefined) => {
  const s = v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per meal, every tracked nutrient as a column. Opens in Excel, Numbers or Sheets. */
export function mealsCsv(meals: MealEntry[]): string {
  const head = ["Date", "Time", "Meal", "Servings", "Calories (kcal)", ...NUTRIENTS.map((n) => `${n.label} (${n.unit})`)];
  const rows = [...meals]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((m) => {
      const t = mealTotal(m);
      const time = new Date(m.at).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
      return [m.date, time, m.title, m.servings, kcal(t.energyKj), ...NUTRIENTS.map((n) => (t[n.key] === undefined ? undefined : Math.round(t[n.key]! * 10) / 10))];
    });
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}
