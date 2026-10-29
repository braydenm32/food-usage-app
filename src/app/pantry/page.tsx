"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpDown, ChartPie, ChevronDown, Search, X } from "lucide-react";
import { useLarder } from "@/lib/store";
import { useItemViews, type ItemView } from "@/lib/selectors";
import { useHydrated } from "@/lib/use-hydrated";
import type { ItemStatus } from "@/lib/types";
import { Button, Chip, EmptyState, Input, PageHeader, buttonClass } from "@/components/ui";
import { STATUS_META } from "@/components/freshness";
import { ItemSheet } from "@/components/item-sheet";
import { ItemRow } from "@/components/pantry/item-row";
import { LocationIcon } from "@/components/pantry/location-icon";
import { focusRow } from "@/components/pantry/focus";

type SortMode = "use-first" | "az" | "recent";
const SORT_KEY = "larder-pantry-sort";
const SORTS: { value: SortMode; label: string }[] = [
  { value: "use-first", label: "Use first" },
  { value: "az", label: "A–Z" },
  { value: "recent", label: "Newest" },
];

function readSort(): SortMode {
  try {
    const v = typeof window === "undefined" ? null : window.localStorage.getItem(SORT_KEY);
    return SORTS.some((s) => s.value === v) ? (v as SortMode) : "use-first";
  } catch {
    return "use-first";
  }
}

function saveSort(v: SortMode) {
  try {
    window.localStorage.setItem(SORT_KEY, v);
  } catch {
    /* private mode: the choice lasts for this visit */
  }
}

/** "/" jumps to the search box, unless the user is typing somewhere or a dialog is open. */
function useSlashToSearch(ref: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return;
      if (document.querySelector("dialog[open]")) return;
      if (!ref.current) return;
      e.preventDefault();
      ref.current.focus();
      ref.current.select();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ref]);
}

const listHeading = () => document.getElementById("larder-items");

const GROUP_TITLES: Record<ItemStatus, string> = {
  expired: "Check these",
  "use-today": "Use today",
  "use-soon": "Use soon",
  fresh: "Fresh",
};
const GROUP_ORDER: ItemStatus[] = ["expired", "use-today", "use-soon", "fresh"];

export default function PantryPage() {
  return (
    <Suspense fallback={<PantrySkeleton />}>
      <Pantry />
    </Suspense>
  );
}

function PantrySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading your larder">
      <PageHeader title="Larder" subtitle={<span className="invisible">Loading</span>} />
      <div className="flex flex-col gap-3 px-5 lg:px-0">
        <div className="h-9 w-3/4 rounded-full bg-surface-2/70" />
        <div className="h-12 rounded-2xl bg-surface-2/70" />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-[72px] rounded-2xl bg-surface-2/50" />
        ))}
      </div>
    </div>
  );
}

