"use client";

import { useEffect, useRef } from "react";
import { useLarder } from "@/lib/store";
import { useItemViews } from "@/lib/selectors";
import { useHydrated } from "@/lib/use-hydrated";
import { runDigestIfDue } from "@/lib/reminders";
import { useSyncStatus } from "@/lib/sync/status";
import { backgroundRemindersActive, ensurePushSubscription, removePushSubscription } from "@/lib/push/client";

/**
 * Reminders, two ways. Renders nothing.
 *
 * - Background: with an account in a household, this device's push subscription and
 *   reminder preferences are kept in step with Settings, and the server sends the digest.
 * - In-app: otherwise, the digest is shown as a notification when Larder is opened or comes
 *   back into view and one is due (a missed weekly digest shows on the next open).
 */
export function ReminderRunner() {
  const hydrated = useHydrated();
  const views = useItemViews();
  const settings = useLarder((s) => s.settings);
  const householdId = useSyncStatus((s) => (s.userId ? s.householdId : null));
  const latest = useRef({ views, settings });
  useEffect(() => {
    latest.current = { views, settings };
  }, [views, settings]);

  // Keep the server's copy of this device's reminder preferences up to date.
  const { pushEnabled, digest, digestHour, useSoonDays } = settings;
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      if (pushEnabled && digest !== "off" && householdId) {
        void ensurePushSubscription({ digest, digestHour, useSoonDays });
      } else if (!pushEnabled || digest === "off") {
        void removePushSubscription();
      }
      // Signed out or no household: leave the subscription; the server stops when membership ends.
    }, 1200);
    return () => clearTimeout(t);
  }, [hydrated, pushEnabled, digest, digestHour, useSoonDays, householdId]);

  // The service worker says the browser swapped this device's subscription: save the new one.
  useEffect(() => {
    if (!hydrated || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === "larder-push-resubscribe") void ensurePushSubscription();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const check = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      // The server sends this device's digests; don't show a second copy.
      if (backgroundRemindersActive()) return;
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
