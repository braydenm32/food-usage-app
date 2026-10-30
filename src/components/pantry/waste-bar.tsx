import { cx } from "@/components/ui";

/** Used vs binned as one bar: green for eaten, beetroot for binned. Paired with words by the caller. */
export function WasteSplitBar({ used, binned, className }: { used: number; binned: number; className?: string }) {
  const total = used + binned;
  const usedPct = total === 0 ? 0 : (used / total) * 100;
  return (
    <div
      role="img"
      aria-label={`${used} used, ${binned} binned`}
      className={cx("flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-surface-2", className)}
    >
      {used > 0 && <div className="h-full rounded-full bg-fresh" style={{ width: `${usedPct}%` }} />}
      {binned > 0 && <div className="h-full min-w-1.5 flex-1 rounded-full bg-spoiled" />}
    </div>
  );
}
