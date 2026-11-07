/**
 * Links that came from elsewhere (a recipe site, TheMealDB, an import, a synced recipe) are only
 * rendered as links, or used as images, when they are plain http(s) addresses. Anything else
 * (javascript:, data:, relative paths) is dropped.
 */
export function isWebUrl(v: unknown): v is string {
  if (typeof v !== "string" || !/^https?:\/\//i.test(v.trim())) return false;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** `v` when it is a web address, otherwise undefined. */
export function webUrl(v: unknown): string | undefined {
  return isWebUrl(v) ? v.trim() : undefined;
}

/** A whole number from a query value, kept within min..max; `fallback` when it isn't a number. */
export function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  const n = Math.trunc(Number(raw));
  if (raw === null || raw.trim() === "" || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
