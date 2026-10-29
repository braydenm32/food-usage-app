import { describe, expect, it } from "vitest";
import { buildDigest, digestLine, isDigestDue } from "./reminders";
import type { ItemView } from "./selectors";
import type { ItemStatus, PantryItem } from "./types";

function view(name: string, status: ItemStatus, daysLeft = 0): ItemView {
  const item: PantryItem = {
    id: name,
    name,
    foodTypeId: null,
    emoji: "🥬",
    locationId: "fridge",
    quantity: 1,
    initialQuantity: 1,
    unit: "item",
    addedAt: "2026-10-20T00:00:00.000Z",
    dateKind: "use-by",
    source: "manual",
  };
  return {
    item,
    expiry: { expiresOn: new Date(), estimated: true, daysLeft, status, basis: "test" },
  };
}

describe("buildDigest", () => {
  it("returns null when nothing needs attention", () => {
    expect(buildDigest([])).toBeNull();
    expect(buildDigest([view("Rice", "fresh", 40)])).toBeNull();
  });

  it("lists things to use today, most urgent first", () => {
    const d = buildDigest([
      view("Baby spinach", "use-today"),
      view("Beef mince", "use-today"),
      view("Greek yoghurt", "use-today"),
      view("Rice", "fresh", 40),
    ]);
    expect(d).not.toBeNull();
    expect(digestLine(d!)).toBe("3 things to use today: baby spinach, beef mince, greek yoghurt");
    expect(d!.count).toBe(3);
  });

  it("uses singular wording for one item", () => {
    const d = buildDigest([view("Milk", "use-today")]);
    expect(d!.title).toBe("1 thing to use today");
  });

  it("truncates long lists and mentions use-soon and check counts", () => {
    const d = buildDigest([
      view("A", "use-today"),
      view("B", "use-today"),
      view("C", "use-today"),
      view("D", "use-today"),
      view("E", "use-today"),
      view("Milk", "use-soon", 2),
      view("Old cheese", "expired", -3),
    ]);
    expect(d!.title).toBe("5 things to use today");
    expect(d!.body).toBe("a, b, c, d and 1 more. Plus 1 more to use soon and 1 to check.");
  });

  it("falls back to use-soon, then to check-it items", () => {
    expect(digestLine(buildDigest([view("Milk", "use-soon", 2), view("Broccoli", "use-soon", 1)])!)).toBe(
      "2 things to use soon: milk, broccoli",
    );
    const check = buildDigest([view("Tasty cheese", "expired", -2)]);
    expect(check!.title).toBe("1 thing to check");
    expect(check!.body).toContain("tasty cheese");
  });
});

describe("isDigestDue", () => {
  const base = { digest: "daily" as const, digestHour: 17, pushEnabled: true };
  // 2026-10-29 is a Thursday; 2026-11-01 is a Sunday.
  const thu18 = new Date(2026, 9, 29, 18, 0);
  const thu9 = new Date(2026, 9, 29, 9, 0);
  const sun18 = new Date(2026, 10, 1, 18, 0);

  it("is never due when push is off or digest is off", () => {
    expect(isDigestDue({ ...base, pushEnabled: false }, null, thu18)).toBe(false);
    expect(isDigestDue({ ...base, digest: "off" }, null, thu18)).toBe(false);
  });

  it("waits for the chosen hour", () => {
    expect(isDigestDue(base, null, thu9)).toBe(false);
    expect(isDigestDue(base, null, thu18)).toBe(true);
  });

  it("sends once per local day", () => {
    expect(isDigestDue(base, new Date(2026, 9, 29, 17, 5).toISOString(), thu18)).toBe(false);
    expect(isDigestDue(base, new Date(2026, 9, 28, 17, 5).toISOString(), thu18)).toBe(true);
    expect(isDigestDue(base, "not a date", thu18)).toBe(true);
  });

  it("weekly digests only go on Sundays", () => {
    const weekly = { ...base, digest: "weekly" as const };
    expect(isDigestDue(weekly, null, thu18)).toBe(false);
    expect(isDigestDue(weekly, null, sun18)).toBe(true);
    expect(isDigestDue(weekly, new Date(2026, 10, 1, 17, 1).toISOString(), sun18)).toBe(false);
  });
});
