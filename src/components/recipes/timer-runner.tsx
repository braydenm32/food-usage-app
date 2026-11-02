"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BellRing, Timer } from "lucide-react";
import { beep, notifyTimer, secondsLeft, useCookTimers } from "@/lib/cook-timers";
import { formatClock } from "@/lib/recipes/timers";
import { useHydrated } from "@/lib/use-hydrated";

const clock = () => Date.now();

/**
 * Runs cooking timers app-wide: ticks, rings (sound, vibration, notification, repeating until
 * dismissed) and shows a small pill outside cook mode so a running timer is never forgotten.
 */
export function TimerRunner() {
  const hydrated = useHydrated();
  const timers = useCookTimers((s) => s.timers);
  const ring = useCookTimers((s) => s.ring);
  const [now, setNow] = useState(clock);
  const pathname = usePathname();
  const inCookMode = useSearchParams().get("cook") === "1";

  const active = timers.some((t) => t.endsAt !== null && !t.rung);
  const ringing = timers.some((t) => t.rung);

  useEffect(() => {
    if (!active) return;
    const tick = () => {
      const n = clock();
      setNow(n);
      const due = useCookTimers.getState().timers.filter((t) => t.endsAt !== null && !t.rung && t.endsAt <= n);
      if (due.length === 0) return;
      ring(due.map((t) => t.id));
      beep();
      navigator.vibrate?.([300, 150, 300, 150, 300]);
      if (document.visibilityState !== "visible") due.forEach((t) => void notifyTimer(t));
    };
    tick();
    const id = setInterval(tick, 500);
    // Background tabs throttle intervals; catch up as soon as we're visible again.
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [active, ring]);

  // Keep beeping every few seconds until the ringing timer is dismissed or extended (max 2 minutes).
  useEffect(() => {
    if (!ringing) return;
    const started = clock();
    const id = setInterval(() => {
      if (clock() - started > 120_000) return clearInterval(id);
      beep();
    }, 4000);
    return () => clearInterval(id);
  }, [ringing]);

  if (!hydrated || timers.length === 0 || inCookMode) return null;
  // Show the soonest, or a ringing one first.
  const t = [...timers].sort((a, b) => Number(b.rung) - Number(a.rung) || secondsLeft(a, now) - secondsLeft(b, now))[0];
  const href = `/recipes/${encodeURIComponent(t.recipeId)}?cook=1`;
  if (pathname === `/recipes/${encodeURIComponent(t.recipeId)}` && !t.rung) return null;
  return (
    <Link
      href={href}
      className={
        "fixed left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold shadow-lg bottom-[calc(5.5rem+env(safe-area-inset-bottom))] lg:bottom-6 " +
        (t.rung ? "bg-spoiled text-on-status" : "bg-ink text-paper")
      }
      aria-label={t.rung ? `${t.label} timer done for ${t.recipeTitle}. Open cook mode` : `${t.label} timer, ${formatClock(secondsLeft(t, now))} left. Open cook mode`}
    >
      {t.rung ? <BellRing size={18} aria-hidden /> : <Timer size={18} aria-hidden />}
      <span className="tabular-nums">{t.rung ? "Timer done" : formatClock(secondsLeft(t, now))}</span>
      <span className="max-w-[10rem] truncate font-normal opacity-80">{t.recipeTitle}</span>
      {timers.length > 1 && <span className="font-normal opacity-80">+{timers.length - 1}</span>}
    </Link>
  );
}
