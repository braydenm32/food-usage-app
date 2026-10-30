"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, Lightbulb, PackageOpen, Snowflake, Trash2, X } from "lucide-react";
import { useLarder } from "@/lib/store";
import { useItemView, type ItemView } from "@/lib/selectors";
import {
  daysBetween,
  describeDaysLeft,
  effectiveDays,
  freezerNotRecommended,
  isPastDateForFreezing,
  parseLocalDate,
  storageWarning,
} from "@/lib/shelf-life/engine";
import type { DateKind, ShelfLifeOverride } from "@/lib/types";
import { Button, Chip, Input, Segmented, Sheet, Stepper, cx } from "@/components/ui";
import { StatusPill } from "@/components/freshness";
import {
  formatAUD,
  formatAmount,
  formatQuantity,
  formatShortDate,
  shareLeft,
  describeShareLeft,
} from "@/components/pantry/format";
import { capitalise, markBinned, markOpened, markUsed, moveTo, removeItem } from "@/components/pantry/actions";
import { OverflowMenu } from "@/components/pantry/overflow-menu";
import { LocationIcon } from "@/components/pantry/location-icon";
import { toast } from "@/components/toast";

type DaysColumn = "pantryDays" | "fridgeDays";
export type SheetIntent = "still-good" | "edit-date";

interface RememberOffer {
  column: DaysColumn;
  days: number;
  foodTypeId: string;
  /** "baby spinach in the fridge" / "milk once opened" */
  phrase: string;
}

const PARTS = [
  { f: 0.25, label: "¼ left" },
  { f: 0.5, label: "½ left" },
  { f: 0.75, label: "¾ left" },
];

