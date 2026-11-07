import { beforeEach, describe, expect, it, vi } from "vitest";

// A server that never answers, for the account export's time limit.
const hang = () => new Promise(() => undefined);
vi.mock("@/lib/supabase/client", () => {
  const q = { select: () => q, eq: () => hang() };
  return { getSupabase: () => ({ from: () => q }) };
});

import { BACKUP_LIMITS, applyBackupExtras, getAccountExport, getBackupExtras, parseBackupText } from "./backup-extras";
import { syncStatusStore } from "./sync/status";
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

  it("leaves out rows that can't be used, and keeps the rest", () => {
    const r = ok({ items: [{ ...item, quantity: "lots" }, { ...item, id: "i2", name: 7 }, null, { ...item, id: "i3" }] });
    expect(r.ok && r.backup.data.items.map((i) => i.id)).toEqual(["i3"]);
    const inf = parseBackupText('{"state":{"items":[{"id":"a","name":"x","locationId":"f","quantity":1e999}]}}');
    expect(inf.ok && inf.backup.data.items).toEqual([]);
  });

  it("tidies cosmetic fields instead of refusing the file", () => {
    const r = ok({
      items: [{ ...item, openedAt: "not a date", notes: "n".repeat(5000), name: "x".repeat(400), quantity: -2, price: 1e12 }],
      profile: { householdName: 42, diets: ["vegan", 3], allergies: ["a".repeat(150)] },
      settings: { theme: "neon" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const i = r.backup.data.items[0];
    expect(i.openedAt).toBeUndefined();
    expect(i.notes).toHaveLength(2000);
    expect(i.name).toHaveLength(300);
    expect(i.quantity).toBe(0);
    expect(i.price).toBe(1_000_000);
    expect(r.backup.data.profile.householdName).toBeUndefined();
    expect(r.backup.data.profile.diets).toEqual(["vegan"]);
    expect(r.backup.data.profile.allergies[0]).toHaveLength(100);
    expect(r.backup.data.settings.theme).toBeUndefined();
    expect(ok({ items: [{ ...item, openedAt: null }] }).ok).toBe(true);
  });

  it("keeps only http(s) links for recipes, and drops the rest", () => {
    const recipe = (extra: object) => {
      const r = ok({ savedRecipes: [{ id: "r1", title: "x", ingredients: [], ...extra }] });
      return r.ok ? r.backup.data.savedRecipes[0] : null;
    };
    expect(recipe({ sourceUrl: "javascript:alert(1)" })?.sourceUrl).toBeUndefined();
    expect(recipe({ image: "data:text/html,<script>" })?.image).toBeUndefined();
    expect(recipe({ image: "http://example.com/a.jpg" })?.image).toBe("http://example.com/a.jpg");
  });

  it("restores a realistic old export with schemeless links and empty images", () => {
    const old = {
      app: "larder",
      version: 1,
      exportedAt: "2025-03-14T09:30:00.000Z",
      state: {
        items: [{ ...item, notes: "" }],
        events: [{ id: "e1", type: "added", at: "2025-03-01T00:00:00.000Z", itemId: "i1" }],
        profile: { householdName: "The Lees", people: 2, diets: [], allergies: [], likes: [], dislikes: [] },
        savedRecipes: [
          {
            id: "mealdb-52772",
            title: "Teriyaki Chicken Casserole",
            ingredients: [{ name: "soy sauce", quantity: 0.75, unit: "cup" }],
            steps: ["Preheat oven to 180C."],
            sourceUrl: "www.bbc.co.uk/food/recipes/teriyaki_chicken_casserole",
            image: "",
            source: "themealdb",
          },
          {
            id: "mealdb-52773",
            title: "Honey Teriyaki Salmon",
            ingredients: [],
            sourceUrl: "",
            image: "https://www.themealdb.com/images/media/meals/xxyupu1468262513.jpg",
          },
        ],
        shoppingList: [{ id: "s1", name: "Rice", checked: "no" }],
        mealPlan: [],
      },
    };
    const r = parseBackupText(JSON.stringify(old));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [a, b] = r.backup.data.savedRecipes;
    expect(a).toMatchObject({ id: "mealdb-52772", title: "Teriyaki Chicken Casserole", source: "themealdb" });
    expect(a.sourceUrl).toBeUndefined();
    expect(a.image).toBeUndefined();
    expect(b.sourceUrl).toBeUndefined();
    expect(b.image).toBe("https://www.themealdb.com/images/media/meals/xxyupu1468262513.jpg");
    expect(r.backup.data.shoppingList[0].checked).toBe(false);
    expect(r.backup.data.items).toHaveLength(1);
  });

  it("still refuses an unsafe id anywhere", () => {
    expect(ok({ savedRecipes: [{ id: "__proto__", title: "x", ingredients: [] }] }).ok).toBe(false);
    expect(ok({ events: [{ id: "constructor", type: "added", at: "2026-11-01T00:00:00.000Z" }] }).ok).toBe(false);
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

describe("getAccountExport", () => {
  it("gives up after about 4 seconds so Export still works", async () => {
    vi.useFakeTimers();
    try {
      syncStatusStore.setState({ userId: "u1", email: "sam@example.com" });
      const p = getAccountExport();
      await vi.advanceTimersByTimeAsync(4000);
      await expect(p).resolves.toBeNull();
    } finally {
      syncStatusStore.setState({ userId: null, email: null });
      vi.useRealTimers();
    }
  });
});
