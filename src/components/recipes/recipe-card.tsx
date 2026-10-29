import Link from "next/link";
import { Clock, Users } from "lucide-react";
import { Card, cx } from "@/components/ui";
import { StatusPill, STATUS_META } from "@/components/freshness";
import type { RankedRecipe } from "@/lib/recipes/suggest";

export function RecipeCard({ ranked, showUses = true }: { ranked: RankedRecipe; showUses?: boolean }) {
  const { recipe, atRisk, missing, uses } = ranked;
  const have = missing.length === 0;
  return (
    <Card className="relative overflow-hidden transition-colors hover:bg-surface-2/60">
      <div className="flex gap-4 p-4">
        {recipe.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={recipe.image} alt="" loading="lazy" className="h-24 w-24 shrink-0 rounded-2xl bg-surface-2 object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-xl leading-snug text-ink">
            <Link href={`/recipes/${encodeURIComponent(recipe.id)}`} className="after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-[var(--radius-card)]">
              {recipe.title}
            </Link>
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-ink-2">
            {recipe.minutes && (
              <span className="inline-flex items-center gap-1">
                <Clock size={14} aria-hidden /> {recipe.minutes} min
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Users size={14} aria-hidden /> Serves {recipe.servings}
            </span>
          </p>
          {showUses && atRisk.length > 0 && (
            <ul className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Uses from your larder">
              {atRisk.slice(0, 4).map((u) => (
                <li key={u.itemId}>
                  <StatusPill status={u.status}>
                    {u.itemName} · {STATUS_META[u.status].label.toLowerCase()}
                  </StatusPill>
                </li>
              ))}
              {atRisk.length > 4 && <li className="self-center text-xs text-ink-3">+{atRisk.length - 4} more</li>}
            </ul>
          )}
          {showUses && (
            <p className={cx("mt-2 text-sm", have ? "text-fresh" : "text-ink-2")}>
              {have
                ? uses.length > 0
                  ? "You have everything"
                  : "Just staples needed"
                : `Need ${missing.length} more: ${missing.slice(0, 2).map((m) => m.name).join(", ")}${missing.length > 2 ? "…" : ""}`}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

export function RecipeCardSkeleton() {
  return (
    <div className="animate-pulse rounded-[var(--radius-card)] border border-line bg-surface p-4" aria-hidden>
      <div className="h-6 w-2/3 rounded-lg bg-surface-2" />
      <div className="mt-3 h-4 w-1/3 rounded bg-surface-2" />
      <div className="mt-4 flex gap-2">
        <div className="h-6 w-28 rounded-full bg-surface-2" />
        <div className="h-6 w-20 rounded-full bg-surface-2" />
      </div>
    </div>
  );
}
