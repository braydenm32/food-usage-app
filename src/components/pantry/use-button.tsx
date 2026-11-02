"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";
import { Check, CheckCheck } from "lucide-react";
import type { PantryItem } from "@/lib/types";
import { cx } from "@/components/ui";
import { eatOne, markSomeUsed, markUsed, oneLabel, primaryUse, quickAmounts } from "./actions";
import { OverflowMenu } from "./overflow-menu";

/** How long to hold the button for "Used it all". */
export const HOLD_MS = 1000;

/**
 * Press-and-hold: returns pointer handlers, whether a hold is in progress (for the fill) and
 * a `consumed()` check so the click that ends a completed hold does nothing else.
 */
function useHold(onHold: () => void) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const handlers: ButtonHTMLAttributes<HTMLButtonElement> = {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      fired.current = false;
      setHolding(true);
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        setHolding(false);
        try {
          navigator.vibrate?.(30);
        } catch {
          /* not supported */
        }
        onHold();
      }, HOLD_MS);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    // A long press shouldn't open the browser's context menu or select text.
    onContextMenu: (e) => e.preventDefault(),
  };
  const consumed = () => {
    if (!fired.current) return false;
    fired.current = false;
    return true;
  };
  return { holding, handlers, consumed };
}

/** The fill that grows while the button is held. */
function HoldFill({ holding, tone }: { holding: boolean; tone: "solid" | "soft" }) {
  return (
    <span
      aria-hidden
      className={cx(
        "pointer-events-none absolute inset-0 origin-left rounded-[inherit] ease-linear",
        tone === "solid" ? "bg-ink/25" : "bg-primary/20",
        holding ? "scale-x-100 transition-transform" : "scale-x-0 transition-none",
      )}
      style={holding ? { transitionDuration: `${HOLD_MS}ms` } : undefined}
    />
  );
}

/**
 * The main "used" action for an item. A tap means "had some": "Ate 1" for countable food with
 * more than one, a quick amount choice for weights and volumes, "Used it all" when one is left.
 * Holding it for about a second means "Finished it" (Used it all). Every path toasts with Undo;
 * keyboard users get "Used it all" in the item's menu.
 */
export function UseButton({
  item,
  look = "row",
  beforeRemove,
  className,
}: {
  item: Pick<PantryItem, "id" | "name" | "unit" | "quantity">;
  /** "card": a solid button with text (Today). "row": a compact outlined button (Larder rows). */
  look?: "card" | "row";
  /** Called before an action that may remove the item, with the button, to keep focus nearby. */
  beforeRemove?: (el: HTMLElement) => void;
  className?: string;
}) {
  const btn = useRef<HTMLDivElement>(null);
  const mode = primaryUse(item);
  const finish = () => {
    if (btn.current) beforeRemove?.(btn.current);
    markUsed(item.id);
  };
  const { holding, handlers, consumed } = useHold(finish);

  const label = mode === "one" ? oneLabel(item) : mode === "amount" ? "Used some" : "Used it all";
  const hint = mode === "all" ? undefined : `Tap: ${label}. Hold: used it all`;
  const classes = cx(
    "relative isolate inline-flex shrink-0 select-none items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap rounded-full font-semibold transition-colors [-webkit-touch-callout:none] [touch-action:manipulation]",
    look === "card"
      ? "h-11 bg-primary px-3 text-sm text-primary-ink hover:brightness-110"
      : "h-11 border border-line px-3 text-sm text-primary hover:bg-primary-soft",
    className,
  );
  const content = (
    <>
      <HoldFill holding={holding} tone={look === "card" ? "solid" : "soft"} />
      {mode === "all" ? <CheckCheck size={18} aria-hidden strokeWidth={2.25} /> : <Check size={18} aria-hidden strokeWidth={2.5} />}
      <span>{label}</span>
      <span className="sr-only">: {item.name}</span>
    </>
  );

  if (mode === "amount") {
    const amounts = quickAmounts(item);
    return (
      <div ref={btn} className={cx("shrink-0", look === "card" && "flex-1 [&>div]:w-full [&_button[aria-haspopup]]:w-full")}>
        <OverflowMenu
          label={`How much ${item.name} did you use?`}
          heading="How much did you use?"
          trigger={content}
          triggerClassName={classes}
          triggerProps={{ ...handlers, title: hint }}
          onTrigger={() => !consumed()}
          actions={[
            ...amounts.map((a) => ({ label: a.label, onSelect: () => markSomeUsed(item.id, a.quantity) })),
            { label: "Used it all", Icon: CheckCheck, onSelect: finish },
          ]}
        />
      </div>
    );
  }

  return (
    <div ref={btn} className={cx("shrink-0", look === "card" && "flex-1 [&>button]:w-full")}>
      <button
        type="button"
        {...handlers}
        title={hint}
        onClick={() => {
          if (consumed()) return;
          if (mode === "one") eatOne(item.id);
          else finish();
        }}
        className={classes}
      >
        {content}
      </button>
    </div>
  );
}
