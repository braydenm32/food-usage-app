"use client";

import { useEffect, useRef } from "react";
import { useLarder } from "@/lib/store";
import { useItemViews } from "@/lib/selectors";
import { useHydrated } from "@/lib/use-hydrated";
import { runDigestIfDue } from "@/lib/reminders";

/**
 * Sends the "use soon" digest as a local notification when the app is opened
 * or comes back into view and a digest is due. Renders nothing.
 */
export function ReminderRunner() {
  const hydrated = useHydrated();
  const views = useItemViews();
  const settings = useLarder((s) => s.settings);
  const latest = useRef({ views, settings });
  useEffect(() => {
    latest.current = { views, settings };
  }, [views, settings]);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const check = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      const { views, settings } = latest.current;
      runDigestIfDue(views, settings).catch(() => {});
    };
    // Give the persisted store a tick to settle before judging what's urgent.
    const t = setTimeout(check, 1500);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    return () => {
      cancelled = true;
      clearTimeout(t);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("focus", check);
    };
  }, [hydrated]);

  return null;
}
