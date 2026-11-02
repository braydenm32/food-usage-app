"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BellRing, ChefHat, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Pause, Play, Plus, Timer, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui";
import { askTimerNotifications, secondsLeft, unlockAlarm, useCookTimers } from "@/lib/cook-timers";
import { displayIngredient, formatAmount, ingredientName, tbspOf } from "@/lib/recipes/quantity";
import { useLarder } from "@/lib/store";
import { findTimers, formatClock } from "@/lib/recipes/timers";
import type { Recipe, RecipeIngredient } from "@/lib/types";

const clock = () => Date.now();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Ingredients a step names, matched on whole words ("oil" doesn't match "boil"). */
export function ingredientsForStep(step: string, ingredients: RecipeIngredient[]): RecipeIngredient[] {
  return ingredients.filter((ing) => {
    const words = ing.name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);
    const last = words[words.length - 1];
    if (!last) return false;
    const stem = last.replace(/(es|s)$/, "");
    const forms = [...new Set([ing.name.toLowerCase(), last, stem].filter((f) => f.length > 2))];
    return forms.some((f) => new RegExp(`\\b${escapeRe(f)}(e?s)?\\b`, "i").test(step));
  });
}

const endTime = (ms: number) => new Date(ms).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });

/**
 * Full-screen, step-by-step cooking view. Keeps the screen awake, shows each step's ingredients
 * and offers timers for the times in a step. Timers are app-wide, so they survive closing this.
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
  const headingRef = useRef<HTMLParagraphElement>(null);
  const [step, setStep] = useState(0);
  const [awake, setAwake] = useState(false);
  const [now, setNow] = useState(clock);
  const all = useCookTimers((s) => s.timers);
  const start = useCookTimers((s) => s.start);
  const toggle = useCookTimers((s) => s.toggle);
  const addMinute = useCookTimers((s) => s.addMinute);
  const remove = useCookTimers((s) => s.remove);
  const timers = all.filter((t) => t.recipeId === recipe.id);
  const ringing = timers.filter((t) => t.rung);
  const running = timers.filter((t) => !t.rung);

  // Each time cook mode opens: start at step 1, or at the latest step with a running timer.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setStep(running.length ? Math.max(...running.map((t) => t.step)) : 0);
  }

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Move focus to the step text so screen readers read the new step, not the whole page.
  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open, step]);

  // Keep the screen on while cooking. The lock drops when the tab is hidden, so take it again on return.
  useEffect(() => {
    if (!open) return;
    let lock: WakeLockSentinel | null = null;
    let live = true;
    const take = async () => {
      if (!("wakeLock" in navigator)) return;
      try {
        lock = await navigator.wakeLock.request("screen");
        if (live) setAwake(true);
      } catch {
        if (live) setAwake(false);
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

  const ticking = open && running.some((t) => t.endsAt !== null);
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(clock()), 500);
    return () => clearInterval(id);
  }, [ticking]);

  const steps = recipe.steps;
  const last = Math.max(0, steps.length - 1);
  const at = Math.min(step, last);
  const current = steps[at] ?? "";
  const found = useMemo(() => findTimers(current), [current]);
  const stepIngredients = useMemo(() => ingredientsForStep(current, recipe.ingredients), [current, recipe.ingredients]);

  const saveRecipe = useLarder((s) => s.saveRecipe);
  const isSaved = useLarder((s) => s.savedRecipes.some((r) => r.id === recipe.id));
  function startTimer(label: string, seconds: number) {
    unlockAlarm();
    askTimerNotifications();
    // The timer links back to this recipe, so AI and library ideas need to outlive this visit.
    if (!recipe.id.startsWith("builtin-") && !isSaved) saveRecipe(recipe);
    const n = clock();
    setNow(n);
    start({ label, recipeId: recipe.id, recipeTitle: recipe.title, step: at, total: seconds }, n);
  }

  const go = (to: number) => setStep(Math.max(0, Math.min(last, to)));
  const touch = useRef<{ x: number; y: number } | null>(null);
  const [overview, setOverview] = useState(false);
  const stepHint = (i: number) => {
    const words = (steps[i] ?? "").split(/\s+/).slice(0, 4).join(" ");
    return words ? `${words}…` : "";
  };

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
              <button
                type="button"
                aria-expanded={overview}
                onClick={() => setOverview((v) => !v)}
                className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-full px-1 font-semibold text-ink hover:text-primary"
              >
                {overview ? "All steps and ingredients" : `Step ${at + 1} of ${steps.length}`}
                {overview ? <ChevronUp size={18} aria-hidden /> : <ChevronDown size={18} aria-hidden />}
              </button>
              {awake && <span className="ml-2 text-xs font-normal text-ink-3">Screen stays on</span>}
            </div>
            <IconButton label="Close cook mode (timers keep running)" onClick={onClose}>
              <X size={22} />
            </IconButton>
          </header>
          <div className="mx-4 mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${((at + 1) / Math.max(1, steps.length)) * 100}%` }} />
          </div>

          {ringing.length > 0 && (
            <div role="alert" className="mx-4 mt-3 flex items-center gap-2 rounded-2xl bg-spoiled py-2 pl-4 pr-2 text-on-status">
              <BellRing size={24} className="shrink-0 motion-safe:animate-pulse" aria-hidden />
              <p className="min-w-0 flex-1 font-semibold">
                {ringing[0].label} is up <span className="font-normal opacity-90">· step {ringing[0].step + 1}</span>
              </p>
              <button type="button" onClick={() => addMinute(ringing[0].id, clock())} className="min-h-11 shrink-0 rounded-full px-3 text-sm font-semibold hover:underline">
                +1 min
              </button>
              <button type="button" onClick={() => remove(ringing[0].id)} className="min-h-11 shrink-0 rounded-full bg-on-status px-5 text-base font-bold text-spoiled">
                Stop
              </button>
            </div>
          )}

          <main
            className="flex-1 overflow-y-auto px-5 py-6 lg:mx-auto lg:w-full lg:max-w-3xl"
            onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
            onTouchEnd={(e) => {
              const t0 = touch.current;
              touch.current = null;
              if (!t0) return;
              const dx = e.changedTouches[0].clientX - t0.x;
              const dy = e.changedTouches[0].clientY - t0.y;
              if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(at + (dx < 0 ? 1 : -1));
            }}
          >
            {overview ? (
              <div>
                <h2 className="mb-2 text-sm font-semibold text-ink-2">Ingredients</h2>
                <ul className="mb-6 space-y-1 text-[17px]">
                  {recipe.ingredients.map((ing, i) => {
                    const s = displayIngredient(ing, factor, tbspOf(recipe));
                    return (
                      <li key={i}>
                        <span className="font-semibold">{formatAmount(s.quantity, s.unit, s.quantityMax)}</span> {ingredientName(ing.name, s.quantity, s.unit)}
                        {ing.note && <span className="text-ink-3">, {ing.note}</span>}
                      </li>
                    );
                  })}
                </ul>
                <h2 className="mb-2 text-sm font-semibold text-ink-2">Steps</h2>
                <ol className="space-y-1">
                  {steps.map((st, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => {
                          setOverview(false);
                          go(i);
                        }}
                        aria-current={i === at ? "step" : undefined}
                        className={`flex w-full gap-3 rounded-2xl p-3 text-left text-[15px] ${i === at ? "bg-primary-soft text-ink" : "text-ink-2 hover:bg-surface-2"}`}
                      >
                        <span className="font-semibold text-ink">{i + 1}</span>
                        <span className="line-clamp-2">{st}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
            <>
            <p ref={headingRef} tabIndex={-1} className="font-display text-[1.65rem] leading-snug text-ink outline-none lg:text-4xl">
              {current}
            </p>

            {found.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {found.map((f) => {
                  const going = running.some((t) => t.step === at && t.label === f.label);
                  return (
                    <Button key={f.label} variant="secondary" size="lg" disabled={going} onClick={() => startTimer(f.label, f.seconds)}>
                      <Timer size={20} aria-hidden /> {going ? `${f.label} timer running` : `Start ${f.label} timer`}
                    </Button>
                  );
                })}
              </div>
            )}

            {stepIngredients.length > 0 && (
              <section className="mt-6 rounded-2xl bg-surface p-4" aria-label="Ingredients for this step">
                <h2 className="mb-2 text-sm font-semibold text-ink-2">For this step</h2>
                <ul className="space-y-1 text-[17px]">
                  {stepIngredients.map((ing, i) => {
                    const s = displayIngredient(ing, factor, tbspOf(recipe));
                    return (
                      <li key={i}>
                        <span className="font-semibold">{formatAmount(s.quantity, s.unit, s.quantityMax)}</span> {ingredientName(ing.name, s.quantity, s.unit)}
                        {ing.note && <span className="text-ink-3">, {ing.note}</span>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            </>
            )}
          </main>

          {running.length > 0 && (
            <ul className="max-h-[40dvh] space-y-2 overflow-y-auto px-4 pb-2" aria-label="Timers">
              {running.map((t) => (
                <li key={t.id} className="flex items-center gap-2 rounded-2xl border border-line bg-surface py-1 pl-4 pr-1">
                  <Timer size={18} className="shrink-0 text-ink-3" aria-hidden />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-mono text-2xl leading-tight tabular-nums" role="timer" aria-label={`${t.label} timer, step ${t.step + 1}`}>
                      {formatClock(secondsLeft(t, now))}
                    </span>
                    <span className="truncate text-xs text-ink-2" title={stepHint(t.step)}>
                      {t.label}, step {t.step + 1}
                      {t.endsAt !== null ? ` · rings ${endTime(t.endsAt)}` : " · paused"}
                    </span>
                  </span>
                  <IconButton label={t.endsAt === null ? "Resume timer" : "Pause timer"} onClick={() => toggle(t.id, clock())}>
                    {t.endsAt === null ? <Play size={20} /> : <Pause size={20} />}
                  </IconButton>
                  <IconButton label="Add a minute" onClick={() => addMinute(t.id, clock())}>
                    <Plus size={20} />
                  </IconButton>
                  <IconButton label="Cancel timer" onClick={() => remove(t.id)}>
                    <X size={20} />
                  </IconButton>
                </li>
              ))}
            </ul>
          )}

          <footer className="flex gap-2 border-t border-line px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
            <Button variant="secondary" size="lg" onClick={() => go(at - 1)} disabled={at === 0} aria-label="Previous step">
              <ChevronLeft size={22} aria-hidden />
            </Button>
            {at < last ? (
              <Button size="lg" className="flex-1" onClick={() => go(at + 1)}>
                Next step <ChevronRight size={22} aria-hidden />
              </Button>
            ) : (
              <Button
                size="lg"
                className="flex-1"
                onClick={() => {
                  onClose();
                  onFinish();
                }}
              >
                <ChefHat size={20} aria-hidden /> Finish and update larder
              </Button>
            )}
          </footer>
        </>
      )}
    </dialog>
  );
}
