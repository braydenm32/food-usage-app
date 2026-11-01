"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BellRing, ChefHat, ChevronLeft, ChevronRight, Pause, Play, Plus, Timer, X } from "lucide-react";
import { Button, IconButton, cx } from "@/components/ui";
import { formatAmount, scaleIngredient } from "@/lib/recipes/quantity";
import { findTimers, formatClock } from "@/lib/recipes/timers";
import type { Recipe, RecipeIngredient } from "@/lib/types";

interface RunningTimer {
  id: string;
  label: string;
  step: number;
  total: number;
  /** ms timestamp when it ends, or null while paused. */
  endsAt: number | null;
  /** Seconds left, kept while paused. */
  left: number;
  rung: boolean;
}

/** Ingredients a step mentions by name, so the cook doesn't scroll back. */
function ingredientsForStep(step: string, ingredients: RecipeIngredient[]): RecipeIngredient[] {
  const s = step.toLowerCase();
  return ingredients.filter((ing) => {
    const words = ing.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);
    const last = words[words.length - 1];
    return !!last && (s.includes(ing.name.toLowerCase()) || s.includes(last) || s.includes(last.replace(/e?s$/, "")));
  });
}

/** Wall-clock time for event handlers. */
const clock = () => Date.now();
const timerId = (t: number) => `${t}-${Math.random().toString(36).slice(2)}`;

function beep() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.25, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.3);
    });
    setTimeout(() => void ctx.close(), 1500);
  } catch {
    // no audio available
  }
}

/**
 * Full-screen, step-by-step cooking view. Keeps the screen awake, shows each step's ingredients
 * and offers timers for any times in the step. Timers keep running when cook mode is closed.
 */
