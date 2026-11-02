import { describe, expect, it } from "vitest";
import type { PantryItem, Unit } from "@/lib/types";
import { getBuiltinRecipe } from "./builtin";
import { listEntryFor, planShoppingNeeds } from "./plan";

function item(name: string, foodTypeId: string | null, quantity: number, unit: Unit): PantryItem {
  return { id: name, name, foodTypeId, emoji: "x", locationId: "fridge", quantity, initialQuantity: quantity, unit, addedAt: "2026-01-01T00:00:00Z", dateKind: "use-by", source: "manual" };
}

const bol = getBuiltinRecipe("builtin-spag-bol")!;
const nachos = getBuiltinRecipe("builtin-nachos")!;
const tacos = getBuiltinRecipe("builtin-beef-tacos")!;

describe("meal plan shopping", () => {
  it("adds up mince across the week and subtracts what's in the larder", () => {
    const needs = planShoppingNeeds([{ recipe: bol }, { recipe: nachos }, { recipe: tacos }], [item("Beef mince", "beef-mince", 500, "g")]);
    const mince = needs.find((n) => n.foodTypeId === "beef-mince");
    expect(mince?.quantity).toBe(900);
    expect(mince?.unit).toBe("g");
    expect(mince?.recipeIds).toHaveLength(3);
  });

  it("scales to each meal's servings", () => {
    const needs = planShoppingNeeds([{ recipe: bol, servings: 2 }], []);
    expect(needs.find((n) => n.foodTypeId === "beef-mince")?.quantity).toBe(250);
  });

  it("leaves out staples and optional ingredients and keeps the recipe's names", () => {
    const needs = planShoppingNeeds([{ recipe: nachos }], []);
    const names = needs.map((n) => n.name);
    expect(names).not.toContain("Taco seasoning");
    expect(names).not.toContain("Sour cream");
    expect(names).toContain("Corn chips");
    expect(names).toContain("Kidney beans");
  });

  it("skips what's already on the list", () => {
    const needs = planShoppingNeeds([{ recipe: bol }], [], [
      { id: "l", name: "Beef mince", foodTypeId: "beef-mince", aisle: "Meat & Seafood", checked: false, addedAt: "x" } as never,
    ]);
    expect(needs.some((n) => n.foodTypeId === "beef-mince")).toBe(false);
  });

  it("doesn't count food past its use-by, or frozen past its date, as on hand", () => {
    const mince = item("Beef mince", "beef-mince", 1000, "g");
    const off = { item: mince, expiry: { status: "expired" as const, daysLeft: -1, estimated: true } };
    expect(planShoppingNeeds([{ recipe: bol }], [off]).some((n) => n.foodTypeId === "beef-mince")).toBe(true);
    const good = { item: mince, expiry: { status: "fresh" as const, daysLeft: 2, estimated: true } };
    expect(planShoppingNeeds([{ recipe: bol }], [good]).some((n) => n.foodTypeId === "beef-mince")).toBe(false);
    const frozenOff = { ...mince, expiredWhenFrozen: true };
    expect(planShoppingNeeds([{ recipe: bol }], [frozenOff]).some((n) => n.foodTypeId === "beef-mince")).toBe(true);
  });
});

describe("recipe amounts on the shopping list", () => {
  it("adds a loaf for slices of bread, with the slices as a note", () => {
    const e = listEntryFor({ name: "bread", quantity: 6, unit: "slice", foodTypeId: "bread-loaf" }, "French toast");
    expect(e.unit).toBe("loaf");
    expect(e.quantity).toBe(1);
    expect(e.note).toBe("6 slices bread for French toast");
  });
  it("keeps amounts a shop sells as they are", () => {
    const e = listEntryFor({ name: "beef mince", quantity: 500, unit: "g", foodTypeId: "beef-mince" });
    expect(e).toMatchObject({ name: "Beef mince", quantity: 500, unit: "g" });
  });
});
