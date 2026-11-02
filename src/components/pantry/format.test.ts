import { describe, expect, it } from "vitest";
import { formatQuantity, wasteTotals } from "./format";
import type { ItemEvent } from "@/lib/types";

describe("formatQuantity", () => {
  it("folds 1000 g and up into kg, 1000 ml and up into L", () => {
    expect(formatQuantity(1000, "g")).toBe("1 kg");
    expect(formatQuantity(1250, "g")).toBe("1.25 kg");
    expect(formatQuantity(2500, "ml")).toBe("2.5 L");
    expect(formatQuantity(999, "g")).toBe("999 g");
    expect(formatQuantity(250, "ml")).toBe("250 ml");
  });

  it("keeps other units", () => {
    expect(formatQuantity(2, "item")).toBe("×2");
    expect(formatQuantity(1.5, "L")).toBe("1½ L");
    expect(formatQuantity(2, "tin")).toBe("2 tins");
  });
});

describe("wasteTotals", () => {
  const ev = (itemId: string, type: ItemEvent["type"], value?: number, at = "2026-11-02T10:00:00Z"): ItemEvent => ({
    id: Math.random().toString(36),
    itemId,
    itemName: itemId,
    foodTypeId: null,
    type,
    at,
    value,
  });

  it("counts items, not events", () => {
    const t = wasteTotals([ev("milk", "used", 1), ev("milk", "used", 1), ev("milk", "used", 1), ev("bread", "binned", 4.5)]);
    expect(t.used).toBe(1);
    expect(t.binned).toBe(1);
    expect(t.usedValue).toBe(3);
    expect(t.binnedValue).toBe(4.5);
  });

  it("counts a partly eaten, then binned item as binned", () => {
    const t = wasteTotals([ev("cheese", "used", 2), ev("cheese", "binned", 3)]);
    expect(t).toMatchObject({ used: 0, binned: 1, usedValue: 2, binnedValue: 3, binnedPriced: true });
  });

  it("only counts events since a date", () => {
    const t = wasteTotals([ev("a", "used", undefined, "2026-10-01T00:00:00Z"), ev("b", "used")], new Date("2026-11-01T00:00:00Z"));
    expect(t.used).toBe(1);
    expect(t.usedPriced).toBe(false);
  });
});
