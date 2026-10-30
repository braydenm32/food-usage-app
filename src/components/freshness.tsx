import clsx from "clsx";
import { AlertTriangle, CircleAlert, Clock, Leaf } from "lucide-react";
import type { ItemStatus } from "@/lib/types";

export const STATUS_META: Record<
  ItemStatus,
  { label: string; text: string; soft: string; solid: string; Icon: typeof Leaf }
> = {
  fresh: { label: "Fresh", text: "text-fresh", soft: "bg-fresh-soft", solid: "bg-fresh", Icon: Leaf },
  "use-soon": { label: "Use soon", text: "text-soon", soft: "bg-soon-soft", solid: "bg-soon", Icon: Clock },
  "use-today": { label: "Use today", text: "text-today", soft: "bg-today-soft", solid: "bg-today", Icon: AlertTriangle },
  expired: { label: "Check it", text: "text-spoiled", soft: "bg-spoiled-soft", solid: "bg-spoiled", Icon: CircleAlert },
};

/** Small pill: icon + words, so colour is never the only signal. */
export function StatusPill({ status, children, className }: { status: ItemStatus; children?: React.ReactNode; className?: string }) {
  const m = STATUS_META[status];
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
        m.soft,
        m.text,
        className,
      )}
    >
      <m.Icon size={12} aria-hidden strokeWidth={2.5} />
      {children ?? m.label}
    </span>
  );
}

/**
 * A thin bar showing how much shelf life is left (full = just bought).
 * total = total shelf days, left = days remaining.
 */
export function FreshnessBar({ status, fraction, className }: { status: ItemStatus; fraction: number; className?: string }) {
  const pct = Math.max(4, Math.min(100, Math.round(fraction * 100)));
  return (
    <div className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-surface-2", className)} aria-hidden>
      <div className={clsx("h-full rounded-full", STATUS_META[status].solid)} style={{ width: `${pct}%` }} />
    </div>
  );
}
