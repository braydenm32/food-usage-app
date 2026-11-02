import Link from "next/link";
import { BookOpen, CalendarPlus, CircleAlert, Clock, Sparkles, TriangleAlert, Users } from "lucide-react";
import { Card, cx } from "@/components/ui";
import { StatusPill, STATUS_META } from "@/components/freshness";
import { needsStaples, stockCount, type RankedRecipe } from "@/lib/recipes/suggest";
import { RecipeThumb } from "./recipe-thumb";

export function RecipeCard({
  ranked,
  showUses = true,
  href,
  warning,
  labelCheck,
  feature = false,
  planLabel,
  onPlan,
}: {
  ranked: RankedRecipe;
  showUses?: boolean;
  /** Override the detail link (e.g. to carry ?plan=). */
  href?: string;
  /** A household allergen in this recipe, shown as a warning. */
  warning?: string;
  /** Ingredients worth checking the label of ("may contain gluten"). Advisory. */
  labelCheck?: string;
  /** The first, larger card at the top of a list. */
  feature?: boolean;
  /** When planning a day: the button label ("Plan for Monday") and its handler. */
  planLabel?: string;
  onPlan?: () => void;
}) {
  const { recipe, atRisk, missing, uses } = ranked;
  const have = missing.length === 0;
  const stock = stockCount(ranked);
  const staples = needsStaples(recipe);
  return (
    <Card className={cx("relative h-full overflow-hidden transition-colors hover:bg-surface-2/60")}>
      <div className={cx("flex gap-3 p-4", feature && "flex-col lg:flex-row lg:gap-5")}>
        <RecipeThumb recipe={recipe} variant={feature ? "feature" : "card"} />
        <div className="min-w-0 flex-1">
          <h3 className={cx("font-display leading-snug text-ink", feature ? "text-2xl" : "text-lg")}>
            <Link
              href={href ?? `/recipes/${encodeURIComponent(recipe.id)}`}
              className="after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-[var(--radius-card)]"
            >
              {recipe.title}
            </Link>
          </h3>
          {feature && recipe.summary && <p className="mt-1 text-[15px] text-ink-2">{recipe.summary}</p>}
          <ul className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-ink-2" aria-label="Details">
            {recipe.minutes && (
              <li className="inline-flex items-center gap-1">
                <Clock size={14} aria-hidden /> {recipe.minutes} min
              </li>
            )}
            <li className="inline-flex items-center gap-1">
              <Users size={14} aria-hidden /> Serves {recipe.servings}
              {recipe.servingsEstimated || recipe.source === "database" ? " (est.)" : ""}
            </li>
            {recipe.source === "ai" ? (
              <li className="inline-flex items-center gap-1">
                <Sparkles size={14} aria-hidden /> Larder original
              </li>
            ) : recipe.credit ? (
              <li className="inline-flex items-center gap-1">
                <BookOpen size={14} aria-hidden /> {recipe.credit.name}
              </li>
            ) : null}
            {showUses &&
              atRisk.slice(0, 3).map((u) => (
                <li key={u.itemId}>
                  <StatusPill status={u.status}>
                    {u.itemName} · {u.pastBestBefore ? "past best before, check it" : STATUS_META[u.status].label.toLowerCase()}
                  </StatusPill>
                </li>
              ))}
            {showUses && atRisk.length > 3 && <li className="text-xs text-ink-3">+{atRisk.length - 3} more</li>}
          </ul>
          {warning && (
            <p className="mt-2 flex items-start gap-1.5 text-sm font-medium text-spoiled">
              <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden /> {warning}
            </p>
          )}
          {labelCheck && (
            <p className="mt-2 flex items-start gap-1.5 text-sm text-ink-2">
              <TriangleAlert size={16} className="mt-0.5 shrink-0 text-soon" aria-label="Warning" /> {labelCheck}
            </p>
          )}
          {showUses && (
            <p className={cx("mt-1.5 text-sm", have && uses.length > 0 ? "text-fresh" : "text-ink-2")}>
              {have
                ? uses.length > 0
                  ? staples
                    ? "You have everything, plus pantry staples"
                    : "You have everything"
                  : "Just pantry staples needed"
                : `${stock.total > 0 ? `You have ${stock.have} of ${stock.total} · ` : ""}need ${missing.slice(0, 2).map((m) => m.name.toLowerCase()).join(", ")}${missing.length > 2 ? "…" : ""}`}
            </p>
          )}
          {planLabel && onPlan && (
            <button
              type="button"
              onClick={onPlan}
              className="relative z-10 mt-2 inline-flex h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-primary hover:bg-surface-2"
            >
              <CalendarPlus size={16} aria-hidden /> {planLabel}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

export function RecipeCardSkeleton() {
  return (
    <div className="flex animate-pulse gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-4" aria-hidden>
      <div className="h-20 w-20 shrink-0 rounded-2xl bg-surface-2" />
      <div className="flex-1">
        <div className="h-6 w-2/3 rounded-lg bg-surface-2" />
        <div className="mt-3 h-4 w-1/3 rounded bg-surface-2" />
        <div className="mt-4 flex gap-2">
          <div className="h-6 w-28 rounded-full bg-surface-2" />
          <div className="h-6 w-20 rounded-full bg-surface-2" />
        </div>
      </div>
    </div>
  );
}
