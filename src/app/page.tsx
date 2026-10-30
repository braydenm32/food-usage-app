"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Camera, ChefHat, Check, ClipboardList, Leaf, PencilLine } from "lucide-react";
import { useLarder, DEFAULT_PROFILE } from "@/lib/store";
import { useItemViews, type ItemView } from "@/lib/selectors";
import { describeDaysLeft } from "@/lib/shelf-life/engine";
import { useHydrated } from "@/lib/use-hydrated";
import { Button, Card, EmptyState, PageHeader, SectionTitle, buttonClass, cx } from "@/components/ui";
import { STATUS_META } from "@/components/freshness";
import { ItemSheet, type SheetIntent } from "@/components/item-sheet";
import { InstallCard } from "@/components/install-card";
import { binMany, capitalise, markBinned, markUsed } from "@/components/pantry/actions";
import { formatAUD, formatQuantity, startOfMonth, wasteTotals } from "@/components/pantry/format";
import { ItemRow } from "@/components/pantry/item-row";
import { OverflowMenu } from "@/components/pantry/overflow-menu";
import { WasteSplitBar } from "@/components/pantry/waste-bar";
import { keepFocusNear } from "@/components/pantry/focus";

function greeting(hour: number) {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

/** How many urgent items get a full card on desktop; the rest are compact rows. */
const DESKTOP_CARDS = 4;

type Open = (id: string, intent?: SheetIntent) => void;
type SheetState = { id: string; intent?: SheetIntent } | null;

const headerLink =
  "inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink lg:hidden";

/** Where focus goes when the thing that had it is gone: the "Eat me first" heading. */
const todayHeading = () => document.getElementById("eat-first");

export default function TodayPage() {
  const hydrated = useHydrated();
  const router = useRouter();
  const views = useItemViews();
  const onboarded = useLarder((s) => s.settings.onboarded);
  const planner = useLarder((s) => s.settings.mealPlannerEnabled);
  const householdName = useLarder((s) => s.profile.householdName);
  const [sheet, setSheet] = useState<SheetState>(null);
  const closeSheet = useCallback(() => {
    setSheet(null);
    // If the item was used or binned from the sheet, its card is gone: keep focus on the page.
    setTimeout(() => {
      if (document.activeElement === document.body) todayHeading()?.focus();
    }, 50);
  }, []);
  const open = useCallback<Open>((id, intent) => setSheet({ id, intent }), []);

  const needsWelcome = hydrated && !onboarded && views.length === 0;
  useEffect(() => {
    if (needsWelcome) router.replace("/welcome");
  }, [needsWelcome, router]);

  const now = hydrated ? new Date() : null;
  const name = householdName && householdName !== DEFAULT_PROFILE.householdName ? householdName : null;
  const dateline = now?.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
  const dashboard = hydrated && !needsWelcome && views.length > 0;

  return (
    // data-wide lets the shell give the two-column dashboard more room on desktop.
    <div data-wide={dashboard || undefined}>
      <PageHeader
        title={now ? greeting(now.getHours()) : <span className="invisible">Hello</span>}
        subtitle={now ? [name, dateline].filter(Boolean).join(" · ") : <span className="invisible">Today</span>}
        showSettings
        actions={
          // Insights is linked from "This month" below (and the Larder header); the rail has both on desktop.
          hydrated && planner ? (
            <Link href="/plan" aria-label="Meal plan" title="Meal plan" className={headerLink}>
              <CalendarDays size={22} aria-hidden />
            </Link>
          ) : undefined
        }
      />
      <div className="px-5 lg:px-0">
        {!hydrated || needsWelcome ? (
          <TodaySkeleton />
        ) : views.length === 0 ? (
          <FirstRun />
        ) : (
          <Dashboard views={views} onOpen={open} />
        )}
      </div>
      <ItemSheet itemId={sheet?.id ?? null} intent={sheet?.intent} open={!!sheet} onClose={closeSheet} />
    </div>
  );
}

function TodaySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your larder" className="flex flex-col gap-4">
      <div className="h-6 w-40 rounded-full bg-surface-2" />
      <div className="flex gap-3 overflow-hidden">
        {[0, 1].map((i) => (
          <div key={i} className="h-52 w-[78%] max-w-80 shrink-0 rounded-[var(--radius-card)] bg-surface-2/70" />
        ))}
      </div>
      <div className="h-24 rounded-[var(--radius-card)] bg-surface-2/70" />
    </div>
  );
}