export function CookMode({
  open,
  onClose,
  recipe,
  factor,
  onFinish,
}: {
  open: boolean;
  onClose: () => void;
  recipe: Recipe;
  factor: number;
  onFinish: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(0);
  const [timers, setTimers] = useState<RunningTimer[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [awake, setAwake] = useState<"on" | "unsupported" | "off">("off");

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Keep the screen on while cooking. The lock drops when the tab is hidden, so take it again on return.
  useEffect(() => {
    if (!open) return;
    let lock: WakeLockSentinel | null = null;
    let live = true;
    const take = async () => {
      if (!("wakeLock" in navigator)) return setAwake("unsupported");
      try {
        lock = await navigator.wakeLock.request("screen");
        if (live) setAwake("on");
      } catch {
        if (live) setAwake("off");
      }
    };
    const onVis = () => document.visibilityState === "visible" && void take();
    void take();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release().catch(() => {});
    };
  }, [open]);

  const anyRunning = timers.some((t) => t.endsAt !== null && !t.rung);
  const timersRef = useRef(timers);
  useEffect(() => {
    timersRef.current = timers;
  }, [timers]);
  const titleRef = useRef(recipe.title);
  useEffect(() => {
    titleRef.current = recipe.title;
  }, [recipe.title]);

  // Tick while a timer runs, and ring any that have run out.
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const due = timersRef.current.filter((x) => x.endsAt !== null && !x.rung && x.endsAt <= t);
      if (due.length === 0) return;
      const ids = new Set(due.map((d) => d.id));
      setTimers((ts) => ts.map((x) => (ids.has(x.id) ? { ...x, rung: true, left: 0 } : x)));
      beep();
      navigator.vibrate?.([300, 150, 300, 150, 300]);
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
        try {
          new Notification("Timer done", { body: `${due[0].label} · step ${due[0].step + 1} of ${titleRef.current}`, tag: "larder-timer" });
        } catch {
          // some browsers only allow notifications from the service worker
        }
      }
    }, 500);
    return () => clearInterval(id);
  }, [anyRunning]);

  const steps = recipe.steps;
  const last = steps.length - 1;
  const current = steps[Math.min(step, last)] ?? "";
  const found = useMemo(() => findTimers(current), [current]);
  const stepIngredients = useMemo(() => ingredientsForStep(current, recipe.ingredients), [current, recipe.ingredients]);

  function startTimer(label: string, seconds: number) {
    if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission().catch(() => {});
    const t = clock();
    const timer: RunningTimer = { id: timerId(t), label, step, total: seconds, endsAt: t + seconds * 1000, left: seconds, rung: false };
    setNow(t);
    setTimers((ts) => [...ts, timer]);
  }
  function toggle(id: string) {
    const n = clock();
    setTimers((ts) =>
      ts.map((t) =>
        t.id !== id || t.rung ? t : t.endsAt === null ? { ...t, endsAt: n + t.left * 1000 } : { ...t, endsAt: null, left: Math.max(0, (t.endsAt - n) / 1000) },
      ),
    );
  }
  function addMinute(id: string) {
    const n = clock();
    setTimers((ts) =>
      ts.map((t) => (t.id !== id ? t : t.rung ? { ...t, rung: false, endsAt: n + 60_000, left: 60 } : t.endsAt === null ? { ...t, left: t.left + 60 } : { ...t, endsAt: t.endsAt + 60_000 })),
    );
    setNow(n);
  }
  const remove = (id: string) => setTimers((ts) => ts.filter((t) => t.id !== id));
  const leftOf = (t: RunningTimer) => (t.rung ? 0 : t.endsAt === null ? t.left : Math.max(0, (t.endsAt - now) / 1000));

  return (
    <dialog
      ref={ref}
      aria-label={`Cooking ${recipe.title}`}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="m-0 h-dvh max-h-none w-full max-w-none bg-paper p-0 text-ink open:flex open:flex-col backdrop:bg-black/40"
    >
      {open && (
        <>
          <header className="flex items-center justify-between gap-3 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))]">
            <div className="min-w-0">
              <p className="truncate text-sm text-ink-2">{recipe.title}</p>
              <p className="font-semibold text-ink">
                Step {Math.min(step, last) + 1} of {steps.length}
                {awake === "on" && <span className="ml-2 text-xs font-normal text-ink-3">Screen stays on</span>}
              </p>
            </div>
            <IconButton label="Close cook mode" onClick={onClose}>
              <X size={22} />
            </IconButton>
          </header>
          <div className="mx-4 mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${((Math.min(step, last) + 1) / Math.max(1, steps.length)) * 100}%` }} />
          </div>

          <main className="flex-1 overflow-y-auto px-5 py-6 lg:mx-auto lg:w-full lg:max-w-3xl">
            <p className="font-display text-[1.65rem] leading-snug text-ink lg:text-4xl" aria-live="polite">
              {current}
            </p>

            {found.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {found.map((f) => (
                  <Button key={f.label} variant="secondary" onClick={() => startTimer(f.label, f.seconds)}>
                    <Timer size={18} aria-hidden /> Start {f.label} timer
                  </Button>
                ))}
              </div>
            )}

            {stepIngredients.length > 0 && (
              <section className="mt-6 rounded-2xl bg-surface p-4" aria-label="Ingredients for this step">
                <h2 className="mb-2 text-sm font-semibold text-ink-2">For this step</h2>
                <ul className="space-y-1 text-[17px]">
                  {stepIngredients.map((ing, i) => {
                    const s = scaleIngredient(ing, factor);
                    return (
                      <li key={i}>
                        <span className="font-semibold">{formatAmount(s.quantity, s.unit, s.quantityMax)}</span> {ing.name}
                        {ing.note && <span className="text-ink-3">, {ing.note}</span>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </main>

          {timers.length > 0 && (
            <ul className="flex gap-2 overflow-x-auto px-4 pb-2" aria-label="Timers">
              {timers.map((t) => {
                const left = leftOf(t);
                return (
                  <li
                    key={t.id}
                    className={cx(
                      "flex shrink-0 items-center gap-1 rounded-2xl border py-1 pl-3 pr-1",
                      t.rung ? "animate-pulse border-spoiled bg-spoiled-soft" : "border-line bg-surface",
                    )}
                  >
                    {t.rung ? <BellRing size={18} className="text-spoiled" aria-hidden /> : <Timer size={16} className="text-ink-3" aria-hidden />}
                    <span className="min-w-[4.5rem] font-mono text-lg tabular-nums" role="timer" aria-label={`${t.label} timer, step ${t.step + 1}`}>
                      {t.rung ? "Done" : formatClock(left)}
                    </span>
                    <span className="mr-1 text-xs text-ink-3">step {t.step + 1}</span>
                    {!t.rung && (
                      <IconButton label={t.endsAt === null ? "Resume timer" : "Pause timer"} onClick={() => toggle(t.id)}>
                        {t.endsAt === null ? <Play size={18} /> : <Pause size={18} />}
                      </IconButton>
                    )}
                    <IconButton label="Add a minute" onClick={() => addMinute(t.id)}>
                      <Plus size={18} />
                    </IconButton>
                    <IconButton label="Dismiss timer" onClick={() => remove(t.id)}>
                      <X size={18} />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          )}

          <footer className="flex gap-2 border-t border-line px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
            <Button variant="secondary" size="lg" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} aria-label="Previous step">
              <ChevronLeft size={22} aria-hidden />
            </Button>
            {step < last ? (
              <Button size="lg" className="flex-1" onClick={() => setStep((s) => Math.min(last, s + 1))}>
                Next step <ChevronRight size={22} aria-hidden />
              </Button>
            ) : (
              <Button
                size="lg"
                className="flex-1"
                onClick={() => {
                  onClose();
                  setStep(0);
                  onFinish();
                }}
              >
                <ChefHat size={20} aria-hidden /> Done, update my larder
              </Button>
            )}
          </footer>
        </>
      )}
    </dialog>
  );
}
