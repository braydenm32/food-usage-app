/**
 * Everything Larder keeps in this browser, and a way to wipe it: after deleting an account, and
 * for Settings → "Erase everything".
 *
 * Every key Larder writes starts with "larder" (the store `larder-v1`, `larder-meal-log`,
 * `larder-sync`, the sign-in session `larder-auth` and its PKCE verifier, `larder-cook-timers`,
 * `larder-ai-ideas`, the push keys `larder-push-endpoint` and `larder-reminders-asked`, small
 * dismissals, and in sessionStorage `larder-recipe:*`, `larder-add:*`, `larder-ai-configured`).
 * Matching on the prefix also catches keys added later.
 *
 * The in-memory stores still hold their data afterwards and would write it straight back on
 * the next change, so callers reload the page right after (e.g. `window.location.replace("/")`).
 */

export const LOCAL_KEY_PREFIX = "larder";

/** The keys we know about, for reference and tests; the prefix sweep covers the rest. */
export const KNOWN_LOCAL_KEYS = [
  "larder-v1",
  "larder-meal-log",
  "larder-sync",
  "larder-auth",
  "larder-cook-timers",
  "larder-ai-ideas",
  "larder-push-endpoint",
  "larder-reminders-asked",
] as const;

function sweep(storage: Storage | undefined, explicit: readonly string[] = []) {
  if (!storage) return;
  try {
    const keys: string[] = [...explicit];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k?.startsWith(LOCAL_KEY_PREFIX)) keys.push(k);
    }
    for (const k of keys) storage.removeItem(k);
  } catch {
    // Storage blocked or unavailable: nothing we can clear.
  }
}

function storageOf(name: "localStorage" | "sessionStorage"): Storage | undefined {
  try {
    return typeof globalThis[name] === "undefined" ? undefined : globalThis[name];
  } catch {
    return undefined;
  }
}

/** Remove every Larder key from localStorage and sessionStorage on this device. Never throws. */
export function clearAllLocalData(): void {
  sweep(storageOf("localStorage"), KNOWN_LOCAL_KEYS);
  sweep(storageOf("sessionStorage"));
}