/** Whether photo reading is set up, so first-run can lead with what will actually work. */
function useScanConfigured(): boolean | null {
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/scan", { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { configured?: boolean } | null) => {
        if (d && typeof d.configured === "boolean") setConfigured(d.configured);
      })
      .catch(() => {
        /* offline or aborted: keep the default */
      });
    return () => ac.abort();
  }, []);
  return configured;
}

function FirstRun() {
  const loadDemoData = useLarder((s) => s.loadDemoData);
  const configured = useScanConfigured();
  const scanFirst = configured !== false;
  return (
    <Card className="mt-2">
      <EmptyState
        emoji="🧺"
        title="Nothing in the larder yet"
        body={
          scanFirst
            ? "Snap your shopping receipt and we'll work out what you bought and when each thing needs eating."
            : "Paste your shopping list or an online order, and we'll work out when each thing needs eating."
        }
        action={
          <div className="flex flex-col items-center gap-2">
            {scanFirst ? (
              <>
                <Link href="/add?method=receipt" className={buttonClass("primary", "lg")}>
                  <Camera size={20} aria-hidden />
                  Scan your first shop
                </Link>
                <Link href="/add?method=paste" className={buttonClass("secondary", "md")}>
                  <ClipboardList size={18} aria-hidden />
                  Paste a list
                </Link>
              </>
            ) : (
              <>
                <Link href="/add?method=paste" className={buttonClass("primary", "lg")}>
                  <ClipboardList size={20} aria-hidden />
                  Paste a list
                </Link>
                <Link href="/add?method=receipt" className={buttonClass("secondary", "md")}>
                  <Camera size={18} aria-hidden />
                  Scan a receipt
                </Link>
              </>
            )}
            <Button variant="ghost" onClick={loadDemoData}>
              Try with sample food
            </Button>
          </div>
        }
      />
    </Card>
  );
}

