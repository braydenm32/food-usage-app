"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, ChefHat, Check, Leaf, Settings } from "lucide-react";
import { useLarder, DEFAULT_PROFILE } from "@/lib/store";
import { useItemViews, type ItemView } from "@/lib/selectors";
import { describeDaysLeft } from "@/lib/shelf-life/engine";
import { useHydrated } from "@/lib/use-hydrated";
import { Button, Card, EmptyState, PageHeader, SectionTitle, buttonClass, cx } from "@/components/ui";
import { STATUS_META, StatusPill } from "@/components/freshness";
import { ItemSheet } from "@/components/item-sheet";
import { capitalise, markBinned, markUsed } from "@/components/pantry/actions";
import { formatAUD, formatQuantity, startOfMonth, wasteTotals } from "@/components/pantry/format";
import { WasteSplitBar } from "@/components/pantry/waste-bar";

function greeting(hour: number) {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

type SheetState = { id: string; intent?: "still-good" } | null;

export default function TodayPage() {
  const hydrated = useHydrated();
  const router = useRouter();
  const views = useItemViews();
  const onboarded = useLarder((s) => s.settings.onboarded);
  const householdName = useLarder((s) => s.profile.householdName);
  const [sheet, setSheet] = useState<SheetState>(null);
  const closeSheet = useCallback(() => setSheet(null), []);

  const needsWelcome = hydrated && !onboarded && views.length === 0;
  useEffect(() => {
    if (needsWelcome) router.replace("/welcome");
  }, [needsWelcome, router]);

  const now = hydrated ? new Date() : null;
  const name = householdName && householdName !== DEFAULT_PROFILE.householdName ? householdName : null;
  const dateline = now?.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });

  return (
    <>
      <PageHeader
        title={now ? greeting(now.getHours()) : <span className="invisible">Hello</span>}
        subtitle={now ? [name, dateline].filter(Boolean).join(" · ") : <span className="invisible">Today</span>}
        actions={
          <Link
            href="/settings"
            aria-label="Settings"
            title="Settings"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink lg:hidden"
          >
            <Settings size={22} aria-hidden />
          </Link>
        }
      />
      <div className="px-5 lg:px-0">
        {!hydrated || needsWelcome ? (
          <TodaySkeleton />
        ) : views.length === 0 ? (
          <FirstRun />
        ) : (
          <Dashboard views={views} onOpen={(id, intent) => setSheet({ id, intent })} />
        )}
      </div>
      <ItemSheet itemId={sheet?.id ?? null} intent={sheet?.intent} open={!!sheet} onClose={closeSheet} />
    </>
  );
}

function TodaySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your larder" className="flex flex-col gap-4">
      <div className="h-6 w-40 rounded-full bg-surface-2" />
      <div className="flex gap-3 overflow-hidden">
        {[0, 1].map((i) => (
          <div key={i} className="h-64 w-[17.5rem] shrink-0 rounded-[var(--radius-card)] bg-surface-2/70" />
        ))}
      </div>
      <div className="h-24 rounded-[var(--radius-card)] bg-surface-2/70" />
    </div>
  );
}

function FirstRun() {
  const loadDemoData = useLarder((s) => s.loadDemoData);
  return (
    <Card className="mt-2">
      <EmptyState
        emoji="🧺"
        title="Nothing in the larder yet"
        body="Snap your shopping receipt and we'll work out what you bought and when each thing needs eating."
        action={
          <div className="flex flex-col items-center gap-2">
            <Link href="/add" className={buttonClass("primary", "lg")}>
              <Camera size={20} aria-hidden />
              Scan your first shop
            </Link>
            <Button variant="ghost" onClick={loadDemoData}>
              Try with sample food
            </Button>
          </div>
        }
      />
    </Card>
  );
}

