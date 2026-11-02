"use client";

import { useMemo, useState } from "react";
import { cx } from "@/components/ui";
import { ItemRow } from "@/components/pantry/item-row";
import { startOfDay, toLocalISODate } from "@/lib/shelf-life/engine";
import type { ItemView } from "@/lib/selectors";
import type { ItemStatus } from "@/lib/types";

const WEEKS = 5;
const RANK: Record<ItemStatus, number> = { expired: 3, "use-today": 2, "use-soon": 1, fresh: 0 };
const DOT: Record<ItemStatus, string> = { expired: "bg-spoiled", "use-today": "bg-today", "use-soon": "bg-soon", fresh: "bg-fresh" };

/**
 * Month-style view of when things run out: five weeks from this Monday, a dot count on each day,
 * and the items for the picked day underneath. Anything already past its date is listed first.
 */
export function ExpiryCalendar({
  views,
  now,
  showLocation,
  onOpen,
  focusFallback,
}: {
  views: ItemView[];
  now: number;
  showLocation: boolean;
  onOpen: (id: string) => void;
  focusFallback: () => HTMLElement | null;
}) {
  const today = startOfDay(new Date(now));
  const todayIso = toLocalISODate(today);
  const [picked, setPicked] = useState(todayIso);

  const { byDay, past, later } = useMemo(() => {
    const byDay = new Map<string, ItemView[]>();
    const past: ItemView[] = [];
    const later: ItemView[] = [];
    const end = new Date(today);
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    end.setTime(monday.getTime());
    end.setDate(monday.getDate() + WEEKS * 7);
    for (const v of views) {
      const d = startOfDay(v.expiry.expiresOn);
      if (d < today) past.push(v);
      else if (d >= end) later.push(v);
      else {
        const k = toLocalISODate(d);
        byDay.set(k, [...(byDay.get(k) ?? []), v]);
      }
    }
    return { byDay, past, later };
    // `today` is derived from `now`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [views, now]);

  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const days = Array.from({ length: WEEKS * 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
  const pickedViews = picked === "past" ? past : picked === "later" ? later : (byDay.get(picked) ?? []);
  const pickedLabel =
    picked === "past"
      ? "Already past their date"
      : picked === "later"
        ? "Later on"
        : picked === todayIso
          ? "Today"
          : new Date(`${picked}T00:00`).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div>
      {past.length > 0 && (
        <button
          type="button"
          onClick={() => setPicked("past")}
          aria-pressed={picked === "past"}
          className={cx(
            "mb-3 flex min-h-11 w-full items-center justify-between rounded-2xl px-4 text-left text-sm font-semibold",
            picked === "past" ? "bg-spoiled text-on-status" : "bg-spoiled-soft text-ink",
          )}
        >
          <span>Past their date</span>
          <span>{past.length}</span>
        </button>
      )}
      <p className="mb-2 text-sm font-semibold text-ink-2">
        {days[0].toLocaleDateString("en-AU", { day: "numeric", month: "short" })} – {days[days.length - 1].toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
      </p>
      <div className="grid grid-cols-7 gap-1 text-center" aria-label="Use-by calendar">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <span key={i} className="pb-1 text-xs font-medium text-ink-3" aria-hidden>
            {d}
          </span>
        ))}
        {days.map((d) => {
          const iso = toLocalISODate(d);
          const list = byDay.get(iso) ?? [];
          const isPast = d < today;
          const worst = list.reduce<ItemStatus | null>((w, v) => (!w || RANK[v.expiry.status] > RANK[w] ? v.expiry.status : w), null);
          const label = `${d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}: ${list.length ? `${list.length} ${list.length === 1 ? "item" : "items"}` : "nothing"}`;
          return (
            <button
              key={iso}
              type="button"
              disabled={isPast}
              onClick={() => setPicked(iso)}
              aria-pressed={picked === iso}
              aria-label={label}
              className={cx(
                "flex aspect-square min-h-11 flex-col items-center justify-center rounded-xl text-sm transition-colors",
                isPast ? "text-ink-3/50" : "hover:bg-surface-2",
                picked === iso && "bg-primary-soft font-semibold text-primary",
                iso === todayIso && picked !== iso && "ring-1 ring-primary/40",
              )}
            >
              <span>{d.getDate() === 1 ? d.toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : d.getDate()}</span>
              {list.length > 0 && (
                <span className="mt-0.5 flex items-center gap-0.5 text-[11px] font-semibold leading-none text-ink-2">
                  <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", worst && DOT[worst])} />
                  {list.length}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {later.length > 0 && (
        <button
          type="button"
          onClick={() => setPicked("later")}
          aria-pressed={picked === "later"}
          className={cx(
            "mt-3 flex min-h-11 w-full items-center justify-between rounded-2xl px-4 text-left text-sm font-semibold",
            picked === "later" ? "bg-primary text-primary-ink" : "bg-surface-2 text-ink",
          )}
        >
          <span>After {days[days.length - 1].toLocaleDateString("en-AU", { day: "numeric", month: "short" })}</span>
          <span>{later.length}</span>
        </button>
      )}

      <section aria-live="polite" className="mt-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-ink-2">
          {pickedLabel}
          <span className="font-normal text-ink-3">{pickedViews.length}</span>
        </h2>
        {pickedViews.length === 0 ? (
          <p className="py-3 text-sm text-ink-3">{picked === todayIso ? "Nothing runs out today." : "Nothing runs out that day."}</p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {pickedViews.map((v) => (
              <ItemRow key={v.item.id} view={v} showLocation={showLocation} onOpen={onOpen} focusFallback={focusFallback} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
