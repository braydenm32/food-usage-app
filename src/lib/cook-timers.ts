"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Cooking timers live here, not in cook mode, so they keep running (and ringing) when you
 * close cook mode, change page or reload. Stored per device in localStorage.
 */

export interface CookTimer {
  id: string;
  label: string;
  recipeId: string;
  recipeTitle: string;
  step: number;
  total: number;
  /** ms timestamp when it ends, or null while paused. */
  endsAt: number | null;
  /** Seconds left, kept while paused. */
  left: number;
  rung: boolean;
}

interface TimerState {
  timers: CookTimer[];
  start: (t: Omit<CookTimer, "id" | "endsAt" | "left" | "rung">, now: number) => void;
  toggle: (id: string, now: number) => void;
  addMinute: (id: string, now: number) => void;
  remove: (id: string) => void;
  /** Mark these as rung; returns nothing, the runner handles sound. */
  ring: (ids: string[]) => void;
}

const newId = (now: number) => `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const useCookTimers = create<TimerState>()(
  persist(
    (set) => ({
      timers: [],
      start: (t, now) =>
        set((s) => ({ timers: [...s.timers, { ...t, id: newId(now), endsAt: now + t.total * 1000, left: t.total, rung: false }] })),
      toggle: (id, now) =>
        set((s) => ({
          timers: s.timers.map((t) =>
            t.id !== id || t.rung ? t : t.endsAt === null ? { ...t, endsAt: now + t.left * 1000 } : { ...t, endsAt: null, left: Math.max(0, (t.endsAt - now) / 1000) },
          ),
        })),
      addMinute: (id, now) =>
        set((s) => ({
          timers: s.timers.map((t) =>
            t.id !== id ? t : t.rung ? { ...t, rung: false, endsAt: now + 60_000, left: 60 } : t.endsAt === null ? { ...t, left: t.left + 60 } : { ...t, endsAt: t.endsAt + 60_000 },
          ),
        })),
      remove: (id) => set((s) => ({ timers: s.timers.filter((t) => t.id !== id) })),
      ring: (ids) => set((s) => ({ timers: s.timers.map((t) => (ids.includes(t.id) ? { ...t, rung: true, left: 0 } : t)) })),
    }),
    {
      name: "larder-cook-timers",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s) => ({ timers: s.timers }),
    },
  ),
);

export function secondsLeft(t: CookTimer, now: number): number {
  return t.rung ? 0 : t.endsAt === null ? t.left : Math.max(0, (t.endsAt - now) / 1000);
}

/* ---------- alarm sound ---------- */

let ctx: AudioContext | null = null;

/** Call from a tap (Start timer): iOS only lets audio play from a context unlocked by a user gesture. */
export function unlockAlarm() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx ??= new AC();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    ctx = null;
  }
}

/** Three short beeps. Safe to call repeatedly; silent when audio isn't available. */
export function beep() {
  if (!ctx) return;
  try {
    if (ctx.state === "suspended") void ctx.resume();
    const c = ctx;
    [0, 0.35, 0.7].forEach((t) => {
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.3, c.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + t + 0.3);
      o.connect(g).connect(c.destination);
      o.start(c.currentTime + t);
      o.stop(c.currentTime + t + 0.3);
    });
  } catch {
    // ignore
  }
}

/** Ask once, from a tap, so a timer can still alert when the phone is locked or the tab is hidden. */
export function askTimerNotifications() {
  if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission().catch(() => {});
}

export async function notifyTimer(t: CookTimer) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const title = `${t.label} timer done`;
  const options: NotificationOptions = {
    body: `Step ${t.step + 1} of ${t.recipeTitle}`,
    tag: `larder-timer-${t.id}`,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    requireInteraction: true,
    data: { url: `/recipes/${encodeURIComponent(t.recipeId)}?cook=1` },
  };
  try {
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, options);
      return;
    }
  } catch {
    // fall through
  }
  try {
    new Notification(title, options);
  } catch {
    // Android Chrome only allows service-worker notifications
  }
}
