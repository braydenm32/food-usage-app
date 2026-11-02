import { describe, expect, it } from "vitest";
import {
  computeExpiry,
  dateLabel,
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
    for (const name of ["Kangaroo fillet", "Pork belly", "Fish cakes", "Chicken kiev", "Snags", "Barramundi", "Flathead tails", "Rainbow trout", "Whiting", "Bream", "Fresh tuna", "Sardines", "Baby octopus", "Wagyu patties"]) {
      expect(isHighRisk(name), name).toBe(true);
    }
    for (const name of ["Mango chutney", "Tuna in springwater", "Tinned sardines", "Beef jerky", "Chicken stock", "Fish sauce"]) {
      expect(isHighRisk(name), name).toBe(false);
    }
    // Words like sauce, flavour, dog or chips don't make raw meat shelf stable.
    for (const name of ["Hot Dog Sausages", "Chicken Fillets in Teriyaki Sauce", "Honey soy flavoured chicken wings", "Pork belly with chilli paste", "Fish and chips crumbed fillets", "Beef sausages with cheese"]) {
      expect(isHighRisk(name), name).toBe(true);
    }
    for (const name of ["Oyster sauce", "Prawn crackers", "Chicken 2 minute noodles", "Beef stock powder", "Dried shrimp", "Tuna in oil", "Canned salmon"]) {
      expect(isHighRisk(name), name).toBe(false);
    }
    expect(defaultsForUnknown("Beef strips")).toMatchObject({ locationId: "fridge", dateKind: "use-by", days: 2, highRisk: true });
    expect(expiry(item({ name: "Beef strips" }), FRIDGE).daysLeft).toBe(2);
    // Raw meat left on the bench: use it today.
    expect(expiry(item({ name: "Beef strips" }), PANTRY).daysLeft).toBe(0);
  });

  it("keeps a short, cautious 7 days for unknown foods in the pantry and 90 frozen", () => {
    expect(expiry(item({ name: "Mystery crackers" }), PANTRY).daysLeft).toBe(7);
    expect(expiry(item({ name: "Mystery crackers", frozenAt: daysAgo(0) }), FREEZER).daysLeft).toBe(90);
  });
});

describe("known food with no days for its spot", () => {
  it("uses a safe short stand-in and says where it belongs", () => {
    const milk = getFoodType("milk-full-cream");
    expect(storageWarning(milk, "pantry")).toBe("Not suited to the pantry — move it to the fridge");
    expect(storageWarning(milk, "fridge")).toBeUndefined();
    const info = expiry(item({ foodTypeId: "milk-full-cream", dateKind: "use-by" }), PANTRY);
    expect(info.daysLeft).toBe(1);
    expect(info.basis).toMatch(/move it to the fridge/);
  });

  it("never lends a perishable the other spot's long life", () => {
    // Potatoes keep 5 weeks in the pantry, not in the fridge.
    expect(storageDays(getFoodType("potato"), undefined, "fridge")).toBe(3);
    // A frozen-only food left in the fridge or pantry.
    expect(storageDays(getFoodType("frozen-chips"), undefined, "fridge")).toBe(3);
    expect(storageDays(getFoodType("frozen-chips"), undefined, "pantry")).toBe(1);
    // "Tuna" in the fridge is fresh fish, not the tin it matched.
    expect(storageDays(getFoodType("tuna-tin"), undefined, "fridge", "Tuna")).toBe(2);
    expect(storageDays(getFoodType("tuna-tin"), undefined, "fridge", "Tinned tuna")).toBe(1095);
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

describe("opened clock", () => {
  it("never makes an item fresher by opening it (estimated dates)", () => {
    // Milk added 8 days ago is past its 7 fridge days; opening it today must not reset it.
    const milk = item({ foodTypeId: "milk-full-cream", dateKind: "use-by", addedAt: daysAgo(8), openedAt: daysAgo(0) });
    const info = expiry(milk, FRIDGE);
    expect(info.status).toBe("expired");
    expect(info.basis).toMatch(/already close to its date/);
    // Yoghurt opened on day 12 of 14 gets 2 more days, not 5.
    const yog = item({ foodTypeId: "yoghurt-natural", dateKind: "use-by", addedAt: daysAgo(12), openedAt: daysAgo(0) });
    expect(expiry(yog, FRIDGE).daysLeft).toBe(2);
    // Opened soon after buying: the opened life applies.
    const fresh = item({ foodTypeId: "yoghurt-natural", dateKind: "use-by", addedAt: daysAgo(1), openedAt: daysAgo(0) });
    expect(expiry(fresh, FRIDGE).daysLeft).toBe(5);
  });

  it("caps at a printed best-before date too", () => {
    const jam = item({ foodTypeId: "yoghurt-natural", dateKind: "best-before", printedDate: "2026-10-30", openedAt: daysAgo(0) });
    const info = expiry(jam, FRIDGE);
    expect(info.daysLeft).toBe(1);
    expect(info.estimated).toBe(false);
  });

  it("keeps a pantry jar's life when it's opened into the fridge", () => {
    const sauce = item({ foodTypeId: "tomato-sauce", addedAt: daysAgo(40), openedAt: daysAgo(0) });
    expect(expiry(sauce, FRIDGE).daysLeft).toBe(getFoodType("tomato-sauce")!.openedDays);
  });
});

describe("dateLabel", () => {
  it("says best quality by in the freezer", () => {
    expect(dateLabel("use-by", "freezer")).toBe("Best quality by");
    expect(dateLabel("use-by", "fridge")).toBe("Use by");
    expect(dateLabel("best-before", "pantry")).toBe("Best before");
    expect(dateLabel("use-by", "freezer", { thawed: true })).toBe("Use by");
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

  it("rounds long spans in plain words", () => {
    expect(describeDaysLeft(info(364, false), "best-before")).toBe("about a year left");
    expect(describeDaysLeft(info(200, true), "best-before")).toBe("about 7 months left");
    expect(describeDaysLeft(info(12775, false), "best-before")).toBe("about 35 years left");
    expect(describeDaysLeft(info(-2862, false), "best-before")).toBe("Past best before (about 8 years ago)");
    expect(describeDaysLeft(info(-30, false), "use-by")).toBe("Likely spoiled (about 4 weeks ago)");
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
