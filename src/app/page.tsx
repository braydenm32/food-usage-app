"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarCheck, CalendarDays, Camera, ChefHat, ChevronRight, ClipboardList, Leaf, PencilLine, Snowflake } from "lucide-react";
import { useLarder, DEFAULT_PROFILE } from "@/lib/store";
import { useItemViews, type ItemView } from "@/lib/selectors";
import { describeDaysLeft } from "@/lib/shelf-life/engine";
import { useHydrated } from "@/lib/use-hydrated";
import { useNow } from "@/lib/use-now";
import { Button, Card, EmptyState, PageHeader, SectionTitle, buttonClass, cx } from "@/components/ui";
import { STATUS_META } from "@/components/freshness";
import { ItemSheet, type SheetIntent } from "@/components/item-sheet";
import { InstallCard } from "@/components/install-card";
import { binMany, canFreeze, capitalise, freezeItem, markBinned } from "@/components/pantry/actions";
import { formatQuantity, startOfMonth, wasteTotals } from "@/components/pantry/format";
import { ItemRow } from "@/components/pantry/item-row";
import { OverflowMenu } from "@/components/pantry/overflow-menu";
import { UseButton } from "@/components/pantry/use-button";
import { DateCheck, needsDateCheck } from "@/components/pantry/date-check";
import { keepFocusNear } from "@/components/pantry/focus";
import { FreezePrompt, FridgeCheck } from "@/components/fridge-check";

