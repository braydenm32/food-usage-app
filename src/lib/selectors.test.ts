import { describe, expect, it } from "vitest";
import { isHighRiskFood, stapleViews, viewItem } from "./selectors";
import { DEFAULT_LOCATIONS, DEFAULT_SETTINGS } from "./store";
import { getFoodType } from "./shelf-life/foods";
import type { PantryItem, Staple } from "./types";

const state = { locations: DEFAULT_LOCATIONS, overrides: {}, settings: DEFAULT_SETTINGS };

function item(p: Partial<PantryItem> = {}): PantryItem {
  return {
    id: Math.random().toString(36),
    name: "Milk",
    foodTypeId: "milk-full-cream",
    emoji: "🥛",
    locationId: "fridge",
    quantity: 2,
    initialQuantity: 2,
    unit: "L",
    addedAt: new Date(2026, 10, 2, 9).toISOString(),
    dateKind: "use-by",
    source: "manual",
    ...p,
  };
}

describe("high-risk foods", () => {
  it("treats raw meat, fish and leftovers as high risk, not milk or bread", () => {
    expect(isHighRiskFood({ name: "Salmon" }, getFoodType("salmon-fillet"))).toBe(true);
    expect(isHighRiskFood({ name: "Leftovers" }, getFoodType("leftovers-meal"))).toBe(true);
    expect(isHighRiskFood({ name: "Milk" }, getFoodType("milk-full-cream"))).toBe(false);
    expect(isHighRiskFood({ name: "Mystery chicken thing" }, undefined)).toBe(true);
    expect(isHighRiskFood({ name: "Mystery sauce" }, undefined)).toBe(false);
  });

  it("puts 3-day salmon in use soon while 3-day other food stays fresh", () => {
    const now = new Date(2026, 10, 2);
    const printed = "2026-11-05";
    const fish = viewItem(item({ name: "Salmon", foodTypeId: "salmon-fillet", printedDate: printed }), state, now);
    const milk = viewItem(item({ printedDate: printed }), state, now);
    expect(fish.expiry.daysLeft).toBe(3);
    expect(fish.expiry.status).toBe("use-soon");
    expect(milk.expiry.status).toBe("fresh");
  });

  it("raw mince and fresh leftovers just added are both use soon, not use today", () => {
    const now = new Date(2026, 10, 2);
    const mince = viewItem(item({ name: "Beef mince", foodTypeId: "beef-mince", unit: "g", quantity: 500, addedAt: now.toISOString() }), state, now);
    expect(mince.expiry.daysLeft).toBe(2);
    expect(mince.expiry.status).toBe("use-soon");
    // Leftovers and meal prep follow the same 2-day rule as raw mince.
    const leftovers = viewItem(item({ name: "Leftovers", foodTypeId: "leftovers-meal", unit: "item", addedAt: now.toISOString() }), state, now);
    expect(leftovers.expiry.daysLeft).toBe(2);
    expect(leftovers.expiry.status).toBe("use-soon");
    // Use them on the second day.
    const dayAfter = new Date(2026, 10, 4);
    expect(viewItem(leftovers.item, state, dayAfter).expiry.status).toBe("use-today");
  });

  it("doesn't widen the window in the freezer", () => {
    const now = new Date(2026, 10, 2);
    const v = viewItem(item({ name: "Salmon", foodTypeId: "salmon-fillet", locationId: "freezer", frozenAt: now.toISOString(), printedDate: undefined }), state, now);
    expect(v.expiry.status).toBe("fresh");
  });
});

describe("stapleViews", () => {
  const staple: Staple = { id: "s1", name: "Milk", foodTypeId: "milk-full-cream", addedAt: "" };
  const now = new Date(2026, 10, 2);

  it("reports in stock, low and on the list", () => {
    const full = viewItem(item(), state, now);
    const low = viewItem(item({ quantity: 0.25, initialQuantity: 2 }), state, now);
    expect(stapleViews([staple], [full], [])[0]).toMatchObject({ inStock: true, low: false, onList: false });
    expect(stapleViews([staple], [low], [])[0]).toMatchObject({ inStock: true, low: true });
    expect(stapleViews([staple], [], [{ name: "milk", foodTypeId: "milk-full-cream", checked: false }])[0]).toMatchObject({
      inStock: false,
      low: true,
      onList: true,
    });
  });

  it("doesn't count gone-off stock", () => {
    const old = viewItem(item({ printedDate: "2026-10-01" }), state, now);
    expect(stapleViews([staple], [old], [])[0].inStock).toBe(false);
  });
});
