"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** False during server render and the first client render, true after. Use to avoid
 *  hydration mismatches when reading the persisted (localStorage) store. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