function greeting(hour: number) {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

/** How many urgent items get a full card; the rest are compact rows underneath. */
const MOBILE_CARDS = 2;
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
        title={
          now ? (
            greeting(now.getHours())
          ) : (
            // Same height as the greeting, so nothing moves when it arrives.
            <span aria-label="Today" className="inline-block h-[1.1em] w-56 max-w-full rounded-full bg-surface-2 align-[-0.15em]" />
          )
        }
        subtitle={now ? [name, dateline].filter(Boolean).join(" · ") : <span className="inline-block h-[1em] w-44 rounded-full bg-surface-2/70 align-middle" />}
        showSettings
        actions={
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

/** Mirrors the loaded dashboard: "Eat me first" cards, a few rows, and the glance tiles. */
function TodaySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your larder" className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10">
      <div>
        <SectionTitle>Eat me first</SectionTitle>
        <div className="grid gap-3 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-44 rounded-[var(--radius-card)] bg-surface-2/70" />
          ))}
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-[68px] rounded-2xl bg-surface-2/50" />
          ))}
        </div>
      </div>
      <div>
        <SectionTitle>At a glance</SectionTitle>
        <div className="h-[84px] rounded-[var(--radius-card)] bg-surface-2/70" />
      </div>
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
  const nowMs = useNow();
  const urgent = views.filter((v) => v.expiry.status === "use-today" || v.expiry.status === "use-soon");
  const expired = views.filter((v) => v.expiry.status === "expired");
  const nextUp = views.find((v) => v.expiry.status === "fresh");
  const cards = urgent.slice(0, DESKTOP_CARDS);
  const rows = urgent.slice(MOBILE_CARDS);

  return (
    <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-10">
      <div className="flex min-w-0 flex-col gap-8">
        <section aria-labelledby="eat-first" className="min-w-0">
          <SectionTitle
            action={
              urgent.length > 0 && (
                <Link href="/pantry?due=soon" className="inline-flex min-h-11 items-center gap-0.5 rounded-lg text-sm font-semibold text-primary hover:underline">
                  {urgent.length === 1 ? "1 item" : `${urgent.length} items`}
                  <ChevronRight size={16} aria-hidden />
                  <span className="sr-only"> to use soon, in the larder</span>
                </Link>
              )
            }
          >
            <span id="eat-first" tabIndex={-1} className="rounded-lg">
              Eat me first
            </span>
          </SectionTitle>
          {urgent.length > 0 ? (
            <>
              <ul className="grid gap-3 lg:grid-cols-2">
                {cards.map((v, i) => (
                  <EatFirstCard key={v.item.id} view={v} onOpen={onOpen} className={i >= MOBILE_CARDS ? "max-lg:hidden" : undefined} />
                ))}
              </ul>
              {rows.length > 0 && (
                <div className={cx("mt-4", urgent.length <= DESKTOP_CARDS && "lg:hidden")}>
                  <h3 className="mb-1 text-sm font-semibold text-ink-2">Also coming up</h3>
                  <ul className="-mx-2 flex flex-col divide-y divide-line">
                    {rows.map((v, i) => (
                      // On desktop the first rows are already cards.
                      <ItemRow
                        key={v.item.id}
                        view={v}
                        onOpen={onOpen}
                        focusFallback={todayHeading}
                        className={i < DESKTOP_CARDS - MOBILE_CARDS ? "lg:hidden" : undefined}
                      />
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
        <FreezePrompt views={views} now={nowMs} />
        <FridgeCheck views={views} now={nowMs} />
      </div>

      <div className="flex flex-col gap-8">
        {expired.length > 0 && <CheckThese views={expired} onOpen={onOpen} />}
        <Summary views={views} />
        <KitchenCard />
        <InstallCard />
      </div>
    </div>
  );
}

function EatFirstCard({ view, onOpen, className }: { view: ItemView; onOpen: Open; className?: string }) {
  const { item, location, expiry } = view;
  const meta = STATUS_META[expiry.status];
  const days = capitalise(describeDaysLeft(expiry, item.dateKind));
  const details = [formatQuantity(item.quantity, item.unit), location?.name, item.openedAt && "Opened"].filter(Boolean).join(" · ");
  const check = needsDateCheck(view);
  const freezable = canFreeze(view);
  const [checking, setChecking] = useState(false);
  return (
    <li className={className}>
      <Card className="flex h-full flex-col p-4">
        <button
          type="button"
          data-row-focus={item.id}
          onClick={() => onOpen(item.id)}
          className="-m-1 flex flex-1 flex-col items-start rounded-2xl p-1 text-left"
        >
          <span className="flex w-full items-center gap-3">
            <span
              aria-hidden
              className={cx("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-[1.75rem] leading-none", meta.soft)}
            >
              {item.emoji}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="line-clamp-2 font-display text-xl leading-snug text-ink">{item.name}</span>
              <span className={cx("inline-flex items-center gap-1.5 text-[15px] font-semibold", meta.text)}>
                <meta.Icon size={16} aria-hidden strokeWidth={2.5} />
                {days}
              </span>
              <span className="text-sm text-ink-2">{details}</span>
            </span>
          </span>
        </button>
        <div className="mt-4 flex gap-2">
          <UseButton item={item} look="card" beforeRemove={(el) => keepFocusNear(el, todayHeading)} />
          <Link
            href={`/recipes?use=${encodeURIComponent(item.id)}`}
            className={cx(buttonClass("secondary", "sm"), "h-11 flex-1 whitespace-nowrap px-3")}
          >
            <ChefHat size={16} aria-hidden />
            Cook with it
          </Link>
        </div>
        {(freezable || check) && (
          <div className="-mb-1 mt-2 flex flex-wrap gap-x-1">
            {freezable && (
              <Button size="sm" variant="ghost" className="h-11 px-2.5" onClick={() => freezeItem(item.id)}>
                <Snowflake size={16} aria-hidden />
                Freeze it
              </Button>
            )}
            {check && (
              <Button size="sm" variant="ghost" className="h-11 px-2.5" aria-expanded={checking} onClick={() => setChecking((c) => !c)}>
                <CalendarCheck size={16} aria-hidden />
                Check the date
              </Button>
            )}
          </div>
        )}
        {check && checking && <DateCheck view={view} kind={check} className="mt-2 rounded-2xl bg-surface-2 p-3" />}
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
          ? "Past their date. Best-before food is usually still safe: if it looks, smells and tastes fine, keep it and tell us. Use-by food should go."
          : "Past their date, so they're best binned, unless the pack says otherwise."}
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
  const check = needsDateCheck(view);
  const [checking, setChecking] = useState(false);
  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
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
              Bin it
            </Button>
            {check ? (
              <Button size="sm" variant="ghost" className="h-10" aria-expanded={checking} onClick={() => setChecking((c) => !c)}>
                {check === "still-good" ? "Still good" : "Still in date"}
              </Button>
            ) : (
              <OverflowMenu
                label={`More for ${item.name}`}
                actions={[{ label: "Edit date", Icon: PencilLine, onSelect: () => onOpen(item.id, "edit-date") }]}
              />
            )}
          </div>
        </div>
      </div>
      {check && checking && <DateCheck view={view} kind={check} className="mt-3 rounded-2xl bg-surface-2 p-3" />}
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
    { key: "week", href: "/pantry?due=week", n: thisWeek, label: "to eat in the next 7 days", short: "Due this week" },
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
                <span className="font-sans text-2xl font-semibold tabular-nums text-ink">{c.n}</span>
                <span className="text-[13px] leading-tight text-ink-2">
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

/** A labelled way in to Insights and Nutrition ("Your kitchen"), with this month's numbers. */
function KitchenCard() {
  const events = useLarder((s) => s.events);
  const month = useMemo(() => wasteTotals(events, startOfMonth()), [events]);
  const total = month.used + month.binned;
  return (
    <section aria-labelledby="your-kitchen">
      <SectionTitle>
        <span id="your-kitchen">Your kitchen</span>
      </SectionTitle>
      <Link href="/kitchen" className="flex min-h-14 items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4 hover:bg-surface-2">
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-ink">
            {total === 0 ? "Insights and nutrition" : `This month: ${month.used} used, ${month.binned} binned`}
          </span>
          <span className="block text-sm text-ink-2">
            {total === 0
              ? "See what gets eaten, what gets binned, and what you've had."
              : month.binned === 0
                ? "Nothing wasted so far. Lovely. See insights and nutrition."
                : `${Math.round((month.used / total) * 100)}% eaten. See what gets binned, and nutrition.`}
          </span>
        </span>
        <ChevronRight size={20} aria-hidden className="shrink-0 text-ink-3" />
      </Link>
    </section>
  );
}
