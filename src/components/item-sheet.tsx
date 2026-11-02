"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCheck, CircleAlert, Lightbulb, PackageOpen, Snowflake, Trash2, X } from "lucide-react";
import { useLarder } from "@/lib/store";
import { useIsStaple, useItemView, type ItemView } from "@/lib/selectors";
import { describeDaysLeft, freezerNotRecommended, isPastDateForFreezing, storageWarning } from "@/lib/shelf-life/engine";
import type { DateKind, PantryItem } from "@/lib/types";
import { Button, Chip, Input, Segmented, Sheet, Stepper, Switch, cx } from "@/components/ui";
import { StatusPill } from "@/components/freshness";
import { formatAUD, formatQuantity, formatShortDate, shareLeft, describeShareLeft } from "@/components/pantry/format";
import {
  canFreeze,
  capitalise,
  eatOne,
  freezeItem,
  markBinned,
  markOpened,
  markSomeUsed,
  markUsed,
  moveTo,
  oneLabel,
  primaryUse,
  removeItem,
} from "@/components/pantry/actions";
import { OverflowMenu, type MenuAction } from "@/components/pantry/overflow-menu";
import { LocationIcon } from "@/components/pantry/location-icon";
import { DateCheck, needsDateCheck, rememberDays, rememberOfferFor, type RememberOffer } from "@/components/pantry/date-check";
import { toast } from "@/components/toast";

/** "edit-date" focuses the date field. "still-good" is kept for older links: it now shows the quick date check. */
export type SheetIntent = "still-good" | "edit-date";

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
 * Show big gram and millilitre amounts folded ("1 kg", not "1000 g") in steppers: the stepper
 * works in kg or L and the store keeps the item's own unit.
 */
export function foldedUnit(unit: PantryItem["unit"], quantity: number): { factor: number; suffix?: string; step?: number } {
  if (unit === "g" && quantity >= 1000) return { factor: 1000, suffix: "kg", step: 0.1 };
  if (unit === "ml" && quantity >= 1000) return { factor: 1000, suffix: "L", step: 0.1 };
  return { factor: 1, suffix: unit === "item" ? undefined : unit };
}