function stepFor(unit: string, quantity: number) {
  if (unit === "g" || unit === "ml") return quantity >= 200 ? 50 : 10;
  if (unit === "kg" || unit === "L") return 0.25;
  return 1;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Details and actions for one item. Pass `intent="still-good"` to lead with setting a new
 * date (used by "Still good" on the Today screen), or `"edit-date"` to just focus the date.
 */
export function ItemSheet({
  itemId,
  open,
  onClose,
  intent,
}: {
  itemId: string | null;
  open: boolean;
  onClose: () => void;
  intent?: SheetIntent;
}) {
  const view = useItemView(itemId ?? "");
  const isOpen = open && !!view;

  // The item can disappear while the sheet is open (Undo, used elsewhere): close cleanly.
  useEffect(() => {
    if (open && itemId && !view) onClose();
  }, [open, itemId, view, onClose]);

  return (
    <Sheet
      open={isOpen}
      onClose={onClose}
      title={view?.item.name ?? ""}
      footer={view && <Footer view={view} onClose={onClose} />}
    >
      {view && <Body key={view.item.id} view={view} intent={intent} />}
    </Sheet>
  );
}

/** Feedback inside the sheet: toasts render above the open dialog, with Undo where it applies. */
const notify = (message: string, undoable = true) => toast(message, { undoable });

function Body({ view, intent }: { view: ItemView; intent?: SheetIntent }) {
  const { item, food, location, expiry } = view;
  const locations = useLarder((s) => s.locations);
  const overrides = useLarder((s) => s.overrides);
  const updateItem = useLarder((s) => s.updateItem);
  const consumeItem = useLarder((s) => s.consumeItem);
  const setOverride = useLarder((s) => s.setOverride);

  const [name, setName] = useState(item.name);
  const [offer, setOffer] = useState<RememberOffer | null>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (intent) dateRef.current?.focus({ preventScroll: false });
  }, [intent]);

  const kind = location?.kind ?? "fridge";
  const frozen = kind === "freezer";
  const step = stepFor(item.unit, item.quantity);
  const share = shareLeft(item.quantity, item.initialQuantity);
  const leftWords = describeShareLeft(item.quantity, item.initialQuantity);

  const commitName = () => {
    const next = name.trim();
    if (!next) setName(item.name);
    else if (next !== item.name) updateItem(item.id, { name: next });
  };

  const setQuantity = (q: number) =>
    updateItem(item.id, { quantity: q, initialQuantity: Math.max(item.initialQuantity, q) });

  const setPart = (f: number) => {
    const target = round2(item.initialQuantity * f);
    if (target < item.quantity) {
      consumeItem(item.id, round2(item.quantity - target), "used");
      notify(`Noted: about ${PARTS.find((p) => p.f === f)?.label ?? "some left"}`);
    } else if (target > item.quantity) {
      updateItem(item.id, { quantity: target });
    }
  };

  const onDateChange = (value: string) => {
    if (!value) {
      updateItem(item.id, { printedDate: undefined });
      setOffer(null);
      return;
    }
    const wasEstimate = expiry.estimated;
    updateItem(item.id, { printedDate: value });
    // Only learn from a sealed item in the pantry or fridge: when it is frozen, thawed or
    // opened, that clock decides the date, not the one on the pack.
    if (!wasEstimate || !food || frozen || item.thawedAt || item.openedAt) return setOffer(null);

    const column = `${kind}Days` as DaysColumn;
    const phrase = `${food.name.toLowerCase()} in the ${kind}`;
    const days = daysBetween(new Date(item.addedAt), parseLocalDate(value));
    const current = effectiveDays(food, overrides[food.id], kind as "pantry" | "fridge");
    if (days < 1 || days === current) return setOffer(null);
    setOffer({ column, days, foodTypeId: food.id, phrase });
  };

  const remember = () => {
    if (!offer) return;
    setOverride({ foodTypeId: offer.foodTypeId, [offer.column]: offer.days } as ShelfLifeOverride);
    notify(`Got it. ${offer.days} days for ${offer.phrase} from now on.`, false);
    setOffer(null);
  };

  const dateLabel = item.dateKind === "use-by" ? "Use by" : "Best before";

  // Storage advice for where it is now, shown once (not repeated in the basis line).
  const spotWarning = item.expiredWhenFrozen ? undefined : storageWarning(food, kind);
  const basis = spotWarning
    ? expiry.basis.replace(spotWarning, "").replace(/^[.\s]+|[.\s]+$/g, "")
    : expiry.basis;
  const hasFreezer = locations.some((l) => l.kind === "freezer");
  // Before freezing: say when it won't help.
  const pastDate =
    !frozen && hasFreezer && isPastDateForFreezing(item, { food, override: food ? overrides[food.id] : undefined, location });
  const freezeHint = frozen || !hasFreezer
    ? undefined
    : pastDate
      ? "Already past its date, so freezing won't make it safe."
      : freezerNotRecommended(food)
        ? `${food?.name ?? "This"} doesn't freeze well — texture suffers.`
        : undefined;

  return (
    <div className="flex flex-col gap-6 pt-1">
      {/* Summary */}
      <div className="flex items-center gap-4">
        <span
          aria-hidden
          className="flex h-[4.5rem] w-[4.5rem] shrink-0 items-center justify-center rounded-3xl bg-surface-2 text-[2.75rem] leading-none"
        >
          {item.emoji}
        </span>
        <div className="flex min-w-0 flex-col items-start gap-1.5">
          <StatusPill status={expiry.status} />
          <p className="text-[17px] font-semibold text-ink">{capitalise(describeDaysLeft(expiry, item.dateKind))}</p>
          <p className="text-sm text-ink-2">
            {formatQuantity(item.quantity, item.unit)}
            {leftWords && `, ${leftWords}`}
            {location && ` · ${location.name}`}
            {item.openedAt && " · Opened"}
          </p>
        </div>
      </div>

      {intent === "still-good" && (
        <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm text-ink-2">
          Still looks and smells fine? Set the date on the pack, or a new date you&apos;re comfortable with. Trust your
          senses with best-before food; use-by dates are about safety.
        </p>
      )}

      {/* Date */}
      <section aria-labelledby="sheet-date" className="rounded-[var(--radius-card)] border border-line p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h3 id="sheet-date" className="text-sm font-medium text-ink-2">
              {dateLabel}
            </h3>
            <p className="mt-0.5 flex items-baseline gap-2 font-display text-2xl text-ink">
              {formatShortDate(expiry.expiresOn)}
              {expiry.estimated && (
                <span className="rounded-full bg-surface-2 px-2 py-0.5 font-sans text-xs font-semibold text-ink-2">est.</span>
              )}
            </p>
            {basis && <p className="mt-1 text-sm text-ink-2">{basis}</p>}
          </div>
          {!item.openedAt && !frozen && (
            <Button variant="secondary" size="sm" onClick={() => markOpened(item.id, notify)} className="shrink-0">
              <PackageOpen size={16} aria-hidden />
              Mark as opened
            </Button>
          )}
        </div>

        <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
          <label htmlFor="sheet-printed" className="text-sm font-medium text-ink-2">
            Date on the pack
          </label>
          <div className="flex items-center gap-2">
            <Input
              ref={dateRef}
              id="sheet-printed"
              type="date"
              value={item.printedDate ?? ""}
              onChange={(e) => onDateChange(e.target.value)}
              className="min-w-0 flex-1"
            />
            {item.printedDate && (
              <button
                type="button"
                onClick={() => onDateChange("")}
                className="inline-flex h-11 shrink-0 items-center gap-1 rounded-full px-3 text-sm font-medium text-ink-2 hover:bg-surface-2"
              >
                <X size={16} aria-hidden />
                Clear
              </button>
            )}
          </div>
          <Segmented<DateKind>
            label="Kind of date"
            value={item.dateKind}
            onChange={(v) => updateItem(item.id, { dateKind: v })}
            options={[
              { value: "use-by", label: "Use by" },
              { value: "best-before", label: "Best before" },
            ]}
          />
          {(frozen || item.thawedAt) && item.printedDate && (
            <p className="text-xs text-ink-3">
              {frozen ? "While it's frozen, the freezer date applies." : "Once thawed, the thaw date applies."}
            </p>
          )}
          <p className="text-xs text-ink-3">
            {item.dateKind === "use-by"
              ? "Use-by is about safety: don't eat it after this date."
              : "Best-before is about quality: often fine after, so look and sniff."}
          </p>

          {offer && (
            <div role="status" className="flex flex-col gap-3 rounded-2xl bg-primary-soft px-4 py-3">
              <p className="text-sm text-ink">
                Remember <strong>{offer.days} days</strong> for {offer.phrase}? Future estimates will use it.
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={remember}>
                  Remember {offer.days} days
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOffer(null)}>
                  Just this once
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Location */}
      <section aria-labelledby="sheet-where" className="flex flex-col gap-2">
        <h3 id="sheet-where" className="text-sm font-medium text-ink-2">
          Stored in
        </h3>
        {locations.length <= 4 ? (
          <Segmented
            label="Stored in"
            value={item.locationId}
            onChange={(v) => moveTo(item.id, v, notify)}
            options={locations.map((l) => ({
              value: l.id,
              label: (
                <>
                  <LocationIcon kind={l.kind} />
                  {l.name}
                </>
              ),
            }))}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            {locations.map((l) => (
              <Chip key={l.id} selected={l.id === item.locationId} onClick={() => moveTo(item.id, l.id, notify)}>
                <LocationIcon kind={l.kind} />
                {l.name}
              </Chip>
            ))}
          </div>
        )}
        {item.expiredWhenFrozen ? (
          <div className="flex flex-col items-start gap-2 rounded-2xl bg-spoiled-soft px-4 py-3 text-sm text-ink">
            <p className="flex gap-2">
              <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0 text-spoiled" />
              <span>It was already past its date when it went in the freezer. Freezing won&apos;t make it safe.</span>
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="-ml-2"
              onClick={() => {
                updateItem(item.id, { expiredWhenFrozen: undefined });
                notify("Okay, counting from when it was frozen", false);
              }}
            >
              It was still in date
            </Button>
          </div>
        ) : spotWarning ? (
          <p className="flex gap-2 rounded-2xl bg-soon-soft px-4 py-3 text-sm text-ink">
            <CircleAlert size={18} aria-hidden className="mt-0.5 shrink-0 text-soon" />
            {spotWarning}
          </p>
        ) : freezeHint ? (
          <p className="flex gap-2 text-sm text-ink-2">
            {pastDate ? (
              <CircleAlert size={16} aria-hidden className="mt-0.5 shrink-0 text-spoiled" />
            ) : (
              <Snowflake size={16} aria-hidden className="mt-0.5 shrink-0 text-ink-3" />
            )}
            {freezeHint}
          </p>
        ) : null}
      </section>

      {/* Quantity */}
      <section aria-labelledby="sheet-qty" className="flex flex-col gap-2">
        <h3 id="sheet-qty" className="text-sm font-medium text-ink-2">
          How much is left
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <Stepper
            label="Quantity"
            value={item.quantity}
            step={step}
            min={Math.min(step, item.quantity)}
            onChange={setQuantity}
            suffix={item.unit === "item" ? undefined : item.unit}
          />
          <div className="flex gap-1.5">
            {PARTS.map((p) => (
              <Chip
                key={p.f}
                selected={share !== undefined && Math.abs(share - p.f) < 0.02}
                onClick={() => setPart(p.f)}
                aria-label={`About ${p.label}`}
              >
                {p.label}
              </Chip>
            ))}
          </div>
        </div>
      </section>

      {/* Name */}
      <section className="flex flex-col gap-2">
        <label htmlFor="sheet-name" className="text-sm font-medium text-ink-2">
          Name
        </label>
        <Input
          id="sheet-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          autoComplete="off"
        />
      </section>

      {(food?.tip || item.price !== undefined) && (
        <div className="flex flex-col gap-3">
          {food?.tip && (
            <p className="flex gap-3 rounded-2xl bg-surface-2 px-4 py-3 text-sm text-ink-2">
              <Lightbulb size={18} aria-hidden className="mt-0.5 shrink-0 text-soon" />
              <span>{food.tip}</span>
            </p>
          )}
          {item.price !== undefined && (
            <p className="text-sm text-ink-2">
              Paid {formatAUD(item.price)}
              {share !== undefined && ` · about ${formatAUD(item.price * share)} worth left`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Footer({ view, onClose }: { view: ItemView; onClose: () => void }) {
  const { item } = view;
  const consumeItem = useLarder((s) => s.consumeItem);
  const [some, setSome] = useState(false);
  const half = round2(item.quantity / 2);
  const [amount, setAmount] = useState(half);
  const step = stepFor(item.unit, item.quantity);

  const done = (fn: () => void) => {
    onClose();
    fn();
  };

  const useSome = () => {
    const q = Math.min(amount, item.quantity);
    if (q <= 0) return;
    if (q >= item.quantity) return done(() => markUsed(item.id));
    consumeItem(item.id, q, "used");
    notify(`Used ${formatQuantity(q, item.unit)} of ${item.name}`);
    setSome(false);
  };

  return (
    <div className="flex flex-col gap-3">
      {some && (
        <div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-3">
          <p className="text-sm font-medium text-ink">How much did you use?</p>
          <div className="flex flex-wrap items-center gap-2">
            {[0.25, 0.5, 0.75].map((f) => {
              const q = round2(item.quantity * f);
              return (
                <Chip key={f} selected={amount === q} onClick={() => setAmount(q)}>
                  {f === 0.25 ? "A quarter" : f === 0.5 ? "Half" : "Most"}
                </Chip>
              );
            })}
            <Stepper
              label="Amount used"
              value={amount}
              step={step}
              min={Math.min(step, item.quantity)}
              onChange={(v) => setAmount(Math.min(v, item.quantity))}
              suffix={item.unit === "item" ? undefined : item.unit}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={useSome}>
              Mark {item.unit === "item" ? formatAmount(Math.min(amount, item.quantity)) : formatQuantity(Math.min(amount, item.quantity), item.unit)} used
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSome(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button className="basis-full whitespace-nowrap sm:basis-auto sm:flex-[1.3]" onClick={() => done(() => markUsed(item.id))}>
          Used it all
        </Button>
        <Button
          variant="secondary"
          className={cx("flex-1 whitespace-nowrap", some && "border-primary")}
          aria-expanded={some}
          onClick={() => {
            setAmount(half);
            setSome((s) => !s);
          }}
        >
          Used some…
        </Button>
        <Button variant="secondary" className="flex-1 whitespace-nowrap" onClick={() => done(() => markBinned(item.id))}>
          Bin it
        </Button>
        <OverflowMenu
          label={`More for ${item.name}`}
          placement="up"
          actions={[
            {
              label: "Delete (added by mistake)",
              Icon: Trash2,
              danger: true,
              onSelect: () => done(() => removeItem(item.id)),
            },
          ]}
        />
      </div>
    </div>
  );
}
