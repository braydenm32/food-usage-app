"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ChartColumn, ChevronRight, Salad } from "lucide-react";
import { useLarder } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";
import { useNow } from "@/lib/use-now";
import { useMealLog } from "@/lib/nutrition/meal-log";
import { dailyAverage } from "@/lib/nutrition/meal-log";
import { formatNutrient, kcal } from "@/lib/nutrition/nutrients";
import { toLocalISODate } from "@/lib/shelf-life/engine";
import { Card, PageHeader } from "@/components/ui";
import { WasteSplitBar } from "@/components/pantry/waste-bar";
import { formatAUD, startOfMonth, wasteTotals } from "@/components/pantry/format";

/** "Your kitchen": what gets eaten or binned (Insights) and what you've had (Nutrition), in one place. */
export default function KitchenPage() {
  const hydrated = useHydrated();
  const now = useNow();
  const events = useLarder((s) => s.events);
  const meals = useMealLog((s) => s.meals);
  const month = useMemo(() => (hydrated ? wasteTotals(events, startOfMonth(new Date(now))) : null), [events, hydrated, now]);
  const week = useMemo(() => {
    if (!hydrated) return null;
    const to = toLocalISODate(new Date(now));
    const d = new Date(now);
    d.setDate(d.getDate() - 6);
    return dailyAverage(meals, toLocalISODate(d), to);
  }, [meals, hydrated, now]);

  return (
    <>
      <PageHeader title="Your kitchen" subtitle="What gets eaten, what gets binned, and what you've had" showSettings />
      <div className="flex flex-col gap-4 px-5 pb-10 lg:grid lg:grid-cols-2 lg:px-0">
        {!hydrated || !month || !week ? (
          <>
            <div aria-busy="true" aria-label="Loading" className="h-44 rounded-[var(--radius-card)] bg-surface-2/70" />
            <div className="h-44 rounded-[var(--radius-card)] bg-surface-2/70" />
          </>
        ) : (
          <>
            <Section
              href="/insights"
              Icon={ChartColumn}
              title="Insights"
              linkLabel="See insights"
              summary={
                month.used + month.binned === 0
                  ? "Nothing used up or binned yet this month."
                  : `This month: ${month.used} used up, ${month.binned} binned${month.binnedPriced && month.binnedValue > 0 ? `, about ${formatAUD(month.binnedValue)} wasted` : ""}.`
              }
            >
              {month.used + month.binned > 0 && (
                <>
                  <WasteSplitBar used={month.used} binned={month.binned} className="mt-3" />
                  <p className="mt-2 text-sm text-ink-2">
                    {month.binned === 0
                      ? "Nothing wasted so far. Lovely."
                      : `${Math.round((month.used / (month.used + month.binned)) * 100)}% of items eaten, not binned.`}
                  </p>
                </>
              )}
            </Section>
            <Section
              href="/nutrition"
              Icon={Salad}
              title="Nutrition"
              linkLabel="See nutrition"
              summary={
                week.days === 0
                  ? "Log a food or cook a recipe to see calories, protein, fibre and vitamins."
                  : `Last 7 days: about ${kcal(week.avg.energyKj) ?? 0} Cal and ${formatNutrient(week.avg.protein, "g")} protein a day, on the ${week.days} day${week.days === 1 ? "" : "s"} you logged.`
              }
            />
          </>
        )}
      </div>
    </>
  );
}

function Section({
  href,
  Icon,
  title,
  linkLabel,
  summary,
  children,
}: {
  href: string;
  Icon: typeof Salad;
  title: string;
  linkLabel: string;
  summary: string;
  children?: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`k-${title}`}>
      <Card className="flex h-full flex-col p-4">
        <div className="flex items-center gap-3">
          <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <Icon size={22} />
          </span>
          <h2 id={`k-${title}`} className="font-display text-xl text-ink">
            {title}
          </h2>
        </div>
        <p className="mt-3 text-[15px] text-ink">{summary}</p>
        {children}
        <Link href={href} className="-mx-2 mt-auto inline-flex min-h-11 items-center gap-0.5 self-start rounded-full px-2 pt-2 text-sm font-semibold text-primary hover:underline">
          {linkLabel}
          <ChevronRight size={16} aria-hidden />
        </Link>
      </Card>
    </section>
  );
}
