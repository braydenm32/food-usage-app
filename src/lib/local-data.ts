/**
 * Remove everything Larder keeps in this browser: every `larder-*` localStorage key (the
 * larder, meal log, cook timers, AI ideas, sync queue, sign-in session, small remembered flags)
 * and the per-recipe caches in sessionStorage. Copies on the server are not touched here.
 * Safe to call when storage is blocked.
 */
export function clearAllLocalData(): void {
  if (typeof window === "undefined") return;
  const sweep = (get: () => Storage, match: (key: string) => boolean) => {
    try {
      const store = get();
      const keys: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k && match(k)) keys.push(k);
      }
      for (const k of keys) store.removeItem(k);
    } catch {
      // storage blocked: nothing to clear
    }
  };
  sweep(() => window.localStorage, (k) => k.startsWith("larder-"));
  sweep(() => window.sessionStorage, (k) => k.startsWith("larder-recipe:") || k.startsWith("larder-add:"));
}
