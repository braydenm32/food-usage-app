import { beforeEach, describe, expect, it } from "vitest";
import { applyBackupExtras, getBackupExtras } from "./backup-extras";
import { useLarder } from "./store";
import { useMealLog } from "./nutrition/meal-log";

describe("backup extras", () => {
  beforeEach(() => {
    useLarder.getState().resetAll();
    useMealLog.getState().clear();
  });

  it("round-trips staples, meals and targets", () => {
    useLarder.getState().setStaple({ name: "Milk", foodTypeId: "milk-full-cream" }, true);
    useMealLog.getState().logMeal({ at: "2026-11-02T08:00:00.000Z", date: "2026-11-02", title: "Oats", servings: 1, perServing: { protein: 5 } });
    useMealLog.getState().setTarget("protein", { goal: 90 });
    const saved = JSON.parse(JSON.stringify(getBackupExtras()));

    useLarder.getState().resetAll();
    useMealLog.getState().clear();
    expect(applyBackupExtras(saved)).toEqual({ staples: 1, meals: 1 });
    expect(useLarder.getState().staples[0].name).toBe("Milk");
    expect(useMealLog.getState().meals[0].title).toBe("Oats");
    expect(useMealLog.getState().targets.protein).toEqual({ goal: 90 });
  });

  it("leaves things alone for old backups and skips bad rows", () => {
    useLarder.getState().setStaple({ name: "Milk", foodTypeId: null }, true);
    expect(applyBackupExtras(undefined)).toEqual({ staples: 0, meals: 0 });
    expect(useLarder.getState().staples).toHaveLength(1);
    applyBackupExtras({ mealLog: { meals: [{ id: 1 }, null] } });
    expect(useMealLog.getState().meals).toEqual([]);
  });
});
