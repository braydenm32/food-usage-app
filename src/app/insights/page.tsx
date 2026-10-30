"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowLeft, Lightbulb } from "lucide-react";
import { useLarder } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";
import { getFoodType } from "@/lib/shelf-life/foods";
import type { ItemEvent } from "@/lib/types";
import { Card, EmptyState, PageHeader, SectionTitle, buttonClass } from "@/components/ui";
import { WasteSplitBar } from "@/components/pantry/waste-bar";
import { formatAUD, startOfMonth, wasteTotals, type WasteTotals } from "@/components/pantry/format";

interface BinnedFood {
  key: string;
  name: string;
  emoji: string;
  count: number;
  value: number;
  tip?: string;
}

function mostBinned(events: ItemEvent[]): BinnedFood[] {
  const m = new Map<string, BinnedFood>();
  for (const e of events) {
    if (e.type !== "binned") continue;
    const food = getFoodType(e.foodTypeId);
    const key = e.foodTypeId ?? e.itemName.toLowerCase();
    const row = m.get(key) ?? { key, name: food?.name ?? e.itemName, emoji: food?.emoji ?? "🍽️", count: 0, value: 0, tip: food?.tip };
    row.count++;
    row.value += e.value ?? 0;
    m.set(key, row);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || b.value - a.value).slice(0, 5);
}

const GENERAL_TIPS = [
  "Before a shop, take a quick look at Today. Anything in “Eat me first” can become tonight's dinner.",
  "Freezing buys time. Bread, mince and ripe bananas all freeze well when you can't get to them.",
  "Best-before dates are about quality, not safety. Look, sniff and taste before you bin.",
];

export default function InsightsPage() {
  const hydrated = useHydrated();
  const events = useLarder((s) => s.events);
  // Dates only after hydration: the server render must not depend on the clock.
  const month = useMemo(() => (hydrated ? wasteTotals(events, startOfMonth()) : null), [events, hydrated]);
  const all = useMemo(() => wasteTotals(events), [events]);
  const binned = useMemo(() => mostBinned(events), [events]);
  const monthName = hydrated ? new Date().toLocaleDateString("en-AU", { month: "long" }) : "This month";

  const back = (
    <Link
      href="/"
      aria-label="Back to Today"
      title="Back to Today"
      className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2 hover:text-ink lg:hidden"
    >
      <ArrowLeft size={22} aria-hidden />
    </Link>
  );

  if (!hydrated || !month) {
    return (
      <>
        <PageHeader title="Insights" subtitle={<span className="invisible">Loading</span>} actions={back} />
        <div aria-busy="true" aria-label="Loading insights" className="flex flex-col gap-4 px-5 lg:px-0">
          <div className="h-40 rounded-[var(--radius-card)] bg-surface-2/70" />
          <div className="h-40 rounded-[var(--radius-card)] bg-surface-2/70" />
        </div>
      </>
    );
  }

  const empty = all.used + all.binned === 0;
  const tip = pickTip(all, binned);

  return (
    <>
      <PageHeader title="Insights" subtitle="What got eaten, and what got binned" actions={back} showSettings />
      <div className="px-5 lg:px-0">
        {empty ? (
          <Card>
            <EmptyState
              emoji="🌱"
              title="Nothing to show yet"
              body="When you mark food as used or binned, you'll see how much gets eaten and what tends to go to waste."
              action={
                <Link href="/pantry" className={buttonClass("secondary")}>
                  Go to the larder
                </Link>
              }
            />
          </Card>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <PeriodCard title={monthName} t={month} emptyText="Nothing used up or binned yet this month." />
              <PeriodCard title="All time" t={all} />
            </div>

            {binned.length > 0 ? (
              <section aria-labelledby="most-binned" className="mt-8">
                <SectionTitle>
                  <span id="most-binned">Binned most often</span>
                </SectionTitle>
                <Card>
                  <ul className="divide-y divide-line">
                    {binned.map((b) => (
                      <li key={b.key} className="flex items-center gap-3 px-4 py-3">
                        <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-2xl">
                          {b.emoji}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="truncate font-semibold text-ink">{b.name}</span>
                            <span className="shrink-0 text-sm tabular-nums text-ink-2">
                              {b.count} {b.count === 1 ? "time" : "times"}
                              {b.value > 0 && ` · ${formatAUD(b.value)}`}
                            </span>
                          </div>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                            <div
                              className="h-full rounded-full bg-spoiled/80"
                              style={{ width: `${Math.max(6, (b.count / binned[0].count) * 100)}%` }}
                            />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              </section>
            ) : (
              <Card className="mt-8 p-4">
                <p className="font-semibold text-ink">Nothing binned so far</p>
                <p className="mt-1 text-sm text-ink-2">Everything you&apos;ve finished has been eaten. Keep it up.</p>
              </Card>
            )}

            <section aria-labelledby="tip" className="mt-8">
              <h2 id="tip" className="sr-only">
                A tip
              </h2>
              <div className="flex gap-3 rounded-[var(--radius-card)] bg-primary-soft p-4">
                <Lightbulb size={20} aria-hidden className="mt-0.5 shrink-0 text-primary" />
                <p className="text-[15px] text-ink">{tip}</p>
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}

function pickTip(all: WasteTotals, binned: BinnedFood[]): string {
  const top = binned[0];
  if (top?.tip) return `${top.name} is what you bin most. ${top.tip}`;
  if (top) return `${top.name} is what you bin most. Next shop, try buying a little less, or freeze some on the day.`;
  const i = (all.used + all.binned) % GENERAL_TIPS.length;
  return GENERAL_TIPS[i];
}

function PeriodCard({ title, t, emptyText }: { title: string; t: WasteTotals; emptyText?: string }) {
  const total = t.used + t.binned;
  return (
    <Card className="p-4">
      <h2 className="font-display text-xl text-ink">{title}</h2>
      {total === 0 ? (
        <p className="mt-2 text-[15px] text-ink-2">{emptyText}</p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <dt className="flex items-center gap-1.5 text-sm text-ink-2">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-fresh" />
                Used
              </dt>
              <dd className="font-display text-3xl tabular-nums text-ink">{t.used}</dd>
              {t.usedPriced && <dd className="text-sm text-ink-2">{formatAUD(t.usedValue)} of food</dd>}
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-sm text-ink-2">
                <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-spoiled" />
                Binned
              </dt>
              <dd className="font-display text-3xl tabular-nums text-ink">{t.binned}</dd>
              {t.binnedPriced && <dd className="text-sm text-ink-2">{formatAUD(t.binnedValue)} wasted</dd>}
            </div>
          </dl>
          <WasteSplitBar used={t.used} binned={t.binned} className="mt-4" />
          <p className="mt-2 text-sm text-ink-2">{Math.round((t.used / total) * 100)}% eaten</p>
        </>
      )}
    </Card>
  );
}