function Dashboard({ views, onOpen }: { views: ItemView[]; onOpen: Open }) {
  const urgent = views.filter((v) => v.expiry.status === "use-today" || v.expiry.status === "use-soon");
  const expired = views.filter((v) => v.expiry.status === "expired");
  const nextUp = views.find((v) => v.expiry.status === "fresh");
  const rest = urgent.slice(DESKTOP_CARDS);

  return (
    <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-10">
      <section aria-labelledby="eat-first" className="min-w-0">
        <SectionTitle
          action={
            urgent.length > 0 && <span className="text-sm text-ink-2">{urgent.length === 1 ? "1 item" : `${urgent.length} items`}</span>
          }
        >
          <span id="eat-first" tabIndex={-1} className="rounded-lg">
            Eat me first
          </span>
        </SectionTitle>
        {urgent.length > 0 ? (
          <>
            <ul className="scrollbar-none -mx-5 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-2 lg:mx-0 lg:grid lg:grid-cols-2 lg:overflow-visible lg:px-0 lg:pb-0">
              {urgent.map((v) => (
                <EatFirstCard key={v.item.id} view={v} onOpen={onOpen} />
              ))}
            </ul>
            {rest.length > 0 && (
              <div className="mt-6 hidden lg:block">
                <h3 className="mb-1 text-sm font-semibold text-ink-2">Also coming up</h3>
                <ul className="-mx-2 flex flex-col">
                  {rest.map((v) => (
                    <ItemRow key={v.item.id} view={v} onOpen={onOpen} focusFallback={todayHeading} />
                  ))}
                </ul>
              </div>
            )}
          </>
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

      <div className="flex flex-col gap-8">
        {expired.length > 0 && <CheckThese views={expired} onOpen={onOpen} />}
        <Summary views={views} />
        <MonthInsight />
        <InstallCard />
      </div>
    </div>
  );
}

function EatFirstCard({ view, onOpen }: { view: ItemView; onOpen: Open }) {
  const { item, location, expiry } = view;
  const meta = STATUS_META[expiry.status];
  const days = capitalise(describeDaysLeft(expiry, item.dateKind));
  const details = [formatQuantity(item.quantity, item.unit), location?.name, item.openedAt && "Opened"].filter(Boolean).join(" · ");
  return (
    // On desktop only the first few are cards; the rest show as rows below.
    <li className={cx("w-[78%] max-w-80 shrink-0 snap-start lg:w-auto lg:max-w-none", "lg:[&:nth-child(n+5)]:hidden")}>
      <Card className="flex h-full flex-col p-4">
        <button
          type="button"
          data-row-focus={item.id}
          onClick={() => onOpen(item.id)}
          className="-m-1 flex flex-1 flex-col items-start rounded-2xl p-1 text-left"
          aria-label={`${item.name}, ${days}, ${details}. Open details`}
        >
          <span className="flex w-full items-center gap-3">
            <span
              aria-hidden
              className={cx("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-[1.75rem] leading-none", meta.soft)}
            >
              {item.emoji}
            </span>
            <span className="line-clamp-2 min-w-0 font-display text-xl leading-snug text-ink">{item.name}</span>
          </span>
          <span className={cx("mt-3 inline-flex items-center gap-1.5 text-[15px] font-semibold", meta.text)}>
            <meta.Icon size={16} aria-hidden strokeWidth={2.5} />
            {days}
          </span>
          <span className="mt-0.5 text-sm text-ink-2">{details}</span>
        </button>
        <div className="mt-4 flex gap-2">
          <Button
            size="sm"
            className="h-11 flex-1 whitespace-nowrap px-3"
            onClick={(e) => {
              keepFocusNear(e.currentTarget, todayHeading);
              markUsed(item.id);
            }}
          >
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

function CheckThese({ views, onOpen }: { views: ItemView[]; onOpen: Open }) {
  const anyBestBefore = views.some((v) => v.item.dateKind === "best-before");
  return (
    <section aria-labelledby="check-these">
      <SectionTitle
        action={
          views.length > 1 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                binMany(views.map((v) => v.item.id));
                setTimeout(() => todayHeading()?.focus(), 50);
              }}
            >
              Bin all {views.length}
            </Button>
          )
        }
      >
        <span id="check-these">Check these</span>
      </SectionTitle>
      <p className="-mt-1 mb-3 text-sm text-ink-2">
        {anyBestBefore
          ? "Past their date. Bin them, or tell us if they're still fine."
          : "Past their use-by date, so they're best binned."}
      </p>
      <Card className="@container">
        <ul className="divide-y divide-line">
          {views.map((v) => (
            <CheckRow key={v.item.id} view={v} onOpen={onOpen} />
          ))}
        </ul>
      </Card>
    </section>
  );
}

function CheckRow({ view, onOpen }: { view: ItemView; onOpen: Open }) {
  const { item, expiry } = view;
  const bestBefore = item.dateKind === "best-before";
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-spoiled-soft text-2xl">
        {item.emoji}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 @md:flex-row @md:items-center @md:justify-between">
        <button
          type="button"
          data-row-focus={item.id}
          onClick={() => onOpen(item.id)}
          className="min-w-0 rounded-lg text-left"
        >
          <span className="block truncate font-semibold text-ink">{item.name}</span>
          <span className="block text-sm text-spoiled">{capitalise(describeDaysLeft(expiry, item.dateKind))}</span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="h-10"
            onClick={(e) => {
              keepFocusNear(e.currentTarget, todayHeading);
              markBinned(item.id);
            }}
          >
            Binned it
          </Button>
          {bestBefore ? (
            <Button size="sm" variant="ghost" className="h-10" onClick={() => onOpen(item.id, "still-good")}>
              Still good
            </Button>
          ) : (
            <OverflowMenu
              label={`More for ${item.name}`}
              actions={[{ label: "Edit date", Icon: PencilLine, onSelect: () => onOpen(item.id, "edit-date") }]}
            />
          )}
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
      <Card className="overflow-hidden">
        <ul className="scrollbar-none grid auto-cols-[minmax(5.5rem,1fr)] grid-flow-col gap-px overflow-x-auto bg-line lg:grid-flow-row lg:grid-cols-2 lg:overflow-visible">
          {cells.map((c) => (
            <li key={c.key} className="bg-surface lg:[&:last-child:nth-child(odd)]:col-span-2">
              <Link
                href={c.href}
                className="flex h-full flex-col items-center justify-center gap-0.5 px-2 py-4 text-center hover:bg-surface-2/60 focus-visible:outline-offset-[-3px]"
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
            </li>
          ))}
        </ul>
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
      <Card className="p-4">
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
    </section>
  );
}
