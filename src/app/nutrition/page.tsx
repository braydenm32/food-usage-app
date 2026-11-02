"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Copy, Download, Pin, PinOff, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { Button, Card, EmptyState, Field, IconButton, Input, PageHeader, SectionTitle, Segmented, Sheet, buttonClass, cx } from "@/components/ui";
import { toast } from "@/components/toast";
import { LogFoodSheet } from "./log-food-sheet";
import { hasFoodData } from "@/lib/nutrition/engine";
import {
  contributorsFor,
  dailyAverage,
  mealTotal,
  mealsCsv,
  quickAddText,
  targetState,
  useMealLog,
  type MealEntry,
  type Target,
} from "@/lib/nutrition/meal-log";
import { NUTRIENT, NUTRIENTS, formatNutrient, kcal, type NutrientKey } from "@/lib/nutrition/nutrients";
import { toLocalISODate } from "@/lib/shelf-life/engine";
import { useHydrated } from "@/lib/use-hydrated";
import { useNow } from "@/lib/use-now";

type Range = "today" | "7" | "30" | "90";
const RANGES: { value: Range; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7", label: "Week" },
  { value: "30", label: "Month" },
  { value: "90", label: "Quarter" },
];

/** Local date n calendar days back (safe across daylight-saving changes). */
const daysAgo = (now: number, n: number) => {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return toLocalISODate(d);
};

