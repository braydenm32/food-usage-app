"use client";

import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cx } from "@/components/ui";

export interface MenuAction {
  label: string;
  Icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
}

/**
 * A small "more actions" menu: keyboard friendly (arrows, Escape), closes on outside press.
 * Pass `trigger` to replace the ⋯ button's content (the button keeps the menu wiring), and
 * `onTrigger` to handle a press yourself: return false to keep the menu shut.
 */
export function OverflowMenu({
  label,
  actions,
  placement = "down",
  className,
  trigger,
  triggerClassName,
  triggerProps,
  onTrigger,
  heading,
}: {
  label: string;
  actions: MenuAction[];
  placement?: "up" | "down";
  className?: string;
  trigger?: ReactNode;
  triggerClassName?: string;
  triggerProps?: ButtonHTMLAttributes<HTMLButtonElement>;
  onTrigger?: () => boolean;
  /** Short text shown at the top of the menu, e.g. "How much did you use?". */
  heading?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trig = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    wrap.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trig.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      // Keep Escape from also closing a surrounding dialog.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div ref={wrap} className={cx("relative", className)} onKeyDown={open ? onKeyDown : undefined}>
      <button
        ref={trig}
        type="button"
        aria-label={trigger ? undefined : label}
        title={trigger ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        {...triggerProps}
        onClick={(e) => {
          triggerProps?.onClick?.(e);
          if (onTrigger && !open && onTrigger() === false) return;
          setOpen((o) => !o);
        }}
        className={
          triggerClassName ??
          "inline-flex h-11 w-11 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
        }
      >
        {trigger ?? <MoreHorizontal size={20} aria-hidden />}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className={cx(
            "animate-fade-in absolute right-0 z-30 min-w-56 overflow-hidden rounded-2xl border border-line bg-surface py-1.5 shadow-card",
            placement === "down" ? "top-full mt-1" : "bottom-full mb-1",
          )}
        >
          {heading && (
            <p aria-hidden className="px-4 pb-1 pt-1.5 text-xs font-medium text-ink-2">
              {heading}
            </p>
          )}
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              onClick={() => {
                close(false);
                a.onSelect();
              }}
              className={cx(
                "flex h-11 w-full items-center gap-3 whitespace-nowrap px-4 text-left text-[15px] font-medium hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none",
                a.danger ? "text-spoiled" : "text-ink",
              )}
            >
              {a.Icon && <a.Icon size={18} aria-hidden />}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
