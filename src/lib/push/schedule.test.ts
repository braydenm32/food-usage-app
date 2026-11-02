import { describe, expect, it } from "vitest";
import { isDue, isValidTimeZone, lastScheduledAt, zonedDateISO, zonedParts, zonedTimeToInstant } from "./schedule";

const SYD = "Australia/Sydney";
const PER = "Australia/Perth";
const ADL = "Australia/Adelaide";

describe("zoned time helpers", () => {
  it("reads the wall clock in another zone", () => {
    // 2026-11-02 06:00 UTC is 5 pm in Sydney (daylight time, +11) and 2 pm in Perth (+8).
    const t = new Date("2026-11-02T06:00:00Z");
    expect(zonedParts(t, SYD)).toMatchObject({ year: 2026, month: 11, day: 2, hour: 17, weekday: 1 });
    expect(zonedParts(t, PER)).toMatchObject({ hour: 14 });
    expect(zonedDateISO(new Date("2026-11-01T14:00:00Z"), SYD)).toBe("2026-11-02");
  });

  it("turns a local time into an instant, across daylight saving", () => {
    expect(zonedTimeToInstant(2026, 11, 2, 17, SYD).toISOString()).toBe("2026-11-02T06:00:00.000Z");
    // Winter in Sydney is +10.
    expect(zonedTimeToInstant(2026, 7, 1, 17, SYD).toISOString()).toBe("2026-07-01T07:00:00.000Z");
    // Adelaide is a half-hour zone (+10:30 in summer).
    expect(zonedTimeToInstant(2026, 11, 2, 17, ADL).toISOString()).toBe("2026-11-02T06:30:00.000Z");
    // Perth has no daylight saving.
    expect(zonedTimeToInstant(2026, 11, 2, 17, PER).toISOString()).toBe("2026-11-02T09:00:00.000Z");
  });

  it("validates zone names", () => {
    expect(isValidTimeZone(SYD)).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });
});

describe("lastScheduledAt", () => {
  const daily = { cadence: "daily" as const, hour: 17, timeZone: SYD };

  it("is today's slot once the hour has passed, else yesterday's", () => {
    expect(lastScheduledAt(new Date("2026-11-02T06:30:00Z"), daily).toISOString()).toBe("2026-11-02T06:00:00.000Z");
    expect(lastScheduledAt(new Date("2026-11-02T05:59:00Z"), daily).toISOString()).toBe("2026-11-01T06:00:00.000Z");
  });

  it("finds the last Sunday for weekly digests", () => {
    const weekly = { cadence: "weekly" as const, hour: 17, weekday: 0, timeZone: SYD };
    // Monday 2 Nov 2026, 9 am Sydney: last Sunday 5 pm was 1 Nov.
    expect(lastScheduledAt(new Date("2026-11-01T22:00:00Z"), weekly).toISOString()).toBe("2026-11-01T06:00:00.000Z");
    // Sunday 1 Nov, 4 pm: not yet, so the Sunday before.
    expect(lastScheduledAt(new Date("2026-11-01T05:00:00Z"), weekly).toISOString()).toBe("2026-10-25T06:00:00.000Z");
  });

  it("uses the local date, not the UTC one", () => {
    // 7 am Monday in Sydney is still Sunday in UTC; a 6 am daily slot is Monday's.
    const sixAm = { cadence: "daily" as const, hour: 6, timeZone: SYD };
    expect(lastScheduledAt(new Date("2026-11-01T20:00:00Z"), sixAm).toISOString()).toBe("2026-11-01T19:00:00.000Z");
  });
});

describe("isDue", () => {
  const daily = { cadence: "daily" as const, hour: 17, timeZone: SYD };
  const at5_30pm = new Date("2026-11-02T06:30:00Z");

  it("sends once per slot", () => {
    expect(isDue(at5_30pm, daily, "2026-11-01T06:05:00Z")).toBe(true);
    expect(isDue(at5_30pm, daily, "2026-11-02T06:05:00Z")).toBe(false);
  });

  it("an hourly sender at :00 UTC still reaches a half-hour zone", () => {
    const adelaide = { ...daily, timeZone: ADL };
    // 06:00 UTC is 4:30 pm in Adelaide: not yet. 07:00 UTC is 5:30 pm: due.
    expect(isDue(new Date("2026-11-02T06:00:00Z"), adelaide, "2026-11-01T07:00:00Z")).toBe(false);
    expect(isDue(new Date("2026-11-02T07:00:00Z"), adelaide, "2026-11-01T07:00:00Z")).toBe(true);
  });

  it("catches up a missed weekly digest", () => {
    const weekly = { cadence: "weekly" as const, hour: 17, weekday: 0, timeZone: SYD };
    // Last sent the Sunday before; the sender was down all Sunday 1 Nov. Tuesday it goes out.
    expect(isDue(new Date("2026-11-03T01:00:00Z"), weekly, "2026-10-25T06:00:00Z")).toBe(true);
    expect(isDue(new Date("2026-11-03T01:00:00Z"), weekly, "2026-11-01T06:00:00Z")).toBe(false);
  });

  it("a new subscription waits for its next slot", () => {
    // Subscribed at 5:10 pm; today's 5 pm slot has passed already.
    expect(isDue(new Date("2026-11-02T07:00:00Z"), daily, "2026-11-02T06:10:00Z")).toBe(false);
    expect(isDue(new Date("2026-11-03T06:00:00Z"), daily, "2026-11-02T06:10:00Z")).toBe(true);
  });

  it("treats a missing or broken time as never sent", () => {
    expect(isDue(at5_30pm, daily, null)).toBe(true);
    expect(isDue(at5_30pm, daily, "not a date")).toBe(true);
  });
});
