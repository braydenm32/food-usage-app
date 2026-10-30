"use client";

import { useMemo, useState } from "react";
import { CalendarPlus, ChevronDown, CircleHelp, Layers, Loader2, Trash2, X } from "lucide-react";
import { Button, Chip, IconButton, cx } from "@/components/ui";
import { useLarder } from "@/lib/store";
import { applyFoodType, convertQuantity, findMergeTarget, type ReviewDraft } from "@/lib/drafts";
import { formatQuantity } from "@/components/pantry/format";
import type { DateKind, PantryItem, StorageLocation, Unit } from "@/lib/types";
import { FoodPicker } from "./food-picker";

/** Existing larder items that review lines are topping up, ready for `addItems(…, { merge })`. */
export interface MergePlan {
  itemId: string;
  /** Amount to add, in the existing item's unit. */
  quantity: number;
  price?: number;
}

const UNITS: { value: Unit; label: string }[] = [
  { value: "item", label: "items" },
  { value: "g", label: "g" },
  { value: "kg", label: "kg" },
  { value: "ml", label: "ml" },
  { value: "L", label: "L" },
  { value: "pack", label: "packs" },
  { value: "bunch", label: "bunches" },
  { value: "dozen", label: "dozen" },
  { value: "loaf", label: "loaves" },
  { value: "tin", label: "tins" },
  { value: "jar", label: "jars" },
  { value: "bottle", label: "bottles" },
];

const STEP: Partial<Record<Unit, number>> = { g: 50, ml: 50, kg: 0.25, L: 0.25 };

type Patch = Partial<ReviewDraft>;

