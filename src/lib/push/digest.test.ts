import { describe, expect, it } from "vitest";
import { householdDigest, householdViews, type RecordRow } from "./digest";

const item = (id: string, data: Record<string, unknown>): RecordRow => ({
  collection: "items",
  id,
  data: { name: id, foodTypeId: null, emoji: "🥬", locationId: "fridge", quantity: 1, initialQuantity: 1, unit: "item", dateKind: "use-by", source: "manual", addedAt: "2026-10-01T00:00:00Z", ...data },
});

describe("householdDigest", () => {
  // 5 pm Monday 2 Nov in Sydney.
  const now = new Date("2026-11-02T06:00:00Z");
  const opts = { useSoonDays: 2, now, timeZone: "Australia/Sydney" };

  it("uses printed dates in the household's own calendar", () => {
    const rows = [
      item("Spinach", { printedDate: "2026-11-02" }),
      item("Yoghurt", { printedDate: "2026-11-03" }),
      item("Rice", { printedDate: "2027-05-01", locationId: "pantry" }),
    ];
    const d = householdDigest(rows, opts);
    expect(d?.title).toBe("1 thing to use today");
    expect(d?.body).toBe("spinach. Plus 1 more to use soon.");
    expect(d?.url).toBe("/");
  });

  it("is null when nothing needs attention, and skips junk and used-up rows", () => {
    const rows: RecordRow[] = [
      item("Rice", { printedDate: "2027-05-01" }),
      item("Gone", { printedDate: "2026-11-02", quantity: 0 }),
      { collection: "items", id: "bad", data: { name: 3 } },
      { collection: "items", id: "deleted", data: null },
    ];
    expect(householdDigest(rows, opts)).toBeNull();
  });

  it("applies custom spots and overrides", () => {
    const rows: RecordRow[] = [
      { collection: "locations", id: "chest", data: { name: "Chest freezer", kind: "freezer" } },
      item("Peas", { locationId: "chest", addedAt: "2026-10-30T00:00:00Z" }),
    ];
    const v = householdViews(rows, opts);
    expect(v[0].location?.name).toBe("Chest freezer");
    expect(v[0].expiry.status).toBe("fresh");
  });

  it("counts estimates from the day food was added in the household's zone", () => {
    // 1 am Sunday 1 Nov in Sydney is still 31 Oct in UTC. Unknown food: 5 fridge days from Sydney's 1 Nov.
    const rows = [item("Mystery dip", { dateKind: "best-before", addedAt: "2026-10-31T14:00:00Z" })];
    const v = householdViews(rows, opts);
    expect(v[0].expiry.daysLeft).toBe(4);
  });

  it("flags high-risk food a day early, like the app", () => {
    const rows = [
      item("Salmon fillets", { foodTypeId: "salmon-fillet", printedDate: "2026-11-05" }),
      item("Mystery jam", { dateKind: "best-before", printedDate: "2026-11-05" }),
    ];
    const v = householdViews(rows, opts);
    expect(v.find((x) => x.item.name === "Salmon fillets")?.expiry.status).toBe("use-soon");
    expect(v.find((x) => x.item.name === "Mystery jam")?.expiry.status).toBe("fresh");
  });
});
