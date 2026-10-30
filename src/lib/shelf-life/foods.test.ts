import { describe, expect, it } from "vitest";
import { FOOD_TYPES, matchFoodType } from "./foods";

describe("FOOD_TYPES data", () => {
  it("has unique kebab-case ids", () => {
    const ids = FOOD_TYPES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("has about 300 entries", () => {
    expect(FOOD_TYPES.length).toBeGreaterThanOrEqual(280);
  });

  it("uses lowercase aliases and sane days", () => {
    for (const f of FOOD_TYPES) {
      for (const a of f.aliases) expect(a).toBe(a.toLowerCase());
      for (const d of [f.pantryDays, f.fridgeDays, f.freezerDays, f.openedDays]) {
        if (d !== null) expect(d).toBeGreaterThanOrEqual(0);
      }
      expect(f.defaultQuantity).toBeGreaterThan(0);
    }
  });
});

describe("matchFoodType", () => {
  const cases: [string, string][] = [
    ["WW BABY SPINACH 120G", "baby-spinach"],
    ["milk", "milk-full-cream"],
    ["Coles Beef Mince 500g", "beef-mince"],
    ["bananas", "banana"],
    ["free range eggs 12pk", "eggs"],
    ["tin tomatoes", "tinned-tomatoes"],
    ["Greek yoghurt 1kg", "greek-yoghurt"],
    ["sourdough", "sourdough"],
    ["bread", "bread-loaf"],
    ["cheese", "cheese-tasty"],
    ["mince", "beef-mince"],
    ["chicken", "chicken-breast"],
    ["Chicken Thigh Fillets 600g", "chicken-thigh"],
    ["capsicum", "capsicum-red"],
    ["zucchini", "zucchini"],
    ["Rockmelon", "rockmelon"],
    ["spring onions", "spring-onion"],
    ["kent pumpkin", "pumpkin-kent"],
    ["sweet potato", "sweet-potato"],
    ["potatoes", "potato"],
    ["onions", "onion-brown"],
    ["butter", "butter"],
    ["haloumi", "cheese-haloumi"],
    ["barramundi fillets", "barramundi"],
    ["cooked rice", "cooked-rice"],
    ["peanut butter", "peanut-butter"],
    ["vegemite", "vegemite"],
    ["tomato sauce", "tomato-sauce"],
    ["frozen peas", "frozen-peas"],
    ["leftovers - cooked meal", "leftovers-meal"],
    ["pasta", "pasta-dried"],
    ["spaghetti", "pasta-dried"],
    ["Pork sausages", "sausages"],
    ["lettuce cos", "lettuce-cos"],
    ["salt", "salt-pepper"],
    ["Cherry tomatoes 250g", "cherry-tomato"],
    ["WW LF MILK 2L", "milk-lactose-free"],
  ];
  for (const [text, id] of cases) {
    it(`"${text}" -> ${id}`, () => {
      expect(matchFoodType(text)?.food.id).toBe(id);
    });
  }
});