export default function NutritionPage() {
  const hydrated = useHydrated();
  const now = useNow();
  const meals = useMealLog((s) => s.meals);
  const targets = useMealLog((s) => s.targets);
  const pinned = useMealLog((s) => s.pinned);
  const setPinned = useMealLog((s) => s.setPinned);
  const removeMeal = useMealLog((s) => s.removeMeal);
  const restoreMeal = useMealLog((s) => s.restoreMeal);
  const [range, setRange] = useState<Range>("today");
  const [focus, setFocus] = useState<NutrientKey>("protein");
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [showMicros, setShowMicros] = useState(false);
  const [logTab, setLogTab] = useState<"food" | "leftovers" | null>(null);
  const sourcesRef = useRef<HTMLDivElement>(null);

  const today = toLocalISODate(new Date(now));
  const from = range === "today" ? today : daysAgo(now, Number(range) - 1);
  const inRange = useMemo(() => meals.filter((m) => m.date >= from && m.date <= today), [meals, from, today]);
  const { avg, days } = useMemo(() => dailyAverage(meals, from, today), [meals, from, today]);
  const contributors = useMemo(() => contributorsFor(inRange, focus), [inRange, focus]);

  const back = { href: "/kitchen", label: "Your kitchen" };
  const openLog = (tab: "food" | "leftovers" = "food") => setLogTab(tab);

  if (!hydrated) return <PageHeader title="Nutrition" subtitle={<span className="invisible">Loading</span>} back={back} />;

  const perDay = range !== "today";
  const label = perDay ? `Average per day, on the ${days} of ${range} days you logged meals` : "Today so far";

  async function copyText(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`Copied ${what} for Quick Add`);
    } catch {
      toast("Couldn't copy. Try again.", { tone: "error" });
    }
  }

  function exportCsv() {
    const blob = new Blob([mealsCsv(meals)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `larder-meals-${today}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function deleteMeal(m: MealEntry) {
    removeMeal(m.id);
    toast(`Removed ${m.title}`, { action: { label: "Undo", onClick: () => restoreMeal(m) } });
  }

  function togglePin(k: NutrientKey) {
    if (pinned.includes(k)) return setPinned(pinned.filter((x) => x !== k));
    if (pinned.filter((x) => x !== "energyKj").length >= 8) return toast("You can pin up to 8. Unpin one first.");
    setPinned([...pinned, k]);
  }

  function showSources(k: NutrientKey) {
    setFocus(k);
    sourcesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <PageHeader
        title="Nutrition"
        subtitle="From the meals you cook and the food you log"
        back={back}
        actions={
          <IconButton label="Set targets" onClick={() => setTargetsOpen(true)}>
            <SlidersHorizontal size={22} />
          </IconButton>
        }
      />
      <div className="px-5 pb-10 lg:px-0">
        {!hasFoodData() ? (
          <EmptyState emoji="🥦" title="Nutrition is almost ready" body="The Australian food database isn't in this version yet. Once it is, meals you cook will show up here." />
        ) : meals.length === 0 ? (
          <EmptyState
            emoji="🍽️"
            title="Nothing logged yet"
            body="Log a food by weight, or cook a recipe and tap “I cooked this”. It adds up here, with protein, fibre, vitamins and more."
            action={
              <div className="flex flex-col items-center gap-2">
                <Button onClick={() => openLog("food")}>
                  <Plus size={18} aria-hidden />
                  Log a food
                </Button>
                <Link href="/recipes" className={buttonClass("secondary")}>
                  Find a recipe
                </Link>
              </div>
            }
          />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <Button size="sm" className="h-11" onClick={() => openLog("food")}>
                <Plus size={16} aria-hidden />
                Log a food
              </Button>
              <Button size="sm" variant="secondary" className="h-11" onClick={() => openLog("leftovers")}>
                Ate leftovers
              </Button>
            </div>
            <Segmented label="Time range" value={range} onChange={setRange} options={RANGES} className="max-w-md" />

            <Card className="mt-4 p-4">
              <p className="text-sm text-ink-2">{label}</p>
              <div className="flex flex-wrap items-baseline gap-x-3">
                <p className="font-display text-4xl text-ink">{kcal(avg.energyKj) ?? 0} Cal</p>
                <p className="text-sm text-ink-2">{formatNutrient(avg.energyKj, "kJ")}</p>
              </div>
              <TargetBar
                value={kcal(avg.energyKj)}
                target={targets.energyKj && { min: kcal(targets.energyKj.min), goal: kcal(targets.energyKj.goal), max: kcal(targets.energyKj.max) }}
                unit="Cal"
              />
              {days === 0 && (
                <p className="mt-2 text-sm text-ink-3">
                  {range === "today" ? "Nothing logged today yet. Log a food, or tap “I cooked this” on a recipe." : "Nothing logged in this range."}
                </p>
              )}
            </Card>

            <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Pinned nutrients">
              {pinned
                .filter((k) => k !== "energyKj")
                .map((k) => (
                  <li key={k}>
                    <button
                      type="button"
                      onClick={() => setFocus(k)}
                      aria-pressed={focus === k}
                      className={cx("w-full rounded-2xl border p-3 text-left transition-colors", focus === k ? "border-primary bg-primary-soft" : "border-line bg-surface hover:bg-surface-2")}
                    >
                      <span className="block text-xs text-ink-2">{NUTRIENT[k].label}</span>
                      <span className="block font-semibold tabular-nums text-ink">{formatNutrient(avg[k], NUTRIENT[k].unit)}</span>
                      <TargetBar value={avg[k]} target={targets[k]} unit={NUTRIENT[k].unit} compact />
                    </button>
                  </li>
                ))}
            </ul>

            <div ref={sourcesRef} className="mt-8 scroll-mt-4">
              <SectionTitle>Where your {NUTRIENT[focus].label.toLowerCase()} came from</SectionTitle>
            </div>
            {contributors.length === 0 ? (
              <p className="text-sm text-ink-3">No {NUTRIENT[focus].label.toLowerCase()} logged in this range.</p>
            ) : (
              <Card>
                <ul className="divide-y divide-line">
                  {contributors.map((c) => (
                    <li key={c.name} className="flex items-center gap-3 px-4 py-2.5 text-[15px]">
                      <span className="min-w-0 flex-1 truncate capitalize text-ink">{c.name}</span>
                      <span className="h-2 w-20 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                        <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(c.share * 100)}%` }} />
                      </span>
                      <span className="w-20 text-right tabular-nums text-ink-2">{formatNutrient(c.amount / Math.max(1, perDay ? days : 1), NUTRIENT[focus].unit)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <SectionTitle
              action={
                <button type="button" aria-expanded={showMicros} onClick={() => setShowMicros((v) => !v)} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline">
                  {showMicros ? "Hide vitamins and minerals" : "Show vitamins and minerals"}
                </button>
              }
            >
              All nutrients
            </SectionTitle>
            <p className="-mt-1 mb-2 text-xs text-ink-3">Tap a name to see where it came from. Pin up to 8 to the top.</p>
            <Card>
              <ul className="divide-y divide-line">
                {NUTRIENTS.filter((x) => showMicros || x.group !== "micro" || x.key === "sodium").map((x) => {
                  const st = targetState(avg[x.key], targets[x.key]);
                  return (
                    <li key={x.key} className="flex items-center gap-2 py-1 pl-4 pr-1 text-[15px]">
                      <button type="button" onClick={() => showSources(x.key)} className="min-h-11 min-w-0 flex-1 truncate text-left text-ink">
                        {x.label}
                      </button>
                      <span className={cx("tabular-nums", st === "under" ? "text-soon" : st === "over" ? "text-spoiled" : "text-ink-2")}>
                        {x.key === "energyKj" ? `${kcal(avg.energyKj) ?? 0} Cal` : formatNutrient(avg[x.key], x.unit)}
                        {st === "under" && <span className="sr-only"> (under your minimum)</span>}
                        {st === "over" && <span className="sr-only"> (over your maximum)</span>}
                      </span>
                      {x.key === "energyKj" ? (
                        <span className="w-11" aria-hidden />
                      ) : (
                        <IconButton label={pinned.includes(x.key) ? `Unpin ${x.label}` : `Pin ${x.label}`} onClick={() => togglePin(x.key)} aria-pressed={pinned.includes(x.key)}>
                          {pinned.includes(x.key) ? <PinOff size={18} className="text-primary" /> : <Pin size={18} />}
                        </IconButton>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>

            <SectionTitle
              action={
                range === "today" && inRange.length > 0 ? (
                  <button type="button" onClick={() => copyText(quickAddText(`Larder, ${today}`, avg), "today's total")} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
                    <Copy size={16} aria-hidden /> Copy day for MacroFactor / MFP
                  </button>
                ) : undefined
              }
            >
              Meals
            </SectionTitle>
            {inRange.length === 0 ? (
              <p className="text-sm text-ink-3">No meals in this range.</p>
            ) : (
              <Card>
                <ul className="divide-y divide-line">
                  {inRange.map((m) => {
                    const t = mealTotal(m);
                    return (
                      <li key={m.id} className="flex items-center gap-2 py-1 pl-4 pr-1">
                        <span className="min-w-0 flex-1">
                          {m.recipeId ? (
                            <Link href={`/recipes/${encodeURIComponent(m.recipeId)}`} className="block truncate text-[15px] text-ink hover:underline">
                              {m.title}
                            </Link>
                          ) : (
                            <span className="block truncate text-[15px] text-ink">{m.title}</span>
                          )}
                          <span className="block text-xs text-ink-3">
                            {new Date(m.at).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })} · {m.servings} serving{m.servings === 1 ? "" : "s"} · {kcal(t.energyKj) ?? 0} Cal · {formatNutrient(t.protein, "g")} protein
                          </span>
                        </span>
                        <IconButton label={`Copy ${m.title} for MacroFactor or MyFitnessPal`} onClick={() => copyText(quickAddText(`${m.title} (${m.servings} serving${m.servings === 1 ? "" : "s"})`, t), m.title)}>
                          <Copy size={18} />
                        </IconButton>
                        <IconButton label={`Remove ${m.title}`} onClick={() => deleteMeal(m)}>
                          <Trash2 size={18} />
                        </IconButton>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Button variant="secondary" onClick={exportCsv}>
                <Download size={18} aria-hidden /> Export all meals (CSV)
              </Button>
            </div>
            <p className="mt-3 text-xs text-ink-3">
              MacroFactor and MyFitnessPal don&apos;t let other apps send meals in directly, so copy a meal or a day and add it with Quick Add.
              Your meal log stays on this device and goes into your Larder backups. Figures are estimates from the Australian Food Composition Database (FSANZ).
            </p>
          </>
        )}
      </div>
      <TargetsSheet open={targetsOpen} onClose={() => setTargetsOpen(false)} />
      <LogFoodSheet open={logTab !== null} initialTab={logTab ?? "food"} onClose={() => setLogTab(null)} today={today} />
    </>
  );
}

/** A bar showing a value against a min / goal / max target. Nothing when there's no target. */
function TargetBar({ value, target, unit, compact }: { value: number | undefined; target: Target | undefined; unit: string; compact?: boolean }) {
  if (!target) return null;
  const top = Math.max(target.max ?? 0, target.goal ?? 0, target.min ?? 0, value ?? 0) * 1.15 || 1;
  const pct = (v: number) => `${Math.min(100, (v / top) * 100)}%`;
  const st = targetState(value, target);
  const text = [target.min !== undefined && `min ${formatNutrient(target.min, unit)}`, target.goal !== undefined && `goal ${formatNutrient(target.goal, unit)}`, target.max !== undefined && `max ${formatNutrient(target.max, unit)}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className={compact ? "mt-1.5" : "mt-3"}>
      <div className="relative h-2 rounded-full bg-surface-2" role="img" aria-label={`${formatNutrient(value ?? 0, unit)}; ${text}`}>
        <div className={cx("absolute inset-y-0 left-0 rounded-full", st === "over" ? "bg-spoiled" : st === "under" ? "bg-soon" : "bg-fresh")} style={{ width: pct(value ?? 0) }} />
        {target.min !== undefined && <span className="absolute -top-0.5 h-3 w-0.5 bg-ink-3" style={{ left: pct(target.min) }} aria-hidden />}
        {target.goal !== undefined && <span className="absolute -top-1 h-4 w-0.5 bg-ink" style={{ left: pct(target.goal) }} aria-hidden />}
        {target.max !== undefined && <span className="absolute -top-0.5 h-3 w-0.5 bg-spoiled" style={{ left: pct(target.max) }} aria-hidden />}
      </div>
      {!compact && <p className="mt-1 text-xs text-ink-3">{text}</p>}
    </div>
  );
}

function TargetsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const targets = useMealLog((s) => s.targets);
  const setTarget = useMealLog((s) => s.setTarget);
  const num = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? undefined : Math.max(0, Number(v)));
  return (
    <Sheet open={open} onClose={onClose} title="Daily targets" wide footer={<Button block size="lg" onClick={onClose}>Done</Button>}>
      <p className="pb-3 text-sm text-ink-2">
        All optional, per day, and saved as you type. Use the numbers your dietitian, doctor or app gives you.
      </p>
      <ul className="divide-y divide-line">
        {NUTRIENTS.map((x) => {
          // Energy targets are entered in Calories, like the rest of the screen, and stored in kJ.
          const isEnergy = x.key === "energyKj";
          const stored = targets[x.key] ?? {};
          const t: Target = isEnergy
            ? { min: kcal(stored.min), goal: kcal(stored.goal), max: kcal(stored.max) }
            : stored;
          const toStored = (v: number | undefined) => (v === undefined || !isEnergy ? v : Math.round(v * 4.184));
          const set = (patch: Partial<Target>) => {
            const next = { ...stored };
            for (const [k, v] of Object.entries(patch) as [keyof Target, number | undefined][]) next[k] = toStored(v);
            setTarget(x.key, next);
          };
          return (
            <li key={x.key} className="py-3">
              <p className="mb-1.5 font-medium text-ink">
                {x.label} <span className="text-sm font-normal text-ink-3">({isEnergy ? "Calories" : x.unit})</span>
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(["min", "goal", "max"] as const).map((k) => (
                  <Field key={k} label={k === "min" ? "Min" : k === "goal" ? "Goal" : "Max"}>
                    {(id) => <Input id={id} inputMode="decimal" defaultValue={t[k] ?? ""} onChange={(e) => set({ [k]: num(e.target.value) })} />}
                  </Field>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