export function ReviewList({
  drafts,
  setDrafts,
  onSubmit,
  pendingKeys,
  allowRemove,
  submitting,
  showPrices,
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
}) {
  const locations = useLarder((s) => s.locations);
  const items = useLarder((s) => s.items);
  const [picking, setPicking] = useState<ReviewDraft | null>(null);

  // An unopened item of the same food in the same spot, per line (first line wins each item).
  const targets = useMemo(() => {
    const map = new Map<string, PantryItem>();
    const taken = new Set<string>();
    for (const d of drafts) {
      if (!d.isFood) continue;
      const t = findMergeTarget(d, items.filter((i) => !taken.has(i.id)));
      if (t) {
        map.set(d.key, t);
        taken.add(t.id);
      }
    }
    return map;
  }, [drafts, items]);

  const patch = (key: string, p: Patch) => setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...p } : d)));
  const replace = (key: string, next: ReviewDraft) => setDrafts((ds) => ds.map((d) => (d.key === key ? next : d)));
  const remove = (key: string) => setDrafts((ds) => ds.filter((d) => d.key !== key));

  const food = drafts.filter((d) => d.isFood);
  const notFood = drafts.filter((d) => !d.isFood);
  const included = drafts.filter((d) => d.include && !pendingKeys?.has(d.key));
  const knownIds = new Set(locations.map((l) => l.id));

  // Group by location, in the household's location order; unknown ids fall into the first group.
  const groups = locations
    .map((loc, i) => ({
      loc,
      items: food.filter((d) => d.locationId === loc.id || (i === 0 && !knownIds.has(d.locationId))),
    }))
    .filter((g) => g.items.length > 0);

  const total = included.reduce((sum, d) => sum + (d.price ?? 0), 0);
  const includedFood = included.filter((d) => d.isFood).length;
  const allFoodIncluded = food.length > 0 && food.every((d) => d.include);

  function submit() {
    const fresh: ReviewDraft[] = [];
    const merges: MergePlan[] = [];
    for (const d of included) {
      const t = targets.get(d.key);
      if (t && d.mergeIntoId === t.id) {
        merges.push({ itemId: t.id, quantity: convertQuantity(d.quantity, d.unit, t.unit), price: d.price });
      } else fresh.push(d);
    }
    onSubmit(fresh, merges);
  }

  const rowProps = {
    locations,
    pendingKeys,
    allowRemove,
    showPrices,
    targets,
    onPatch: patch,
    onRemove: remove,
    onChangeFood: (d: ReviewDraft) => setPicking(d),
    onApplySuggestion: (d: ReviewDraft) => d.suggestion && replace(d.key, applyFoodType(d, d.suggestion.foodTypeId)),
  };

  return (
    <div>
      {food.length > 1 && (
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

      <div className="flex flex-col gap-6">
        {groups.map(({ loc, items }) => (
          <section key={loc.id} aria-labelledby={`grp-${loc.id}`}>
            <h3 id={`grp-${loc.id}`} className="mb-2 flex items-baseline gap-2 px-5 font-display text-lg text-ink lg:px-0">
              <span aria-hidden>{loc.emoji}</span>
              {loc.name}
              <span className="font-sans text-sm text-ink-3">{items.length}</span>
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

      {/* Solid footer that sits just above the tab bar (and clears the raised Add button). */}
      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 mt-6 border-t border-line bg-paper px-5 pb-8 pt-3 lg:bottom-0 lg:-mx-2 lg:px-2 lg:pb-6">
        <Button size="lg" block disabled={included.length === 0 || submitting} onClick={submit}>
          {included.length === 0
            ? "Tick something to add"
            : `Add ${included.length} ${included.length === 1 ? "item" : "items"}`}
        </Button>
      </div>

      <FoodPicker
        open={!!picking}
        initialQuery={picking?.foodTypeId ? picking.name : (picking?.name ?? "")}
        rawText={picking?.rawText}
        onClose={() => setPicking(null)}
        onPick={(f) => {
          if (picking) replace(picking.key, applyFoodType(picking, f.id));
          setPicking(null);
        }}
        onKeepText={(text) => {
          if (picking)
            patch(picking.key, {
              name: text.charAt(0).toUpperCase() + text.slice(1),
              foodTypeId: null,
              emoji: "🛒",
              confidence: "high",
              isFood: true,
              include: true,
              suggestion: undefined,
              mergeIntoId: undefined,
            });
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
  onPatch: (key: string, p: Patch) => void;
  onRemove: (key: string) => void;
  onChangeFood: (d: ReviewDraft) => void;
  onApplySuggestion: (d: ReviewDraft) => void;
}) {
  const pending = pendingKeys?.has(d.key);
  const [showDate, setShowDate] = useState(!!d.printedDate);
  const unknown = !pending && d.isFood && !d.foodTypeId;
  const unsure = !pending && d.isFood && !!d.foodTypeId && d.confidence !== "high" && d.confidence !== undefined;
  const nameId = `name-${d.key}`;
  const target = !pending && d.include ? targets.get(d.key) : undefined;
  const merging = !!target && d.mergeIntoId === target.id;

  return (
    <li className={cx("flex gap-3 px-4 py-3.5 transition-opacity", !d.include && "opacity-60")} aria-busy={pending}>
      <input
        type="checkbox"
        checked={d.include}
        disabled={pending}
        onChange={(e) => onPatch(d.key, { include: e.target.checked })}
        aria-labelledby={nameId}
        className="mt-3 h-5 w-5 shrink-0 accent-[var(--primary)]"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => onChangeFood(d)}
            className="-ml-1 flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1 text-left hover:bg-surface-2"
            aria-label={`${d.name}. Change food`}
          >
            <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xl">
              {pending ? <Loader2 size={18} className="animate-spin text-ink-3" /> : d.emoji}
            </span>
            <span className="min-w-0">
              <span id={nameId} className="block truncate text-[15px] font-semibold text-ink">
                {d.name}
              </span>
              {d.rawText && d.rawText.toLowerCase() !== d.name.toLowerCase() && (
                <span className="block truncate text-xs text-ink-3">{d.rawText}</span>
              )}
            </span>
          </button>
          {showPrices && (
            <PriceInput value={d.price} onChange={(price) => onPatch(d.key, { price })} label={`Price for ${d.name}`} />
          )}
          {allowRemove && (
            <IconButton label={`Remove ${d.name}`} onClick={() => onRemove(d.key)} className="-mr-2">
              <Trash2 size={18} />
            </IconButton>
          )}
        </div>

        {unknown && d.suggestion && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
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
        {unknown && !d.suggestion && (
          <button
            type="button"
            onClick={() => onChangeFood(d)}
            className="mt-1 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-soon-soft px-3 text-sm font-semibold text-soon"
          >
            <CircleHelp size={14} aria-hidden strokeWidth={2.5} />
            New to us. Tap to match a food
          </button>
        )}
        {unsure && (
          <button
            type="button"
            onClick={() => onChangeFood(d)}
            className="mt-1 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-soon-soft px-3 text-sm font-semibold text-soon"
          >
            <CircleHelp size={14} aria-hidden strokeWidth={2.5} />
            Best guess. Is this right?
          </button>
        )}

        {target && !compact && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl bg-surface-2 py-1.5 pl-3 pr-1.5 text-sm text-ink-2">
            <Layers size={15} aria-hidden className="shrink-0 text-ink-3" />
            <span className="min-w-0 flex-1">
              {merging ? (
                <>
                  Topping up your {formatQuantity(target.quantity, target.unit)}:{" "}
                  <span className="font-semibold text-ink">
                    {formatQuantity(target.quantity + convertQuantity(d.quantity, d.unit, target.unit), target.unit)} in all
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

        {!compact && !pending && (
          <div className="mt-2.5 flex flex-col gap-2.5">
            <div className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1" role="group" aria-label={`Where ${d.name} goes`}>
              {locations.map((l) => (
                <Chip
                  key={l.id}
                  selected={d.locationId === l.id}
                  onClick={() => onPatch(d.key, { locationId: l.id })}
                  className="h-8 px-3"
                >
                  {l.name}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <QuantityInput draft={d} onPatch={onPatch} />
              {showDate ? (
                <DateInput draft={d} onPatch={onPatch} onClear={() => { onPatch(d.key, { printedDate: undefined }); setShowDate(false); }} />
              ) : (
                <button
                  type="button"
                  onClick={() => setShowDate(true)}
                  aria-label={`Add printed date for ${d.name}`}
                  className="inline-flex h-10 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
                >
                  <CalendarPlus size={16} aria-hidden />
                  Date
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </li>
  );
}

/** Large gram and millilitre amounts show as kg / L (the stored unit stays the same). */
const FOLD: Partial<Record<Unit, Unit>> = { g: "kg", ml: "L" };

function QuantityInput({ draft: d, onPatch }: { draft: ReviewDraft; onPatch: (key: string, p: Patch) => void }) {
  const round = (v: number) => Math.round(v * 100) / 100;
  // Decided when the row appears and when the unit is picked, not while typing, so the box doesn't jump.
  const [folded, setFolded] = useState(() => !!FOLD[d.unit] && d.quantity >= 1000);
  const fold = folded && !!FOLD[d.unit];
  const factor = fold ? 1000 : 1;
  const shownUnit = fold ? FOLD[d.unit]! : d.unit;
  const shown = round(d.quantity / factor);
  const step = STEP[shownUnit] ?? 1;
  const set = (v: number) => onPatch(d.key, { quantity: round(v * factor) });
  return (
    <div className="inline-flex h-10 items-center rounded-full border border-line bg-surface" role="group" aria-label={`Amount of ${d.name}`}>
      <button
        type="button"
        aria-label="Less"
        onClick={() => set(Math.max(step, round(shown - step)))}
        className="flex h-10 w-10 items-center justify-center rounded-full text-lg text-ink-2 hover:bg-surface-2"
      >
        −
      </button>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={shown}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= 0) set(v);
        }}
        aria-label="Quantity"
        className="h-10 w-11 bg-transparent text-center text-sm font-semibold tabular-nums text-ink [appearance:textfield] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
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
        aria-label="Unit"
        className="h-10 max-w-[4.5rem] appearance-none bg-transparent px-1 text-sm font-medium text-ink-2 underline decoration-line decoration-dotted underline-offset-4 focus:outline-none"
      >
        {UNITS.map((u) => (
          <option key={u.value} value={u.value}>
            {u.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label="More"
        onClick={() => set(round(shown + step))}
        className="flex h-10 w-10 items-center justify-center rounded-full text-lg text-ink-2 hover:bg-surface-2"
      >
        +
      </button>
    </div>
  );
}

function DateInput({
  draft: d,
  onPatch,
  onClear,
}: {
  draft: ReviewDraft;
  onPatch: (key: string, p: Patch) => void;
  onClear: () => void;
}) {
  const kinds: { value: DateKind; label: string }[] = [
    { value: "use-by", label: "Use by" },
    { value: "best-before", label: "Best before" },
  ];
  return (
    <div className="flex items-center gap-1.5">
      <select
        value={d.dateKind}
        onChange={(e) => onPatch(d.key, { dateKind: e.target.value as DateKind })}
        aria-label="Date type"
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
        onChange={(e) => onPatch(d.key, { printedDate: e.target.value || undefined })}
        aria-label={`Printed date for ${d.name}`}
        className="h-10 rounded-full border border-line bg-surface px-3 text-sm text-ink focus:border-primary focus:outline-none"
      />
      <IconButton label="Remove date" onClick={onClear} className="h-10 w-10">
        <X size={16} />
      </IconButton>
    </div>
  );
}

function PriceInput({ value, onChange, label }: { value?: number; onChange: (v: number | undefined) => void; label: string }) {
  const [text, setText] = useState(value === undefined ? "" : value.toFixed(2));
  return (
    <label className="flex h-11 shrink-0 items-center rounded-xl px-1.5 text-sm text-ink-2 focus-within:bg-surface-2">
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
        className="w-12 bg-transparent text-right font-medium tabular-nums text-ink placeholder:text-ink-3 focus:outline-none"
      />
    </label>
  );
}
