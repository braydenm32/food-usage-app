"use client";

import { useMemo, useState } from "react";
import { CalendarPlus, ChevronDown, CircleHelp, Layers, Loader2, Snowflake, Trash2, TriangleAlert, X } from "lucide-react";
import { Button, Chip, IconButton, cx } from "@/components/ui";
import { useLarder } from "@/lib/store";
import { useNow } from "@/lib/use-now";
import { applyFoodType, checkPrintedDate, convertQuantity, findMergeTarget, type ReviewDraft } from "@/lib/drafts";
import { computeExpiry, describeDaysLeft, isHighRisk, parseLocalDate, soonDaysFor } from "@/lib/shelf-life/engine";
import { getFoodType } from "@/lib/shelf-life/foods";
import { formatQuantity } from "@/components/pantry/format";
import type { DateKind, PantryItem, ShelfLifeOverride, StorageLocation, Unit } from "@/lib/types";
import { FoodPicker } from "./food-picker";

/** Existing larder items that review lines are topping up, ready for `addItems(…, { merge })`. */
export interface MergePlan {
  itemId: string;
  /** Amount to add, in the existing item's unit. */
  quantity: number;
  price?: number;
}

const UNITS: { value: Unit; one: string; many: string }[] = [
  { value: "item", one: "item", many: "items" },
  { value: "g", one: "g", many: "g" },
  { value: "kg", one: "kg", many: "kg" },
  { value: "ml", one: "ml", many: "ml" },
  { value: "L", one: "L", many: "L" },
  { value: "pack", one: "pack", many: "packs" },
  { value: "bag", one: "bag", many: "bags" },
  { value: "punnet", one: "punnet", many: "punnets" },
  { value: "tub", one: "tub", many: "tubs" },
  { value: "tray", one: "tray", many: "trays" },
  { value: "bunch", one: "bunch", many: "bunches" },
  { value: "dozen", one: "dozen", many: "dozen" },
  { value: "loaf", one: "loaf", many: "loaves" },
  { value: "tin", one: "tin", many: "tins" },
  { value: "jar", one: "jar", many: "jars" },
  { value: "bottle", one: "bottle", many: "bottles" },
];

const STEP: Partial<Record<Unit, number>> = { g: 50, ml: 50, kg: 0.25, L: 0.25 };

type Patch = Partial<ReviewDraft>;

/** Why a line needs a look before it's added, if it does. */
type Flag = "pending" | "unknown" | "unsure" | "date";

function flagFor(d: ReviewDraft, pending: boolean): Flag | undefined {
  if (pending) return "pending";
  if (!d.isFood) return undefined;
  if (!d.foodTypeId) return "unknown";
  if (d.confidence !== undefined && d.confidence !== "high") return "unsure";
  if (!d.dateConfirmed && checkPrintedDate(d.printedDate) !== "ok") return "date";
  return undefined;
}

/** True when this food is raw meat or fish that would be safer in the freezer if it won't be cooked soon. */
function freezable(d: ReviewDraft): boolean {
  const food = getFoodType(d.foodTypeId);
  if (food) return (food.category === "meat" || food.category === "seafood") && food.dateKind === "use-by" && food.freezerDays !== null && (food.fridgeDays ?? 99) <= 3;
  return isHighRisk(d.name);
}

const amountOf = (d: ReviewDraft) => (d.packs && d.packs > 1 ? `${d.packs} × ${formatQuantity(d.quantity, d.unit)}` : formatQuantity(d.quantity, d.unit));

