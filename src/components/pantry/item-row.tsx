"use client";

import { Check, PackageOpen, Trash, Trash2 } from "lucide-react";
import type { ItemView } from "@/lib/selectors";
import { describeDaysLeft } from "@/lib/shelf-life/engine";
import { FreshnessBar, STATUS_META } from "@/components/freshness";
import { cx } from "@/components/ui";
import { describeShareLeft, formatQuantity, freshnessFraction } from "./format";
import { capitalise, markBinned, markOpened, markUsed, removeItem } from "./actions";
import { OverflowMenu, type MenuAction } from "./overflow-menu";

/** One larder item: tap to open its sheet; "Used" and a menu for quick actions. */
export function ItemRow({
  view,
  showLocation = true,
  onOpen,
}: {
  view: ItemView;
  showLocation?: boolean;
  onOpen: (id: string) => void;
}) {
  const { item, location, expiry } = view;
  const meta = STATUS_META[expiry.status];
  const left = describeShareLeft(item.quantity, item.initialQuantity);
  const days = capitalise(describeDaysLeft(expiry, item.dateKind));

  const actions: MenuAction[] = [{ label: "Bin it", Icon: Trash, onSelect: () => markBinned(item.id) }];
  if (!item.openedAt && location?.kind !== "freezer") {
    actions.unshift({ label: "Mark as opened", Icon: PackageOpen, onSelect: () => markOpened(item.id) });
  }
  actions.push({ label: "Delete (added by mistake)", Icon: Trash2, onSelect: () => removeItem(item.id), danger: true });

  return (
    <li className="flex items-center gap-1 rounded-2xl pr-1 transition-colors hover:bg-surface-2/60">
      <button
        type="button"
        onClick={() => onOpen(item.id)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl py-3 pl-2 text-left"
        aria-label={`${item.name}, ${days}. Open details`}
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
          <span className="flex min-w-0 items-baseline gap-1.5 text-[13px] text-ink-2">
            <span className={cx("shrink-0 font-semibold", meta.text)}>{days}</span>
            <span aria-hidden className="text-ink-3">
              ·
            </span>
            <span className="truncate">
              {formatQuantity(item.quantity, item.unit)}
              {left && `, ${left}`}
              {showLocation && location && ` · ${location.name}`}
            </span>
          </span>
          <FreshnessBar status={expiry.status} fraction={freshnessFraction(view)} className="mt-1 max-w-56" />
        </span>
      </button>
      <button
        type="button"
        onClick={() => markUsed(item.id)}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center gap-1.5 rounded-full text-sm font-semibold text-primary transition-colors hover:bg-primary-soft max-sm:h-10 max-sm:w-10 max-sm:border max-sm:border-line sm:w-auto sm:px-3"
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
