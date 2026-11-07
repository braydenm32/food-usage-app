import { beforeEach, describe, expect, it } from "vitest";
import { BACKUP_LIMITS, applyBackupExtras, getBackupExtras, parseBackupText } from "./backup-extras";
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

describe("parseBackupText with hostile files", () => {
  const item = { id: "i1", name: "Milk", locationId: "fridge", quantity: 1, addedAt: "2026-11-01T00:00:00.000Z" };
  const ok = (state: object, extra: object = {}) => parseBackupText(JSON.stringify({ state: { items: [], ...state }, ...extra }));

  it("accepts a normal backup", () => {
    const r = ok({ items: [item], savedRecipes: [{ id: "r1", title: "Soup", ingredients: [], sourceUrl: "https://example.com/soup", image: null }] });
    expect(r.ok).toBe(true);
  });

  it("rejects broken JSON, wrong shapes and oversized text with a friendly message", () => {
    for (const bad of ["{nope", "[]", "null", '{"state":{"items":"x"}}']) {
      const r = parseBackupText(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/nothing was changed/);
    }
    expect(parseBackupText(" ".repeat(BACKUP_LIMITS.bytes + 1)).ok).toBe(false);
  });

  it("rejects unsafe ids", () => {
    for (const id of ["__proto__", "constructor", "prototype", ""]) {
      expect(ok({ items: [{ ...item, id }] }).ok).toBe(false);
    }
    expect(parseBackupText('{"state":{"items":[],"overrides":{"__proto__":{"foodTypeId":"x"}}}}').ok).toBe(false);
  });

  it("caps array sizes", () => {
    const many = Array.from({ length: BACKUP_LIMITS.events + 1 }, (_, i) => ({ id: `e${i}`, type: "added", at: "2026-11-01T00:00:00.000Z" }));
    expect(ok({ events: many }).ok).toBe(false);
    const recipes = Array.from({ length: BACKUP_LIMITS.recipes + 1 }, (_, i) => ({ id: `r${i}`, title: "x", ingredients: [] }));
    expect(ok({ savedRecipes: recipes }).ok).toBe(false);
  });

  it("checks field types", () => {
    expect(ok({ items: [{ ...item, quantity: "lots" }] }).ok).toBe(false);
    expect(parseBackupText('{"state":{"items":[{"id":"a","name":"x","locationId":"f","quantity":1e999}]}}').ok).toBe(false);
    expect(ok({ items: [{ ...item, openedAt: "not a date" }] }).ok).toBe(false);
    expect(ok({ items: [{ ...item, openedAt: null }] }).ok).toBe(true);
  });

  it("only accepts http(s) links for recipes", () => {
    const recipe = (extra: object) => ({ savedRecipes: [{ id: "r1", title: "x", ingredients: [], ...extra }] });
    expect(ok(recipe({ sourceUrl: "javascript:alert(1)" })).ok).toBe(false);
    expect(ok(recipe({ image: "data:text/html,<script>" })).ok).toBe(false);
    expect(ok(recipe({ image: "http://example.com/a.jpg" })).ok).toBe(true);
  });

  it("rejects too many meals in extras", () => {
    const meals = Array.from({ length: BACKUP_LIMITS.meals + 1 }, (_, i) => ({ id: `m${i}` }));
    expect(ok({}, { extras: { mealLog: { meals } } }).ok).toBe(false);
  });
});

describe("applyBackupExtras with hostile extras", () => {
  beforeEach(() => {
    useLarder.getState().resetAll();
    useMealLog.getState().clear();
  });
  const meal = { id: "m1", at: "2026-11-02T08:00:00.000Z", date: "2026-11-02", title: "Oats", servings: 1 };

  it("drops meals with bad numbers, unknown nutrient keys or unsafe ids", () => {
    const res = applyBackupExtras({
      mealLog: {
        meals: [
          { ...meal, perServing: { protein: 5 } },
          { ...meal, id: "m2", perServing: { protein: "5" } },
          { ...meal, id: "m3", perServing: { protein: Infinity } },
          { ...meal, id: "m4", perServing: { bogus: 1 } },
          { ...meal, id: "__proto__", perServing: { protein: 1 } },
        ],
      },
    });
    expect(res.meals).toBe(1);
    expect(useMealLog.getState().meals.map((m) => m.id)).toEqual(["m1"]);
  });

  it("keeps only known, finite targets and pinned keys", () => {
    applyBackupExtras({
      mealLog: {
        targets: { protein: { goal: 90 }, bogus: { goal: 1 }, fat: { goal: "x" }, carbs: { goal: Infinity } },
        pinned: ["protein", "bogus", 7],
      },
    });
    expect(useMealLog.getState().targets).toEqual({ protein: { goal: 90 } });
    expect(useMealLog.getState().pinned).toEqual(["protein"]);
  });
});