export function ReviewList({
  drafts,
  setDrafts,
  onSubmit,
  pendingKeys,
  allowRemove,
  submitting,
  showPrices,
  summarise,
}: {
  drafts: ReviewDraft[];
  setDrafts: (update: (d: ReviewDraft[]) => ReviewDraft[]) => void;
  /** `fresh` become new items; `merges` top up items already in the larder. */
  onSubmit: (fresh: ReviewDraft[], merges: MergePlan[]) => void;
  /** Show a price box on each line (receipts and orders, or when any line already has a price). */
  showPrices?: boolean;
  /** Lines still being looked up (barcode). */
  pendingKeys?: Set<string>;
  /** Show a remove button on each line (manual and barcode lists). */
  allowRemove?: boolean;
  submitting?: boolean;
  /** When every line matched cleanly, lead with a one-glance summary instead of the full list. */
  summarise?: boolean;
}) {
  const locations = useLarder((s) => s.locations);
  const items = useLarder((s) => s.items);
  const overrides = useLarder((s) => s.overrides);
  const useSoonDays = useLarder((s) => s.settings.useSoonDays);
  const rememberBarcode = useLarder((s) => s.rememberBarcode);
  const now = useNow();
  const [picking, setPicking] = useState<ReviewDraft | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);

  // An unopened, still-fresh item of the same food in the same spot, per line (first line wins each item).
  const targets = useMemo(() => {
    const map = new Map<string, PantryItem>();
    const taken = new Set<string>();
    const ctx = { locations, overrides, useSoonDays, now: now ? new Date(now) : undefined };
    for (const d of drafts) {
      if (!d.isFood) continue;
      const t = findMergeTarget(d, items.filter((i) => !taken.has(i.id)), ctx);
      if (t) {
        map.set(d.key, t);
        taken.add(t.id);
      }
    }
    return map;
  }, [drafts, items, locations, overrides, useSoonDays, now]);

  const patch = (key: string, p: Patch) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...p } : d)));
  const replace = (key: string, next: ReviewDraft) => setDrafts((ds) => ds.map((d) => (d.key === key ? next : d)));
  const remove = (key: string) => setDrafts((ds) => ds.filter((d) => d.key !== key));
  const toggle = (key: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const food = drafts.filter((d) => d.isFood);
  const notFood = drafts.filter((d) => !d.isFood);
  const included = drafts.filter((d) => d.include && d.quantity > 0 && !pendingKeys?.has(d.key));
  const knownIds = new Set(locations.map((l) => l.id));
  const flagged = food.filter((d) => flagFor(d, !!pendingKeys?.has(d.key)));
  const settled = food.filter((d) => !flagFor(d, !!pendingKeys?.has(d.key)));

  // Group the settled lines by location, in the household's order; unknown ids fall into the first group.
  const groups = locations
    .map((loc, i) => ({
      loc,
      items: settled.filter((d) => d.locationId === loc.id || (i === 0 && !knownIds.has(d.locationId))),
    }))
    .filter((g) => g.items.length > 0);

  const total = included.reduce((sum, d) => sum + (d.price ?? 0), 0);
  const itemCount = (ds: ReviewDraft[]) => ds.reduce((n, d) => n + (d.packs && d.packs > 1 ? d.packs : 1), 0);
  const addCount = itemCount(included);
  const includedFood = included.filter((d) => d.isFood).length;
  const allFoodIncluded = food.length > 0 && food.every((d) => d.include);
  const allClear = !!summarise && flagged.length === 0 && food.length >= 3;
  const collapsed = allClear && !showAll;

  function submit() {
    const fresh: ReviewDraft[] = [];
    const merges: MergePlan[] = [];
    for (const d of included) {
      const t = targets.get(d.key);
      if (t && d.mergeIntoId === t.id) {
        const amount = d.quantity * (d.packs && d.packs > 1 ? d.packs : 1);
        merges.push({ itemId: t.id, quantity: convertQuantity(amount, d.unit, t.unit), price: d.price });
      } else fresh.push(d);
    }
    onSubmit(fresh, merges);
  }

  const estimate = (d: ReviewDraft): string | undefined => {
    if (!now || !d.isFood) return undefined;
    const loc = locations.find((l) => l.id === d.locationId) ?? locations[0];
    const at = new Date(now).toISOString();
    const item: PantryItem = {
      id: d.key,
      name: d.name,
      foodTypeId: d.foodTypeId,
      emoji: d.emoji,
      locationId: d.locationId,
      quantity: d.quantity,
      initialQuantity: d.quantity,
      unit: d.unit,
      addedAt: at,
      printedDate: d.printedDate,
      dateKind: d.dateKind,
      frozenAt: loc?.kind === "freezer" ? at : undefined,
      source: "manual",
    };
    const food = getFoodType(d.foodTypeId);
    const override = d.foodTypeId ? (overrides as Record<string, ShelfLifeOverride>)[d.foodTypeId] : undefined;
    const info = computeExpiry(item, {
      food,
      override,
      location: loc,
      useSoonDays: soonDaysFor(item, { food, override, location: loc, useSoonDays }),
      now: new Date(now),
    });
    const text = describeDaysLeft(info, d.dateKind).replace(/ left$/, "");
    return text.charAt(0).toUpperCase() + text.slice(1);
  };

  const rowProps = {
    locations,
    pendingKeys,
    allowRemove,
    showPrices,
    targets,
    expanded,
    estimate,
    onToggle: toggle,
    onPatch: patch,
    onRemove: remove,
    onChangeFood: (d: ReviewDraft) => setPicking(d),
    onApplySuggestion: (d: ReviewDraft) => d.suggestion && replace(d.key, applyFoodType(d, d.suggestion.foodTypeId)),
  };

  // "11 fridge, 4 pantry" for the summary.
  const spread = locations
    .map((l) => ({ l, n: food.filter((d) => d.include && d.locationId === l.id).length }))
    .filter((x) => x.n > 0)
    .map((x) => `${x.n} ${x.l.name.toLowerCase()}`)
    .join(", ");

  return (
    <div>
      {allClear && (
        <div className="mx-5 mb-5 rounded-[var(--radius-card)] bg-fresh-soft px-5 py-4 lg:mx-0">
          <p className="font-display text-xl text-ink">
            {food.length} foods, all matched
          </p>
          {spread && <p className="mt-0.5 text-[15px] text-ink-2">{spread}</p>}
          <button
            type="button"
            aria-expanded={showAll}
            onClick={() => setShowAll((v) => !v)}
            className="-ml-2 mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-[15px] font-semibold text-primary hover:bg-surface"
          >
            <ChevronDown size={18} aria-hidden className={cx("transition-transform", showAll && "rotate-180")} />
            {showAll ? "Hide the list" : "Check each one"}
          </button>
        </div>
      )}

      {!collapsed && food.length > 1 && (
        <div className="mb-2 flex items-center justify-between gap-3 px-5 lg:px-0">
          <p className="text-sm text-ink-2">
            {includedFood} of {food.length} ticked{total > 0 && <> · ${total.toFixed(2)}</>}
          </p>
          <button
            type="button"
            onClick={() => setDrafts((ds) => ds.map((d) => (d.isFood ? { ...d, include: !allFoodIncluded } : d)))}
            className="min-h-11 rounded-full px-3 text-sm font-semibold text-primary hover:bg-surface-2"
          >
            {allFoodIncluded ? "Untick all" : "Tick all"}
          </button>
        </div>
      )}

      {!collapsed && (
        <div className="flex flex-col gap-6">
          {flagged.length > 0 && (
            <section aria-labelledby="grp-check">
              <h3 id="grp-check" className="mb-2 flex items-baseline gap-2 px-5 font-display text-lg text-ink lg:px-0">
                <CircleHelp size={18} aria-hidden className="self-center text-soon" />
                Check {flagged.length === 1 ? "this one" : "these"}
                <span aria-hidden className="font-sans text-sm text-ink-3">
                  {flagged.length}
                </span>
                <span className="sr-only">
                  , {flagged.length} {flagged.length === 1 ? "item" : "items"}
                </span>
              </h3>
              <ul className="divide-y divide-line border-y border-line bg-surface lg:rounded-[var(--radius-card)] lg:border">
                {flagged.map((d) => (
                  <ReviewRow key={d.key} draft={d} {...rowProps} showSpot />
                ))}
              </ul>
            </section>
          )}

          {groups.map(({ loc, items }) => (
            <section key={loc.id} aria-labelledby={`grp-${loc.id}`}>
              <h3 id={`grp-${loc.id}`} className="mb-2 flex items-baseline gap-2 px-5 font-display text-lg text-ink lg:px-0">
                <span aria-hidden>{loc.emoji}</span>
                {loc.name}
                <span aria-hidden className="font-sans text-sm text-ink-3">
                  {items.length}
                </span>
                <span className="sr-only">
                  , {items.length} {items.length === 1 ? "item" : "items"}
                </span>
              </h3>
              <ul className="divide-y divide-line border-y border-line bg-surface lg:rounded-[var(--radius-card)] lg:border">
                {items.map((d) => (
                  <ReviewRow key={d.key} draft={d} {...rowProps} />
                ))}
              </ul>
            </section>
          ))}

          {notFood.length > 0 && (
            <details className="group">
              <summary className="mx-5 flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl text-[15px] font-medium text-ink-2 hover:text-ink lg:mx-0 [&::-webkit-details-marker]:hidden">
                <ChevronDown size={18} aria-hidden className="transition-transform group-open:rotate-180" />
                Not food
                <span className="text-sm text-ink-3">
                  {notFood.length} {notFood.length === 1 ? "line" : "lines"} left out
                </span>
              </summary>
              <p className="mb-2 px-5 text-sm text-ink-3 lg:px-0">
                Bags, cleaning products, discounts and totals. Tick one if it’s actually food.
              </p>
              <ul className="divide-y divide-line border-y border-line bg-surface lg:rounded-[var(--radius-card)] lg:border">
                {notFood.map((d) => (
                  <ReviewRow key={d.key} draft={d} {...rowProps} compact />
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Solid footer that sits just above the tab bar (and clears the raised Add button). */}
      <div data-toast-avoid className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 mt-6 border-t border-line bg-paper px-5 pb-8 pt-3 lg:bottom-0 lg:-mx-2 lg:px-2 lg:pb-6">
        <Button size="lg" block disabled={included.length === 0 || submitting} onClick={submit}>
          {included.length === 0 ? "Tick something to add" : `Add ${addCount} ${addCount === 1 ? "item" : "items"}`}
        </Button>
      </div>

      <FoodPicker
        open={!!picking}
        initialQuery={picking?.foodTypeId ? picking.name : picking?.name.startsWith("Barcode ") ? "" : (picking?.name ?? "")}
        rawText={picking?.rawText}
        onClose={() => setPicking(null)}
        onPick={(f) => {
          if (picking) {
            const next = applyFoodType(picking, f.id);
            replace(picking.key, next);
            if (picking.barcode) {
              rememberBarcode(picking.barcode, { foodTypeId: f.id, name: next.name, emoji: next.emoji, unit: next.unit, quantity: next.quantity });
            }
          }
          setPicking(null);
        }}
        onKeepText={(text) => {
          if (picking) {
            const name = text.charAt(0).toUpperCase() + text.slice(1);
            patch(picking.key, {
              name,
              foodTypeId: null,
              emoji: "🛒",
              confidence: "high",
              isFood: true,
              include: true,
              suggestion: undefined,
              mergeIntoId: undefined,
            });
            if (picking.barcode) {
              rememberBarcode(picking.barcode, { foodTypeId: null, name, emoji: "🛒", unit: picking.unit, quantity: picking.quantity });
            }
          }
          setPicking(null);
        }}
      />
    </div>
  );
}

function ReviewRow({
  draft: d,
  locations,
  pendingKeys,
  allowRemove,
  showPrices,
  targets,
  compact,
  showSpot,
  expanded,
  estimate,
  onToggle,
  onPatch,
  onRemove,
  onChangeFood,
  onApplySuggestion,
}: {
  draft: ReviewDraft;
  locations: StorageLocation[];
  pendingKeys?: Set<string>;
  allowRemove?: boolean;
  showPrices?: boolean;
  targets: Map<string, PantryItem>;
  compact?: boolean;
  /** Say which spot it's going to (rows outside a location group). */
  showSpot?: boolean;
  expanded: Set<string>;
  estimate: (d: ReviewDraft) => string | undefined;
  onToggle: (key: string) => void;
  onPatch: (key: string, p: Patch) => void;
  onRemove: (key: string) => void;
  onChangeFood: (d: ReviewDraft) => void;
  onApplySuggestion: (d: ReviewDraft) => void;
}) {
  const pending = !!pendingKeys?.has(d.key);
  const open = expanded.has(d.key) && !compact && !pending;
  const flag = flagFor(d, pending);
  const nameId = `name-${d.key}`;
  const panelId = `edit-${d.key}`;
  const target = !pending && d.include ? targets.get(d.key) : undefined;
  const merging = !!target && d.mergeIntoId === target.id;
  const loc = locations.find((l) => l.id === d.locationId);
  const freezer = locations.find((l) => l.kind === "freezer");
  const offerFreeze = !compact && !pending && d.isFood && !!freezer && loc?.kind !== "freezer" && freezable(d);
  const est = !compact && !pending ? estimate(d) : undefined;
  const dateCheck = d.dateConfirmed ? "ok" : checkPrintedDate(d.printedDate);
  const summary = [est, showSpot || compact ? loc?.name : undefined, amountOf(d)].filter(Boolean).join(" · ");

  return (
    <li className="flex gap-3 px-4 py-2.5" aria-busy={pending}>
      <input
        type="checkbox"
        checked={d.include}
        disabled={pending}
        onChange={(e) => onPatch(d.key, { include: e.target.checked, ...(e.target.checked && dateCheck !== "ok" ? { dateConfirmed: true } : {}) })}
        aria-labelledby={nameId}
        className="mt-3.5 h-5 w-5 shrink-0 accent-[var(--primary)]"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1">
          <button
            type="button"
            disabled={pending || compact}
            onClick={() => onToggle(d.key)}
            aria-expanded={compact ? undefined : open}
            aria-controls={compact ? undefined : panelId}
            className={cx(
              "-ml-1 flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1 py-1 text-left transition-opacity hover:bg-surface-2 disabled:hover:bg-transparent",
              !d.include && "opacity-60",
            )}
          >
            <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xl">
              {pending ? <Loader2 size={18} className="animate-spin text-ink-3" /> : d.emoji}
            </span>
            <span className="min-w-0 flex-1">
              <span id={nameId} className="block break-words text-[15px] font-semibold text-ink [overflow-wrap:anywhere]">
                {d.name}
              </span>
              <span className="block break-words text-sm text-ink-2 [overflow-wrap:anywhere]">
                {pending ? d.rawText : summary}
              </span>
              {open && d.rawText && d.rawText.toLowerCase() !== d.name.toLowerCase() && (
                <span className="block break-words text-xs text-ink-3 [overflow-wrap:anywhere]">Read as {d.rawText}</span>
              )}
            </span>
            {!compact && !pending && (
              <ChevronDown size={18} aria-hidden className={cx("shrink-0 text-ink-3 transition-transform", open && "rotate-180")} />
            )}
            {!compact && !pending && <span className="sr-only">{open ? ". Hide details" : ". Edit"}</span>}
          </button>
          {allowRemove && (
            <IconButton label={`Remove ${d.name}`} onClick={() => onRemove(d.key)} className="-mr-2">
              <Trash2 size={18} />
            </IconButton>
          )}
        </div>

        {flag === "unknown" && d.suggestion && (
          <div className="mb-1 mt-0.5 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => onApplySuggestion(d)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-soon-soft px-3 text-sm font-semibold text-soon"
            >
              <CircleHelp size={14} aria-hidden strokeWidth={2.5} />
              Did you mean {d.suggestion.name}?
            </button>
            <button
              type="button"
              onClick={() => onChangeFood(d)}
              className="inline-flex min-h-9 items-center rounded-full px-2.5 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
            >
              Something else
            </button>
          </div>
        )}
        {flag === "unknown" && !d.suggestion && (
          <button
            type="button"
            onClick={() => onChangeFood(d)}
            className="mb-1 mt-0.5 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-soon-soft px-3 text-sm font-semibold text-soon"
          >
            <CircleHelp size={14} aria-hidden strokeWidth={2.5} />
            New to us. Tap to match a food
          </button>
        )}
        {flag === "unsure" && (
          <div className="mb-1 mt-0.5 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => onChangeFood(d)}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-soon-soft px-3 text-sm font-semibold text-soon"
            >
              <CircleHelp size={14} aria-hidden strokeWidth={2.5} />
              Best guess. Is this right?
            </button>
            <button
              type="button"
              onClick={() => onPatch(d.key, { confidence: "high", include: true })}
              aria-label={`Yes, it's ${d.name}`}
              className="inline-flex min-h-9 items-center rounded-full px-2.5 text-sm font-semibold text-primary hover:bg-surface-2"
            >
              Yes
            </button>
          </div>
        )}
        {dateCheck !== "ok" && d.printedDate && (
          <div role="status" className="mb-1 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl bg-soon-soft py-1.5 pl-3 pr-1.5 text-sm text-ink">
            <TriangleAlert size={15} aria-hidden className="shrink-0 text-soon" />
            <span className="min-w-0 flex-1">
              {formatDate(d.printedDate)} looks {dateCheck === "far-future" ? "a long way off" : "a long time ago"}. Check it?
            </span>
            <button
              type="button"
              onClick={() => onPatch(d.key, { dateConfirmed: true, include: true })}
              className="min-h-9 rounded-full px-3 text-sm font-semibold text-primary hover:bg-surface"
            >
              It’s right
            </button>
            {!open && (
              <button
                type="button"
                onClick={() => onToggle(d.key)}
                className="min-h-9 rounded-full px-3 text-sm font-semibold text-ink-2 hover:bg-surface"
              >
                Fix it
              </button>
            )}
          </div>
        )}

        {offerFreeze && !open && (
          <button
            type="button"
            onClick={() => onPatch(d.key, { locationId: freezer!.id })}
            className="mb-1 mt-0.5 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-line px-3 text-sm font-semibold text-ink-2 hover:text-ink"
            aria-label={`Freeze ${d.name} instead`}
          >
            <Snowflake size={14} aria-hidden />
            Freeze instead
          </button>
        )}

        {target && !compact && (
          <div className="mb-1 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl bg-surface-2 py-1.5 pl-3 pr-1.5 text-sm text-ink-2">
            <Layers size={15} aria-hidden className="shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1">
              {merging ? (
                <>
                  Topping up your {formatQuantity(target.quantity, target.unit)}:{" "}
                  <span className="font-semibold text-ink">
                    {formatQuantity(
                      target.quantity + convertQuantity(d.quantity * (d.packs && d.packs > 1 ? d.packs : 1), d.unit, target.unit),
                      target.unit,
                    )}{" "}
                    in all
                  </span>
                </>
              ) : (
                <>You already have {formatQuantity(target.quantity, target.unit)} unopened</>
              )}
            </span>
            <button
              type="button"
              aria-pressed={merging}
              onClick={() => onPatch(d.key, { mergeIntoId: merging ? undefined : target.id })}
              className="min-h-9 rounded-full px-3 text-sm font-semibold text-primary hover:bg-surface"
            >
              {merging ? "Add as new" : "Add to it"}
            </button>
          </div>
        )}

        {open && (
          <div id={panelId} className="mb-1.5 mt-1.5 flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => onChangeFood(d)}
                className="inline-flex h-10 items-center rounded-full border border-line px-3 text-sm font-medium text-ink-2 hover:text-ink"
              >
                Change food
              </button>
              {showPrices && <PriceInput value={d.price} onChange={(price) => onPatch(d.key, { price })} label={`Price for ${d.name}`} />}
            </div>
            <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1" role="group" aria-label={`Where ${d.name} goes`}>
              {locations.map((l) => (
                <Chip key={l.id} selected={d.locationId === l.id} onClick={() => onPatch(d.key, { locationId: l.id })} className="h-8 px-3">
                  {l.name}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {d.packs && d.packs > 1 ? <PacksInput draft={d} onPatch={onPatch} /> : null}
              <QuantityInput draft={d} onPatch={onPatch} />
              <DateField draft={d} onPatch={onPatch} />
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

function formatDate(iso: string): string {
  const d = parseLocalDate(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

/** Large gram and millilitre amounts show as kg / L (the stored unit stays the same). */
const FOLD: Partial<Record<Unit, Unit>> = { g: "kg", ml: "L" };

const round2 = (v: number) => Math.round(v * 100) / 100;

function QuantityInput({ draft: d, onPatch }: { draft: ReviewDraft; onPatch: (key: string, p: Patch) => void }) {
  // Decided when the row opens and when the unit is picked, not while typing, so the box doesn't jump.
  const [folded, setFolded] = useState(() => !!FOLD[d.unit] && d.quantity >= 1000);
  const fold = folded && !!FOLD[d.unit];
  const factor = fold ? 1000 : 1;
  const shownUnit = fold ? FOLD[d.unit]! : d.unit;
  const shown = round2(d.quantity / factor);
  const step = STEP[shownUnit] ?? 1;
  // What's in the box while typing; committed on blur so clearing it doesn't snap to 0.
  const [text, setText] = useState<string | null>(null);
  const set = (v: number) => onPatch(d.key, { quantity: round2(v * factor) });
  const commit = () => {
    if (text === null) return;
    const v = Number(text.replace(",", "."));
    if (text.trim() !== "" && Number.isFinite(v) && v > 0) set(v);
    setText(null);
  };
  const unitLabel = (u: (typeof UNITS)[number]) => (shown === 1 ? u.one : u.many);
  return (
    <div className="inline-flex h-10 items-center rounded-full border border-line bg-surface" role="group" aria-label={`Amount of ${d.name}`}>
      <button
        type="button"
        aria-label={`Less ${d.name}`}
        disabled={shown <= step}
        onClick={() => set(Math.max(step, round2(shown - step)))}
        className="flex h-10 w-10 items-center justify-center rounded-full text-lg text-ink-2 hover:bg-surface-2 disabled:opacity-40"
      >
        −
      </button>
      <input
        type="text"
        inputMode="decimal"
        enterKeyHint="done"
        value={text ?? String(shown)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setText(e.target.value.replace(/[^\d.,]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        aria-label={`Quantity of ${d.name}`}
        className="h-10 w-12 bg-transparent text-center text-sm font-semibold tabular-nums text-ink focus:outline-none"
      />
      <select
        value={shownUnit}
        onChange={(e) => {
          const u = e.target.value as Unit;
          // Picking kg for a gram amount (or L for ml) just changes how it's shown.
          if (FOLD[d.unit] === u || u === d.unit) {
            setFolded(u !== d.unit);
            return;
          }
          setFolded(false);
          onPatch(d.key, { unit: u, quantity: fold ? shown : d.quantity });
        }}
        aria-label={`Unit for ${d.name}`}
        className="h-10 max-w-[5rem] appearance-none bg-transparent px-1 text-sm font-medium text-ink-2 underline decoration-line decoration-dotted underline-offset-4 focus:outline-none"
      >
        {UNITS.map((u) => (
          <option key={u.value} value={u.value}>
            {unitLabel(u)}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label={`More ${d.name}`}
        onClick={() => set(round2(shown + step))}
        className="flex h-10 w-10 items-center justify-center rounded-full text-lg text-ink-2 hover:bg-surface-2"
      >
        +
      </button>
    </div>
  );
}

/** How many separate packs of the amount ("2 × 2 L"); each becomes its own item. */
function PacksInput({ draft: d, onPatch }: { draft: ReviewDraft; onPatch: (key: string, p: Patch) => void }) {
  const packs = d.packs ?? 1;
  return (
    <div className="inline-flex h-10 items-center rounded-full border border-line bg-surface" role="group" aria-label={`Packs of ${d.name}`}>
      <button
        type="button"
        aria-label={`Fewer packs of ${d.name}`}
        onClick={() => onPatch(d.key, { packs: Math.max(1, packs - 1) })}
        className="flex h-10 w-10 items-center justify-center rounded-full text-lg text-ink-2 hover:bg-surface-2"
      >
        −
      </button>
      <span className="min-w-14 text-center text-sm font-semibold tabular-nums text-ink" aria-live="polite">
        {packs} {packs === 1 ? "pack" : "packs"}
      </span>
      <button
        type="button"
        aria-label={`More packs of ${d.name}`}
        onClick={() => onPatch(d.key, { packs: Math.min(24, packs + 1) })}
        className="flex h-10 w-10 items-center justify-center rounded-full text-lg text-ink-2 hover:bg-surface-2"
      >
        +
      </button>
      <span aria-hidden className="pr-3 text-sm text-ink-3">
        of
      </span>
    </div>
  );
}

function DateField({ draft: d, onPatch }: { draft: ReviewDraft; onPatch: (key: string, p: Patch) => void }) {
  const [show, setShow] = useState(!!d.printedDate);
  if (!show) {
    return (
      <button
        type="button"
        onClick={() => setShow(true)}
        aria-label={`Add printed date for ${d.name}`}
        className="inline-flex h-10 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
      >
        <CalendarPlus size={16} aria-hidden />
        Date
      </button>
    );
  }
  const kinds: { value: DateKind; label: string }[] = [
    { value: "use-by", label: "Use by" },
    { value: "best-before", label: "Best before" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={d.dateKind}
        onChange={(e) => onPatch(d.key, { dateKind: e.target.value as DateKind })}
        aria-label={`Date type for ${d.name}`}
        className="h-10 rounded-full border border-line bg-surface px-3 text-sm font-medium text-ink-2 focus:border-primary focus:outline-none"
      >
        {kinds.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </select>
      <input
        type="date"
        value={d.printedDate ?? ""}
        onChange={(e) => {
          const printedDate = e.target.value || undefined;
          // A date that looks far off waits for a "It's right" (or a tick) before it's added.
          const off = checkPrintedDate(printedDate) !== "ok";
          onPatch(d.key, { printedDate, dateConfirmed: false, ...(off ? { include: false } : {}) });
        }}
        aria-label={`Printed date for ${d.name}`}
        className="h-10 rounded-full border border-line bg-surface px-3 text-sm text-ink focus:border-primary focus:outline-none"
      />
      <IconButton
        label={`Remove date for ${d.name}`}
        onClick={() => {
          onPatch(d.key, { printedDate: undefined, dateConfirmed: false });
          setShow(false);
        }}
        className="h-10 w-10"
      >
        <X size={16} />
      </IconButton>
    </div>
  );
}

function PriceInput({ value, onChange, label }: { value?: number; onChange: (v: number | undefined) => void; label: string }) {
  const [text, setText] = useState(value === undefined ? "" : value.toFixed(2));
  return (
    <label className="flex h-10 shrink-0 items-center rounded-full border border-line px-3 text-sm text-ink-2 focus-within:border-primary">
      <span aria-hidden className={cx(text ? "text-ink-2" : "text-ink-3")}>
        $
      </span>
      <span className="sr-only">{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        placeholder="–"
        onChange={(e) => setText(e.target.value.replace(/[^\d.]/g, ""))}
        onBlur={() => {
          const n = Number(text);
          if (!text || !Number.isFinite(n)) {
            setText("");
            onChange(undefined);
          } else {
            setText(n.toFixed(2));
            onChange(Math.round(n * 100) / 100);
          }
        }}
        className="w-14 bg-transparent text-right font-medium tabular-nums text-ink placeholder:text-ink-3 focus:outline-none"
      />
    </label>
  );
}