/** A stepper for an amount in the item's unit, folded to kg or L when large. */
function AmountStepper({
  label,
  unit,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  unit: PantryItem["unit"];
  value: number;
  min: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  const f = foldedUnit(unit, Math.max(value, max ?? 0));
  const step = f.step ?? stepFor(unit, value);
  return (
    <Stepper
      label={label}
      value={round2(value / f.factor)}
      step={step}
      min={round2(Math.min(min, value) / f.factor)}
      suffix={f.suffix}
      onChange={(v) => {
        const q = f.factor === 1 ? v : Math.round(v * f.factor);
        onChange(max !== undefined ? Math.min(q, max) : q);
      }}
    />
  );
}

/**
 * Details and actions for one item. Pass `intent="edit-date"` to focus the date. Raw meat, fish
 * and leftovers near their estimate, and best-before food past its date, lead with a quick
 * "Is it still within date?" check.
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
      footer={
        view && (
          // On a landscape phone the sticky footer would eat the screen: it moves into the scroll area.
          <div className="[@media(max-height:500px)]:hidden">
            <Footer view={view} onClose={onClose} />
          </div>
        )
      }
    >
      {view && (
        <>
          <Body key={view.item.id} view={view} intent={intent} />
          <div className="mt-6 hidden border-t border-line pt-3 [@media(max-height:500px)]:block">
            <Footer view={view} onClose={onClose} compact />
          </div>
        </>
      )}
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
  const setStaple = useLarder((s) => s.setStaple);
  const staple = useIsStaple(item);

  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(item.price !== undefined ? item.price.toFixed(2) : "");
  const [offer, setOffer] = useState<RememberOffer | null>(null);
  // "Move some": countable items with more than one can be split between spots.
  const countable = ["item", "pack", "tin", "jar", "bottle", "loaf", "bunch"].includes(item.unit) && item.quantity >= 2 && Number.isInteger(item.quantity);
  const [moveCount, setMoveCount] = useState<number | null>(null);
  const moving = countable && moveCount !== null && moveCount < item.quantity ? moveCount : undefined;
  const relocate = (to: string) => {
    moveTo(item.id, to, notify, moving);
    setMoveCount(null);
  };
  const dateRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (intent === "edit-date") dateRef.current?.focus({ preventScroll: false });
  }, [intent]);

  const kind = location?.kind ?? "fridge";
  const frozen = kind === "freezer";
  const share = shareLeft(item.quantity, item.initialQuantity);
  const leftWords = describeShareLeft(item.quantity, item.initialQuantity);
  const check = needsDateCheck(view);

  const commitName = () => {
    const next = name.trim();
    if (!next) setName(item.name);
    else if (next !== item.name) updateItem(item.id, { name: next });
  };

  const commitPrice = () => {
    const raw = price.replace(/[$,\s]/g, "");
    if (raw === "") {
      if (item.price !== undefined) updateItem(item.id, { price: undefined });
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      setPrice(item.price !== undefined ? item.price.toFixed(2) : "");
      return;
    }
    const value = Math.round(n * 100) / 100;
    setPrice(value.toFixed(2));
    if (value !== item.price) updateItem(item.id, { price: value });
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
    const next = rememberOfferFor(view, value, overrides);
    updateItem(item.id, { printedDate: value });
    setOffer(next);
  };

  const remember = () => {
    if (!offer) return;
    rememberDays(offer);
    setOffer(null);
  };

  // Freezer dates are about quality, not safety.
  const dateLabel = frozen ? "Best quality by" : item.dateKind === "use-by" ? "Use by" : "Best before";

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
          <StatusPill status={expiry.status}>{frozen && expiry.status === "fresh" ? "Frozen" : undefined}</StatusPill>
          <p className="text-[17px] font-semibold text-ink">{capitalise(describeDaysLeft(expiry, item.dateKind))}</p>
          <p className="text-sm text-ink-2">
            {formatQuantity(item.quantity, item.unit)}
            {leftWords && `, ${leftWords}`}
            {location && ` · ${location.name}`}
            {frozen && item.frozenAt && ` · Frozen ${formatShortDate(new Date(item.frozenAt))}`}
            {item.openedAt && " · Opened"}
          </p>
        </div>
      </div>

      {check ? (
        <div className="rounded-2xl bg-surface-2 px-4 py-3">
          <DateCheck view={view} kind={check} />
        </div>
      ) : (
        item.dateKind === "best-before" &&
        expiry.status === "expired" &&
        !expiry.estimated && (
          <p className="rounded-2xl bg-surface-2 px-4 py-3 text-sm text-ink-2">
            Best before is about quality, not safety. If it looks, smells and tastes fine it&apos;s usually good to eat, so
            check before you bin it.
          </p>
        )
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
            {frozen
              ? "Frozen food stays safe; this date is about taste and texture."
              : item.dateKind === "use-by"
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
        <div className="flex items-center justify-between gap-3">
          <h3 id="sheet-where" className="text-sm font-medium text-ink-2">
            Stored in
          </h3>
          {canFreeze(view) && !moving && (
            <Button size="sm" variant="ghost" className="-mr-2" onClick={() => freezeItem(item.id, notify)}>
              <Snowflake size={16} aria-hidden />
              Freeze it
            </Button>
          )}
        </div>
        {locations.length <= 4 ? (
          <Segmented
            label="Stored in"
            value={item.locationId}
            onChange={relocate}
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
              <Chip key={l.id} selected={l.id === item.locationId} onClick={() => relocate(l.id)}>
                <LocationIcon kind={l.kind} />
                {l.name}
              </Chip>
            ))}
          </div>
        )}
        {countable &&
          (moveCount === null ? (
            <button type="button" onClick={() => setMoveCount(1)} className="self-start text-sm font-medium text-primary hover:underline min-h-11">
              Only moving some?
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
              <span>Move</span>
              <Stepper label="how many to move" value={moveCount} min={1} onChange={(v) => setMoveCount(Math.min(item.quantity, Math.max(1, Math.round(v))))} />
              <span>
                of {item.quantity}, then tap where they&apos;re going.
              </span>
              <button type="button" onClick={() => setMoveCount(null)} className="min-h-11 font-medium text-primary hover:underline">
                Move all
              </button>
            </div>
          ))}
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
          <AmountStepper label="Quantity" unit={item.unit} value={item.quantity} min={stepFor(item.unit, item.quantity)} onChange={setQuantity} />
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

      {/* Name and price */}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
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
        <section className="flex flex-col gap-2">
          <label htmlFor="sheet-price" className="text-sm font-medium text-ink-2">
            Price paid
          </label>
          <div className="relative">
            <span aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3">
              $
            </span>
            <Input
              id="sheet-price"
              inputMode="decimal"
              placeholder="0.00"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onBlur={commitPrice}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              aria-describedby="sheet-price-hint"
              autoComplete="off"
              className="pl-8"
            />
          </div>
          <p id="sheet-price-hint" className="text-xs text-ink-3">
            {item.price !== undefined && share !== undefined
              ? `About ${formatAUD(item.price * share)} worth left`
              : `For all ${formatQuantity(Math.max(item.initialQuantity, item.quantity), item.unit).replace(/^×/, "")}. Counts towards money saved and wasted.`}
          </p>
        </section>
      </div>

      <div className="-my-2 border-y border-line">
        <Switch
          checked={staple}
          onChange={(on) => {
            setStaple({ name: food?.name ?? item.name, foodTypeId: item.foodTypeId, emoji: item.emoji }, on);
            notify(on ? `We'll remind you to restock ${item.name}` : `${item.name} isn't a staple any more`, false);
          }}
          label="Always keep in stock"
          description="When it runs low, it's suggested for your shopping list."
        />
      </div>

      {food?.tip && (
        <p className="flex gap-3 rounded-2xl bg-surface-2 px-4 py-3 text-sm text-ink-2">
          <Lightbulb size={18} aria-hidden className="mt-0.5 shrink-0 text-soon" />
          <span>{food.tip}</span>
        </p>
      )}
    </div>
  );
}