function Dashboard({ views, onOpen }: { views: ItemView[]; onOpen: (id: string, intent?: "still-good") => void }) {
  const urgent = views.filter((v) => v.expiry.status === "use-today" || v.expiry.status === "use-soon");
  const expired = views.filter((v) => v.expiry.status === "expired");
  const nextUp = views.find((v) => v.expiry.status === "fresh");

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="eat-first">
        <SectionTitle
          action={
            urgent.length > 0 && <span className="text-sm text-ink-2">{urgent.length === 1 ? "1 item" : `${urgent.length} items`}</span>
          }
        >
          <span id="eat-first">Eat me first</span>
        </SectionTitle>
        {urgent.length > 0 ? (
          <ul className="scrollbar-none -mx-5 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-2 lg:mx-0 lg:grid lg:grid-cols-2 lg:overflow-visible lg:px-0">
            {urgent.map((v) => (
              <EatFirstCard key={v.item.id} view={v} onOpen={onOpen} />
            ))}
          </ul>
        ) : (
          <Card className="flex items-center gap-4 p-4">
            <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-fresh-soft text-fresh">
              <Leaf size={24} />
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-ink">Nothing needs eating today</p>
              {nextUp && (
                <p className="text-sm text-ink-2">
                  Next up: {nextUp.item.name}, {describeDaysLeft(nextUp.expiry, nextUp.item.dateKind)}.
                </p>
              )}
            </div>
          </Card>
        )}
      </section>

      {expired.length > 0 && (
        <section aria-labelledby="check-these">
          <SectionTitle>
            <span id="check-these">Check these</span>
          </SectionTitle>
          <p className="-mt-1 mb-3 text-sm text-ink-2">Past their date. Bin them, or tell us if they&apos;re still fine.</p>
          <Card>
            <ul className="divide-y divide-line">
              {expired.map((v) => (
                <CheckRow key={v.item.id} view={v} onOpen={onOpen} />
              ))}
            </ul>
          </Card>
        </section>
      )}

      <Summary views={views} />
      <MonthInsight />
    </div>
  );
}

function EatFirstCard({ view, onOpen }: { view: ItemView; onOpen: (id: string) => void }) {
  const { item, location, expiry } = view;
  const meta = STATUS_META[expiry.status];
  const days = capitalise(describeDaysLeft(expiry, item.dateKind));
  return (
    <li className="w-[17.5rem] shrink-0 snap-start lg:w-auto">
      <Card className="flex h-full flex-col p-4">
        <button
          type="button"
          onClick={() => onOpen(item.id)}
          className="-m-1 flex flex-1 flex-col items-start rounded-2xl p-1 text-left"
          aria-label={`${item.name}, ${days}. Open details`}
        >
          <span className="flex w-full items-start justify-between gap-2">
            <span
              aria-hidden
              className={cx("flex h-16 w-16 items-center justify-center rounded-2xl text-[2.5rem] leading-none", meta.soft)}
            >
              {item.emoji}
            </span>
            <StatusPill status={expiry.status} />
          </span>
          <span className="mt-4 line-clamp-2 font-display text-xl leading-snug text-ink">{item.name}</span>
          <span className={cx("mt-1 text-[15px] font-semibold", meta.text)}>{days}</span>
          <span className="mt-0.5 text-sm text-ink-2">
            {formatQuantity(item.quantity, item.unit)}
            {location && ` · ${location.name}`}
            {item.openedAt && " · Opened"}
          </span>
        </button>
        <div className="mt-4 flex gap-2">
          <Button size="sm" className="h-11 flex-1 whitespace-nowrap px-3" onClick={() => markUsed(item.id)}>
            <Check size={16} aria-hidden strokeWidth={2.5} />
            Used it
          </Button>
          <Link
            href={`/recipes?use=${encodeURIComponent(item.id)}`}
            className={cx(buttonClass("secondary", "sm"), "h-11 flex-1 whitespace-nowrap px-3")}
          >
            <ChefHat size={16} aria-hidden />
            Cook with it
          </Link>
        </div>
      </Card>
    </li>
  );
}

