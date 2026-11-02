"use client";

import { useLarder } from "@/lib/store";
import { useMealLog, type MealEntry, type Target } from "@/lib/nutrition/meal-log";
import type { NutrientKey } from "@/lib/nutrition/nutrients";
import type { Staple } from "@/lib/types";

/**
 * Parts of a backup that live outside the main larder snapshot: the household's staples and
 * this device's meal log (meals, daily targets, pinned nutrients).
 *
 * Settings → "Export a copy" adds `extras: getBackupExtras()` beside `state`, and Import calls
 * `applyBackupExtras(file.extras)` after restoring the larder. Old backups have no `extras`,
 * which leaves the current staples and meal log as they are.
 */
export interface BackupExtras {
  staples: Staple[];
  mealLog: {
    meals: MealEntry[];
    targets: Partial<Record<NutrientKey, Target>>;
    pinned: NutrientKey[];
  };
}

export function getBackupExtras(): BackupExtras {
  const m = useMealLog.getState();
  return {
    staples: useLarder.getState().staples,
    mealLog: { meals: m.meals, targets: m.targets, pinned: m.pinned },
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Restore staples and the meal log from a backup's `extras`. Anything missing or malformed is
 * skipped rather than wiping what's here. Returns what was restored, for the toast.
 */
export function applyBackupExtras(raw: unknown): { staples: number; meals: number } {
  const out = { staples: 0, meals: 0 };
  if (!isObj(raw)) return out;

  if (Array.isArray(raw.staples)) {
    const staples = raw.staples.filter(
      (s): s is Staple => isObj(s) && typeof s.id === "string" && typeof s.name === "string",
    ).map((s) => ({ ...s, foodTypeId: typeof s.foodTypeId === "string" ? s.foodTypeId : null }));
    useLarder.setState({ staples });
    out.staples = staples.length;
  }

  const log = raw.mealLog;
  if (isObj(log)) {
    const patch: Partial<BackupExtras["mealLog"]> = {};
    if (Array.isArray(log.meals)) {
      patch.meals = log.meals.filter(
        (m): m is MealEntry =>
          isObj(m) && typeof m.id === "string" && typeof m.at === "string" && typeof m.date === "string" && typeof m.title === "string" && isObj(m.perServing),
      ).map((m) => ({ ...m, servings: typeof m.servings === "number" && m.servings > 0 ? m.servings : 1 }));
      out.meals = patch.meals.length;
    }
    if (isObj(log.targets)) patch.targets = log.targets as BackupExtras["mealLog"]["targets"];
    if (Array.isArray(log.pinned)) patch.pinned = log.pinned.filter((k): k is NutrientKey => typeof k === "string");
    if (Object.keys(patch).length) useMealLog.setState(patch);
  }
  return out;
}
