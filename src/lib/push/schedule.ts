/**
 * When a reminder digest is due, in the household's own time zone.
 *
 * Pure functions with no browser or server dependencies, shared by the in-app reminder
 * (the browser's own zone) and the hourly push sender (each subscription's saved zone).
 */

export type Cadence = "daily" | "weekly";

export interface DigestSchedule {
  cadence: Cadence;
  /** Local hour, 0-23. */
  hour: number;
  /** Day of the week for weekly digests, 0 = Sunday. */
  weekday?: number;
  /** IANA zone, e.g. "Australia/Sydney". */
  timeZone: string;
}

export interface ZonedParts {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** True for a zone name this runtime understands. */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || !timeZone || timeZone.length > 64) return false;
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock date and time at `instant` in `timeZone`. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const out: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(instant)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    weekday: WEEKDAYS[out.weekday] ?? 0,
  };
}

/** "2026-11-02": the calendar date at `instant` in `timeZone`. */
export function zonedDateISO(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Offset of `timeZone` from UTC at `instant`, in ms (Sydney in summer: +11 h). */
function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(instant.getTime() / 60_000) * 60_000;
}

/**
 * The instant when the wall clock in `timeZone` reads `year-month-day hour:00`.
 * In a daylight-saving gap (2 am that doesn't exist) it lands an hour later, which is fine for reminders.
 */
export function zonedTimeToInstant(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour);
  const first = guess - offsetMs(new Date(guess), timeZone);
  // Re-check with the offset at the answer, in case a DST change sits between the guess and it.
  const second = guess - offsetMs(new Date(first), timeZone);
  return new Date(second);
}

/**
 * The most recent scheduled digest time at or before `now`: today's (or the last matching
 * weekday's) `hour:00` in the schedule's zone. A missed one stays the latest until the next
 * comes round, so a reminder that couldn't go out still goes out late rather than never.
 */
export function lastScheduledAt(now: Date, s: DigestSchedule): Date {
  const hour = Math.min(23, Math.max(0, Math.floor(s.hour)));
  const local = zonedParts(now, s.timeZone);
  // Walk back from today (in local calendar days) to the first slot that has already passed.
  const base = Date.UTC(local.year, local.month - 1, local.day);
  for (let back = 0; back <= 8; back++) {
    const d = new Date(base - back * 86_400_000);
    const weekday = d.getUTCDay();
    if (s.cadence === "weekly" && weekday !== (s.weekday ?? 0)) continue;
    const slot = zonedTimeToInstant(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, s.timeZone);
    if (slot.getTime() <= now.getTime()) return slot;
  }
  // Unreachable for valid input; fall back to a week ago.
  return new Date(now.getTime() - 7 * 86_400_000);
}

/**
 * Whether a digest is due: the latest scheduled time has passed and nothing was sent since.
 * `since` is when the last digest went out, or (for a new subscription) when it was made, so a
 * brand new subscription waits for the next slot instead of firing straight away.
 */
export function isDue(now: Date, s: DigestSchedule, since: Date | string | null | undefined): boolean {
  const slot = lastScheduledAt(now, s);
  if (since === null || since === undefined) return true;
  const t = typeof since === "string" ? new Date(since).getTime() : since.getTime();
  if (Number.isNaN(t)) return true;
  return t < slot.getTime();
}

/** This browser's zone, e.g. "Australia/Melbourne". Falls back to Sydney time. */
export function browserTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isValidTimeZone(tz)) return tz;
  } catch {
    // Old browsers: fall through.
  }
  return "Australia/Sydney";
}