function Footer({ view, onClose, compact }: { view: ItemView; onClose: () => void; compact?: boolean }) {
  const { item } = view;
  const [some, setSome] = useState(false);
  const half = round2(item.quantity / 2);
  const [amount, setAmount] = useState(half);
  const mode = primaryUse(item);

  const done = (fn: () => void) => {
    onClose();
    fn();
  };

  const useSome = () => {
    const q = Math.min(amount, item.quantity);
    if (q <= 0) return;
    if (q >= item.quantity) return done(() => markUsed(item.id));
    markSomeUsed(item.id, q, notify);
    setSome(false);
  };

  const toggleSome = () => {
    setAmount(mode === "one" ? 1 : half);
    setSome((s) => !s);
  };

  const more: MenuAction[] = [];
  if (mode === "one") more.push({ label: "Used some…", onSelect: toggleSome });
  more.push({ label: "Delete entry", Icon: Trash2, danger: true, onSelect: () => done(() => removeItem(item.id)) });

  const btn = compact ? "h-10" : undefined;
  return (
    <div className="flex flex-col gap-3">
      {some && (
        <div className="flex flex-col gap-3 rounded-2xl bg-surface-2 p-3">
          <p className="text-sm font-medium text-ink">How much did you use?</p>
          <div className="flex flex-wrap items-center gap-2">
            {mode !== "one" &&
              [0.25, 0.5, 0.75].map((f) => {
                const q = round2(item.quantity * f);
                return (
                  <Chip key={f} selected={amount === q} onClick={() => setAmount(q)}>
                    {f === 0.25 ? "A quarter" : f === 0.5 ? "Half" : "Most"}
                  </Chip>
                );
              })}
            <AmountStepper
              label="Amount used"
              unit={item.unit}
              value={amount}
              min={mode === "one" ? 1 : stepFor(item.unit, item.quantity)}
              max={item.quantity}
              onChange={setAmount}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={useSome}>
              Mark {formatQuantity(Math.min(amount, item.quantity), item.unit).replace(/^×/, "")} used
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSome(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {mode === "one" ? (
          <>
            <Button className={cx("basis-full whitespace-nowrap sm:basis-auto sm:flex-[1.3]", btn, compact && "basis-auto flex-[1.3]")} onClick={() => eatOne(item.id)}>
              {oneLabel(item)}
            </Button>
            <Button variant="secondary" className={cx("flex-1 whitespace-nowrap", btn)} onClick={() => done(() => markUsed(item.id))}>
              <CheckCheck size={18} aria-hidden />
              Used it all
            </Button>
          </>
        ) : (
          <>
            <Button className={cx("basis-full whitespace-nowrap sm:basis-auto sm:flex-[1.3]", btn, compact && "basis-auto flex-[1.3]")} onClick={() => done(() => markUsed(item.id))}>
              <CheckCheck size={18} aria-hidden />
              Used it all
            </Button>
            {mode === "amount" && (
              <Button variant="secondary" className={cx("flex-1 whitespace-nowrap", btn, some && "border-primary")} aria-expanded={some} onClick={toggleSome}>
                Used some…
              </Button>
            )}
          </>
        )}
        <Button variant="secondary" className={cx("flex-1 whitespace-nowrap", btn)} onClick={() => done(() => markBinned(item.id))}>
          Bin it
        </Button>
        <OverflowMenu label={`More for ${item.name}`} placement="up" actions={more} />
      </div>
    </div>
  );
}
