"use client";

import { useSyncExternalStore } from "react";

const MINUTE = 60_000;
const subscribe = (cb: () => void) => {
  const t = setInterval(cb, MINUTE);
  return () => clearInterval(t);
};
const getSnapshot = () => Math.floor(Date.now() / MINUTE) * MINUTE;
const getServerSnapshot = () => 0;

/**
 * The current time in ms, rounded to the minute, as a stable render-safe value.
 * Returns 0 during server render and hydration so prerendering never reads the
 * clock; pair with useHydrated() before showing anything time-based.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
