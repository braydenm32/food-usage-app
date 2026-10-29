"use client";

import { Check, PackageOpen, Trash, Trash2 } from "lucide-react";
import type { ItemView } from "@/lib/selectors";
import { describeDaysLeft } from "@/lib/shelf-life/engine";
import { FreshnessBar, STATUS_META } from "@/components/freshness";
import { cx } from "@/components/ui";
import { describeShareLeft, formatQuantity, freshnessFraction } from "./format";
import { capitalise, markBinned, markOpened, markUsed, removeItem } from "./actions";
import { OverflowMenu, type MenuAction } from "./overflow-menu";
import { keepFocusNear } from "./focus";

/** One larder item: tap to open its sheet; "Used" and a menu for quick actions. */
export function ItemRow({
  view,
  showLocation = true,
  onOpen,
  focusFallback,
}: {
  view: ItemView;
  showLocation?: boolean;
  onOpen: (id: string) => void;
  /** Where focus goes when this row is removed and it has no neighbours. */
  focusFallback?: () => HTMLElement | null;
}) {
  const { item, location, expiry } = view;
  const meta = STATUS_META[expiry.status];
  const left = describeShareLeft(item.quantity, item.initialQuantity);
  const days = capitalise(describeDaysLeft(expiry, item.dateKind));

  // Actions that remove the row keep keyboard focus nearby.
  const removing = (fn: (id: string) => void) => (el?: Element | null) => {
    keepFocusNear(el ?? document.querySelector(`[data-row-focus="${CSS.escape(item.id)}"]`), focusFallback);
    fn(item.id);
  };

  const actions: MenuAction[] = [{ label: "Bin it", Icon: Trash, onSelect: () => removing(markBinned)() }];
  if (!item.openedAt && location?.kind !== "freezer") {
    actions.unshift({ label: "Mark as opened", Icon: PackageOpen, onSelect: () => markOpened(item.id) });
  }
  actions.push({ label: "Delete (added by mistake)", Icon: Trash2, onSelect: () => removing(removeItem)(), danger: true });

  const amount = [formatQuantity(item.quantity, item.unit), left].filter(Boolean).join(", ");

  return (
    <li className="flex items-center gap-1 rounded-2xl pr-1 transition-colors hover:bg-surface-2/60">
      <button
        type="button"
        data-row-focus={item.id}
        onClick={() => onOpen(item.id)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl py-3 pl-2 text-left"
        aria-label={`${item.name}, ${days}, ${amount}${showLocation && location ? `, ${location.name}` : ""}. Open details`}
      >
        <span
          aria-hidden
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-[1.75rem] leading-none"
        >
          {item.emoji}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[16px] font-semibold text-ink">{item.name}</span>
            {item.openedAt && (
              <span className="shrink-0 rounded-full border border-line px-1.5 text-[11px] font-semibold leading-[18px] text-ink-2">
                Opened
              </span>
            )}
          </span>
          {/* Wraps rather than truncating: the date, amount and spot all matter. Each part has a
              leading dot; the negative margin + overflow clip hides the dot that starts a line. */}
          <span className="overflow-hidden text-[13px] leading-5 text-ink-2">
            <span className="-ml-3 flex flex-wrap items-baseline">
              {[
                <span key="d" className={cx("font-semibold", meta.text)}>{days}</span>,
                amount,
                showLocation && location ? location.name : null,
              ]
                .filter(Boolean)
                .map((part, i) => (
                  <span
                    key={i}
                    className="whitespace-nowrap before:inline-block before:w-3 before:text-center before:text-ink-3 before:content-['·']"
                  >
                    {part}
                  </span>
                ))}
            </span>
          </span>
          <FreshnessBar status={expiry.status} fraction={freshnessFraction(view)} className="mt-1 max-w-56 sm:max-w-none" />
        </span>
      </button>
      <button
        type="button"
        onClick={(e) => removing(markUsed)(e.currentTarget)}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center gap-1.5 rounded-full text-sm font-semibold text-primary transition-colors hover:bg-primary-soft sm:ml-3 sm:w-auto sm:border sm:border-line sm:px-3.5"
        aria-label={`Used all of ${item.name}`}
        title="Used it all"
      >
        <Check size={20} aria-hidden strokeWidth={2.5} />
        <span className="hidden sm:inline">Used</span>
      </button>
      <OverflowMenu label={`More for ${item.name}`} actions={actions} />
    </li>
  );
}