function Pantry() {
  const hydrated = useHydrated();
  const router = useRouter();
  const params = useSearchParams();
  const views = useItemViews();
  const locations = useLarder((s) => s.locations);
  const loadDemoData = useLarder((s) => s.loadDemoData);

  const locParam = params.get("loc");
  const loc = locParam && locations.some((l) => l.id === locParam) ? locParam : "all";
  const [query, setQuery] = useState("");
  const [sort, setSortState] = useState<SortMode>(readSort);
  const setSort = (v: SortMode) => {
    setSortState(v);
    saveSort(v);
  };
  const [openId, setOpenId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useSlashToSearch(searchRef);

  const setLoc = (id: string) => router.replace(id === "all" ? "/pantry" : `/pantry?loc=${encodeURIComponent(id)}`, { scroll: false });

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of views) m.set(v.item.locationId, (m.get(v.item.locationId) ?? 0) + 1);
    return m;
  }, [views]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = views.filter(
      (v) =>
        (loc === "all" || v.item.locationId === loc) &&
        (!q || v.item.name.toLowerCase().includes(q) || v.food?.name.toLowerCase().includes(q)),
    );
    if (sort === "az") return [...list].sort((a, b) => a.item.name.localeCompare(b.item.name));
    if (sort === "recent") return [...list].sort((a, b) => b.item.addedAt.localeCompare(a.item.addedAt));
    return list; // already most urgent first
  }, [views, loc, query, sort]);

  // Rows in on-screen order, so focus can land on a neighbour when the sheet removes an item.
  const order = useMemo(
    () => (sort === "use-first" ? GROUP_ORDER.flatMap((st) => shown.filter((v) => v.expiry.status === st)) : shown).map((v) => v.item.id),
    [shown, sort],
  );
  const opened = useRef<{ id: string; order: string[] } | null>(null);
  const openSheet = useCallback((id: string) => {
    opened.current = { id, order };
    setOpenId(id);
  }, [order]);
  const closeSheet = useCallback(() => {
    setOpenId(null);
    const was = opened.current;
    opened.current = null;
    if (!was) return;
    setTimeout(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      if (focusRow(was.id)) return;
      const i = was.order.indexOf(was.id);
      const rest = [...was.order.slice(i + 1), ...was.order.slice(0, Math.max(0, i)).reverse()];
      if (!rest.some((n) => focusRow(n))) listHeading()?.focus();
    }, 50);
  }, []);

  if (!hydrated) return <PantrySkeleton />;

  const location = locations.find((l) => l.id === loc);
  const total = views.length;

  return (
    <>
      <PageHeader
        title="Larder"
        subtitle={total === 0 ? "Everything you've got, in one place" : `${total} ${total === 1 ? "item" : "items"} across ${locations.length} spots`}
        showSettings
        actions={
          <Link
            href="/insights"
            aria-label="Insights"
            title="Insights"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink lg:hidden"
          >
            <ChartPie size={22} aria-hidden />
          </Link>
        }
      />
      <div className="px-5 lg:px-0">
        {total === 0 ? (
          <EmptyState
            emoji="🫙"
            title="Your larder is empty"
            body="Add your shopping and Larder will keep an eye on dates for you."
            action={
              <div className="flex flex-col items-center gap-2">
                <Link href="/add" className={buttonClass("primary", "lg")}>
                  Add food
                </Link>
                <Button variant="ghost" onClick={loadDemoData}>
                  Try with sample food
                </Button>
              </div>
            }
          />
        ) : (
          <>
            <div
              role="group"
              aria-label="Where"
              className="scrollbar-none fade-x -mx-5 flex gap-2 overflow-x-auto px-5 py-1 lg:mx-0 lg:flex-wrap lg:px-0 lg:[-webkit-mask-image:none]! lg:[mask-image:none]!"
            >
              <Chip selected={loc === "all"} onClick={() => setLoc("all")}>
                All <span className="tabular-nums opacity-70">{total}</span>
              </Chip>
              {locations.map((l) => (
                <Chip key={l.id} selected={loc === l.id} onClick={() => setLoc(l.id)}>
                  <LocationIcon kind={l.kind} />
                  {l.name} <span className="tabular-nums opacity-70">{counts.get(l.id) ?? 0}</span>
                </Chip>
              ))}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search size={18} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" />
                <Input
                  ref={searchRef}
                  type="search"
                  aria-label="Search the larder"
                  aria-keyshortcuts="/"
                  placeholder="Search the larder"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-11 pr-11 [&::-webkit-search-cancel-button]:hidden"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="absolute right-1 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2"
                  >
                    <X size={18} aria-hidden />
                  </button>
                )}
              </div>
              <SortSelect value={sort} onChange={setSort} />
            </div>

            <h2 id="larder-items" tabIndex={-1} className="sr-only">
              {location ? `${location.name} items` : "All items"}
            </h2>
            <p role="status" className="sr-only">
              {query.trim()
                ? `${shown.length} ${shown.length === 1 ? "item matches" : "items match"} “${query.trim()}”`
                : `${shown.length} ${shown.length === 1 ? "item" : "items"}${location ? ` in the ${location.name.toLowerCase()}` : ""}`}
            </p>
            <div className="mt-4">
              {shown.length === 0 ? (
                query ? (
                  <EmptyState
                    emoji="🔍"
                    title={`No “${query.trim()}” here`}
                    body={location ? `Nothing by that name in the ${location.name.toLowerCase()}.` : "Try another word, or add it."}
                    action={
                      <Button variant="secondary" onClick={() => setQuery("")}>
                        Clear search
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    emoji={location?.emoji ?? "🫙"}
                    title={`Nothing in the ${location?.name.toLowerCase() ?? "larder"}`}
                    body={
                      location?.kind === "freezer"
                        ? "Freezing is a good way to save food you won't get to in time."
                        : "When you add food here it'll show up in this list."
                    }
                    action={
                      <Link href="/add" className={buttonClass("secondary")}>
                        Add food
                      </Link>
                    }
                  />
                )
              ) : sort === "use-first" ? (
                GROUP_ORDER.map((status) => {
                  const group = shown.filter((v) => v.expiry.status === status);
                  if (group.length === 0) return null;
                  return <Group key={status} status={status} views={group} showLocation={loc === "all"} onOpen={openSheet} />;
                })
              ) : (
                <ul className="-mx-2 flex flex-col">
                  {shown.map((v) => (
                    <ItemRow key={v.item.id} view={v} showLocation={loc === "all"} onOpen={openSheet} focusFallback={listHeading} />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
      <ItemSheet itemId={openId} open={!!openId} onClose={closeSheet} />
    </>
  );
}

function Group({
  status,
  views,
  showLocation,
  onOpen,
}: {
  status: ItemStatus;
  views: ItemView[];
  showLocation: boolean;
  onOpen: (id: string) => void;
}) {
  const m = STATUS_META[status];
  const id = `group-${status}`;
  return (
    <section aria-labelledby={id} className="mb-5">
      <h2 id={id} className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink-2">
        <m.Icon size={15} aria-hidden className={m.text} strokeWidth={2.5} />
        {GROUP_TITLES[status]}
        <span className="font-normal text-ink-3">{views.length}</span>
      </h2>
      <ul className="-mx-2 flex flex-col">
        {views.map((v) => (
          <ItemRow key={v.item.id} view={v} showLocation={showLocation} onOpen={onOpen} focusFallback={listHeading} />
        ))}
      </ul>
    </section>
  );
}

/** Compact sort control beside the search box: a native select, so it works everywhere. */
function SortSelect({ value, onChange }: { value: SortMode; onChange: (v: SortMode) => void }) {
  return (
    <label className="relative inline-flex h-12 shrink-0 items-center rounded-2xl border border-line bg-surface text-ink-2 focus-within:border-primary hover:text-ink">
      <span className="sr-only">Sort by</span>
      <ArrowUpDown size={17} aria-hidden className="pointer-events-none absolute left-3 sm:left-3.5" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortMode)}
        className="h-full cursor-pointer appearance-none rounded-2xl bg-transparent pl-9 pr-3 text-[15px] font-medium text-ink outline-none sm:pl-10 sm:pr-9"
      >
        {SORTS.map((s) => (
          <option key={s.value} value={s.value} className="text-ink">
            {s.label}
          </option>
        ))}
      </select>
      <ChevronDown size={16} aria-hidden className="pointer-events-none absolute right-3 hidden sm:block" />
    </label>
  );
}
