import { describe, expect, it } from "vitest";
import {
  computeExpiry,
  defaultsForUnknown,
  describeDaysLeft,
  freezerNotRecommended,
  isHighRisk,
  isPastDateForFreezing,
  statusFor,
  storageDays,
  storageWarning,
  type ExpiryInfo,
} from "./engine";
import { getFoodType } from "./foods";
import type { PantryItem, StorageLocation } from "@/lib/types";

const NOW = new Date(2026, 9, 29, 12); // 29 Oct 2026, midday local
const daysAgo = (n: number) => new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - n, 9).toISOString();

const FRIDGE: StorageLocation = { id: "fridge", name: "Fridge", kind: "fridge" };
const PANTRY: StorageLocation = { id: "pantry", name: "Pantry", kind: "pantry" };
const FREEZER: StorageLocation = { id: "freezer", name: "Freezer", kind: "freezer" };

function item(p: Partial<PantryItem> = {}): PantryItem {
  return {
    id: "i1",
    name: "Thing",
    foodTypeId: null,
    emoji: "🛒",
    locationId: "fridge",
    quantity: 1,
    initialQuantity: 1,
    unit: "item",
    addedAt: daysAgo(0),
    dateKind: "best-before",
    source: "manual",
    ...p,
  };
}

const expiry = (i: PantryItem, location: StorageLocation) =>
  computeExpiry(i, { food: getFoodType(i.foodTypeId), location, now: NOW });

describe("unknown-food fallback", () => {
  it("defaults unknown foods to the fridge with a cautious 5 days", () => {
    expect(defaultsForUnknown("Dragon fruit jam")).toMatchObject({ locationId: "fridge", days: 5, highRisk: false });
    expect(expiry(item({ name: "Dragon fruit jam" }), FRIDGE).daysLeft).toBe(5);
  });

  it("treats unknown raw meat and seafood as high risk: fridge, use-by, 2 days", () => {
    for (const name of ["Kangaroo fillet", "Pork belly", "Fish cakes", "Chicken kiev", "Snags"]) {
      expect(isHighRisk(name)).toBe(true);
    }
    expect(isHighRisk("Mango chutney")).toBe(false);
    expect(defaultsForUnknown("Beef strips")).toMatchObject({ locationId: "fridge", dateKind: "use-by", days: 2, highRisk: true });
    expect(expiry(item({ name: "Beef strips" }), FRIDGE).daysLeft).toBe(2);
    expect(expiry(item({ name: "Beef strips" }), PANTRY).daysLeft).toBe(2);
  });

  it("keeps 30 days for unknown foods in the pantry and 90 frozen", () => {
    expect(expiry(item({ name: "Mystery crackers" }), PANTRY).daysLeft).toBe(30);
    expect(expiry(item({ name: "Mystery crackers", frozenAt: daysAgo(0) }), FREEZER).daysLeft).toBe(90);
  });
});

describe("known food with no days for its spot", () => {
  it("uses the shortest other life and says where it belongs", () => {
    const milk = getFoodType("milk-full-cream");
    expect(storageWarning(milk, "pantry")).toBe("Not suited to the pantry — move it to the fridge");
    expect(storageWarning(milk, "fridge")).toBeUndefined();
    const info = expiry(item({ foodTypeId: "milk-full-cream", dateKind: "use-by" }), PANTRY);
    expect(info.daysLeft).toBe(milk!.fridgeDays);
    expect(info.basis).toMatch(/move it to the fridge/);
  });

  it("gives foods that don't freeze well 30 days and a texture warning", () => {
    const apple = getFoodType("apple-red");
    expect(freezerNotRecommended(apple)).toBe(true);
    expect(freezerNotRecommended(getFoodType("beef-mince"))).toBe(false);
    expect(freezerNotRecommended(undefined)).toBe(false);
    expect(storageWarning(apple, "freezer")).toBe("Not great frozen — texture suffers");
    expect(storageDays(apple, undefined, "freezer")).toBe(30);
    const info = expiry(item({ foodTypeId: "apple-red", frozenAt: daysAgo(0) }), FREEZER);
    expect(info.daysLeft).toBe(30);
    expect(info.basis).toMatch(/texture suffers/);
  });

  it("never returns a generic fallback for a known food", () => {
    // Garlic has no fridge days but 90 in the pantry.
    expect(storageDays(getFoodType("garlic"), undefined, "fridge")).toBe(90);
  });
});

describe("expired, then frozen", () => {
  it("stays expired in the freezer and after thawing", () => {
    const frozen = item({ foodTypeId: "beef-mince", dateKind: "use-by", addedAt: daysAgo(10), frozenAt: daysAgo(5), expiredWhenFrozen: true });
    expect(expiry(frozen, FREEZER).status).toBe("expired");
    expect(expiry(frozen, FREEZER).basis).toMatch(/past its date when frozen/);
    expect(expiry({ ...frozen, thawedAt: daysAgo(0) }, FRIDGE).status).toBe("expired");
  });

  it("detects an item past its date before it goes in", () => {
    const food = getFoodType("beef-mince");
    const old = item({ foodTypeId: "beef-mince", dateKind: "use-by", addedAt: daysAgo(5) });
    expect(isPastDateForFreezing(old, { food, location: FRIDGE, now: NOW })).toBe(true);
    const fresh = item({ foodTypeId: "beef-mince", dateKind: "use-by", addedAt: daysAgo(1) });
    expect(isPastDateForFreezing(fresh, { food, location: FRIDGE, now: NOW })).toBe(false);
    expect(expiry({ ...fresh, frozenAt: daysAgo(0) }, FREEZER).status).toBe("fresh");
  });

  it("doesn't count a past printed best-before as unsafe to freeze", () => {
    const bread = item({ name: "Bread", printedDate: "2026-10-27", dateKind: "best-before" });
    expect(isPastDateForFreezing(bread, { location: PANTRY, now: NOW })).toBe(false);
    const useBy = item({ name: "Yoghurt", printedDate: "2026-10-27", dateKind: "use-by" });
    expect(isPastDateForFreezing(useBy, { location: FRIDGE, now: NOW })).toBe(true);
  });
});

describe("describeDaysLeft", () => {
  const info = (daysLeft: number, estimated: boolean): ExpiryInfo => ({
    daysLeft,
    estimated,
    expiresOn: NOW,
    status: statusFor(daysLeft, 2),
    basis: "",
  });

  it("says past best before for best-before foods, estimated or printed", () => {
    expect(describeDaysLeft(info(-1, true), "best-before")).toBe("Past best before (yesterday)");
    expect(describeDaysLeft(info(-3, false), "best-before")).toBe("Past best before (3 days ago)");
  });

  it("says likely spoiled for use-by foods", () => {
    expect(describeDaysLeft(info(-1, true), "use-by")).toBe("Likely spoiled (yesterday)");
    expect(describeDaysLeft(info(-2, false), "use-by")).toBe("Likely spoiled (2 days ago)");
  });

  it("is honest about estimates", () => {
    expect(describeDaysLeft(info(5, true), "use-by")).toBe("about 5 days left");
    expect(describeDaysLeft(info(5, false), "use-by")).toBe("5 days left");
  });
});

describe("non-finite days", () => {
  it("treats NaN or infinite days as expired, asking to check the date", () => {
    expect(statusFor(Number.NaN, 2)).toBe("expired");
    expect(statusFor(Number.POSITIVE_INFINITY, 2)).toBe("expired");
    const bad = expiry(item({ addedAt: "not a date" }), FRIDGE);
    expect(bad.status).toBe("expired");
    expect(describeDaysLeft(bad, "best-before")).toBe("Check the date");
  });
});
