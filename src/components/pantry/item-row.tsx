"use client";

import { useRef } from "react";
import { Check, CheckCheck, ListChecks, PackageOpen, Snowflake, Trash, Trash2 } from "lucide-react";
import type { ItemView } from "@/lib/selectors";
import { describeDaysLeft } from "@/lib/shelf-life/engine";
import { FreshnessBar, STATUS_META } from "@/components/freshness";
import { cx } from "@/components/ui";
import { describeShareLeft, formatQuantity, freshnessFraction } from "./format";
import { canFreeze, capitalise, freezeItem, markBinned, markOpened, markUsed, removeItem } from "./actions";
import { OverflowMenu, type MenuAction } from "./overflow-menu";
import { UseButton } from "./use-button";
import { keepFocusNear } from "./focus";

/** Hold a row this long to start selecting several. */
const SELECT_HOLD_MS = 500;

/** One larder item: tap to open its sheet; the "used" button and a menu for quick actions. */
export function ItemRow({
  view,
  showLocation = true,
  onOpen,
  focusFallback,
  selection,
}: {
  view: ItemView;
  showLocation?: boolean;
  onOpen: (id: string) => void;
  /** Where focus goes when this row is removed and it has no neighbours. */
  focusFallback?: () => HTMLElement | null;
  /** Multi-select (Larder): long-press or "Select" starts it; then taps toggle the row. */
  selection?: { active: boolean; selected: boolean; toggle: (id: string) => void; start: (id: string) => void };
}) {
  const { item, location, expiry } = view;
  const meta = STATUS_META[expiry.status];
  const left = describeShareLeft(item.quantity, item.initialQuantity);
  const days = capitalise(describeDaysLeft(expiry, item.dateKind));
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);

  // Actions that remove the row keep keyboard focus nearby.
  const removing = (fn: (id: string) => void) => (el?: Element | null) => {
    keepFocusNear(el ?? document.querySelector(`[data-row-focus="${CSS.escape(item.id)}"]`), focusFallback);
    fn(item.id);
  };

  const actions: MenuAction[] = [{ label: "Used it all", Icon: CheckCheck, onSelect: () => removing(markUsed)() }];
  actions.push({ label: "Bin it", Icon: Trash, onSelect: () => removing(markBinned)() });
  if (canFreeze(view)) actions.push({ label: "Freeze it", Icon: Snowflake, onSelect: () => freezeItem(item.id) });
  if (!item.openedAt && location?.kind !== "freezer") {
    actions.push({ label: "Mark as opened", Icon: PackageOpen, onSelect: () => markOpened(item.id) });
  }
  if (selection) actions.push({ label: "Select several", Icon: ListChecks, onSelect: () => selection.start(item.id) });
  actions.push({ label: "Delete entry", Icon: Trash2, onSelect: () => removing(removeItem)(), danger: true });

  const amount = [formatQuantity(item.quantity, item.unit), left].filter(Boolean).join(", ");
  const selecting = !!selection?.active;

  const cancelHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  return (
    <li
      className={cx(
        "flex flex-wrap items-center justify-end gap-x-1 rounded-2xl pr-1 transition-colors hover:bg-surface-2/60",
        selection?.selected && "bg-primary-soft hover:bg-primary-soft",
      )}
    >
      <button
        type="button"
        data-row-focus={item.id}
        aria-pressed={selecting ? !!selection?.selected : undefined}
        onPointerDown={(e) => {
          if (!selection || selecting || e.button !== 0) return;
          held.current = false;
          holdTimer.current = setTimeout(() => {
            held.current = true;
            try {
              navigator.vibrate?.(20);
            } catch {
              /* not supported */
            }
            selection.start(item.id);
          }, SELECT_HOLD_MS);
        }}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onContextMenu={(e) => selection && e.preventDefault()}
        onClick={() => {
          if (held.current) {
            held.current = false;
            return;
          }
          if (selecting) selection!.toggle(item.id);
          else onOpen(item.id);
        }}
        className="flex min-w-0 flex-1 basis-40 select-none items-center gap-3 rounded-2xl py-3 pl-2 text-left [-webkit-touch-callout:none]"
      >
        {selecting ? (
          <span
            aria-hidden
            className={cx(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-2",
              selection?.selected ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface text-transparent",
            )}
          >
            <Check size={22} strokeWidth={3} />
          </span>
        ) : (
          <span
            aria-hidden
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-surface-2 text-[1.75rem] leading-none"
          >
            {item.emoji}
          </span>
        )}
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
          {/* Only food that needs attention gets a bar: a list of full green bars is just noise. */}
          {expiry.status !== "fresh" && (
            <FreshnessBar status={expiry.status} fraction={freshnessFraction(view)} className="mt-1 max-w-56 sm:max-w-none" />
          )}
        </span>
      </button>
      {!selecting && (
        <span className="flex shrink-0 items-center gap-1 sm:ml-2">
          <UseButton item={item} beforeRemove={(el) => keepFocusNear(el, focusFallback)} />
          <OverflowMenu label={`More for ${item.name}`} actions={actions} />
        </span>
      )}
    </li>
  );
}