function CheckRow({ view, onOpen }: { view: ItemView; onOpen: (id: string, intent?: "still-good") => void }) {
  const { item, expiry } = view;
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-spoiled-soft text-2xl">
        {item.emoji}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={() => onOpen(item.id)} className="min-w-0 rounded-lg text-left">
          <span className="block truncate font-semibold text-ink">{item.name}</span>
          <span className="block text-sm text-spoiled">{describeDaysLeft(expiry, item.dateKind)}</span>
        </button>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="secondary" className="h-10" onClick={() => markBinned(item.id)}>
            Binned it
          </Button>
          <Button size="sm" variant="ghost" className="h-10" onClick={() => onOpen(item.id, "still-good")}>
            Still good
          </Button>
        </div>
      </div>
    </li>
  );
}

function Summary({ views }: { views: ItemView[] }) {
  const locations = useLarder((s) => s.locations);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of views) m.set(v.item.locationId, (m.get(v.item.locationId) ?? 0) + 1);
    return m;
  }, [views]);
  const thisWeek = views.filter((v) => v.expiry.daysLeft >= 0 && v.expiry.daysLeft <= 7).length;

  const cells = [
    ...locations.map((l) => ({ key: l.id, href: `/pantry?loc=${l.id}`, n: counts.get(l.id) ?? 0, label: `in the ${l.name.toLowerCase()}`, short: l.name })),
    { key: "week", href: "/pantry", n: thisWeek, label: "to use this week", short: "This week" },
  ];

  return (
    <section aria-labelledby="at-a-glance">
      <SectionTitle>
        <span id="at-a-glance">At a glance</span>
      </SectionTitle>
      <Card className="scrollbar-none flex overflow-x-auto">
        {cells.map((c, i) => (
          <Link
            key={c.key}
            href={c.href}
            className={cx(
              "flex min-w-[5.5rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-card)] px-2 py-4 text-center hover:bg-surface-2/60",
              i > 0 && "border-l border-line rounded-none",
            )}
          >
            <span className={cx("font-display text-2xl tabular-nums", c.key === "week" && c.n > 0 ? "text-soon" : "text-ink")}>
              {c.n}
            </span>
            <span className="text-[13px] text-ink-2">
              <span className="sr-only">{c.n} </span>
              <span aria-hidden>{c.short}</span>
              <span className="sr-only"> {c.label}</span>
            </span>
          </Link>
        ))}
      </Card>
    </section>
  );
}

function MonthInsight() {
  const events = useLarder((s) => s.events);
  const all = useMemo(() => wasteTotals(events), [events]);
  const month = useMemo(() => wasteTotals(events, startOfMonth()), [events]);
  if (all.used + all.binned === 0) return null;

  const total = month.used + month.binned;
  return (
    <section aria-labelledby="this-month">
      <SectionTitle
        action={
          <Link href="/insights" className="rounded-lg text-sm font-semibold text-primary hover:underline">
            See insights
          </Link>
        }
      >
        <span id="this-month">This month</span>
      </SectionTitle>
      <Link href="/insights" className="block rounded-[var(--radius-card)]">
        <Card className="p-4 transition-colors hover:bg-surface-2/40">
          {total === 0 ? (
            <p className="text-[15px] text-ink-2">Nothing used up or binned yet this month.</p>
          ) : (
            <>
              <p className="text-[15px] text-ink">
                <strong className="font-semibold">{month.used} used</strong>, {month.binned} binned
                {month.binnedPriced && month.binnedValue > 0 && (
                  <span className="text-ink-2"> · about {formatAUD(month.binnedValue)} wasted</span>
                )}
              </p>
              <WasteSplitBar used={month.used} binned={month.binned} className="mt-3" />
              <p className="mt-2 text-sm text-ink-2">
                {month.binned === 0
                  ? "Nothing wasted so far. Lovely."
                  : `${Math.round((month.used / total) * 100)}% of what left the larder got eaten.`}
              </p>
            </>
          )}
        </Card>
      </Link>
    </section>
  );
}
