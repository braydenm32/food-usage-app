"use client";

import { Check, Plus, Share2, Trash2, X } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useLarder } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";
import { useNow } from "@/lib/use-now";
import { defaultsForUnknown } from "@/lib/shelf-life/engine";
import { FOOD_TYPES, getFoodType, matchFoodType, searchFoodTypes } from "@/lib/shelf-life/foods";
import type { Aisle, DraftItem, FoodType, ShoppingListItem, Unit } from "@/lib/types";
import { Button, Card, EmptyState, IconButton, Input, PageHeader, SectionTitle, Sheet, Stepper, cx } from "@/components/ui";
import { toast } from "@/components/toast";

/** Walking order through a typical Australian supermarket. */
const AISLE_ORDER: Aisle[] = [
  "Fruit & Veg",
  "Bakery",
  "Deli",
  "Meat & Seafood",
  "Dairy, Eggs & Fridge",
  "Pantry",
  "Drinks",
  "Health & Beauty",
  "Household",
  "Freezer",
  "Other",
];

const UNITS: Unit[] = ["item", "g", "kg", "ml", "L", "pack", "bunch", "dozen", "loaf", "tin", "jar", "bottle"];
const isUnit = (u: string | undefined): u is Unit => !!u && (UNITS as string[]).includes(u);

const REASON_LABEL: Record<NonNullable<ShoppingListItem["reason"]>, string | null> = {
  manual: null,
  recipe: "for a recipe",
  staple: "staple",
  plan: "for this week's meals",
};

function groupByAisle(items: ShoppingListItem[]): Array<{ aisle: Aisle; items: ShoppingListItem[] }> {
  const groups = new Map<Aisle, ShoppingListItem[]>();
  for (const it of items) {
    const aisle = AISLE_ORDER.includes(it.aisle) ? it.aisle : "Other";
    groups.set(aisle, [...(groups.get(aisle) ?? []), it]);
  }
  return AISLE_ORDER.filter((a) => groups.has(a)).map((a) => ({
    aisle: a,
    items: groups.get(a)!.sort((x, y) => x.name.localeCompare(y.name)),
  }));
}

function quantityLabel(it: Pick<ShoppingListItem, "quantity" | "unit">): string | null {
  if (!it.quantity) return null;
  const unit = it.unit && it.unit !== "item" ? ` ${it.unit}` : "";
  return `${it.quantity}${unit}`;
}

/** "2 milk" → { quantity: 2, text: "milk" } */
function parseQuickAdd(raw: string): { quantity?: number; text: string } {
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(?:x\s*)?(.+)$/i);
  if (m) return { quantity: Number(m[1]), text: m[2].trim() };
  return { text: raw.trim() };
}

function listAsText(items: ShoppingListItem[]): string {
  const open = items.filter((l) => !l.checked);
  const lines: string[] = ["Shopping list"];
  for (const g of groupByAisle(open)) {
    lines.push("", g.aisle);
    for (const it of g.items) {
      const q = quantityLabel(it);
      lines.push(`- ${it.name}${q ? ` (${q})` : ""}`);
    }
  }
  return lines.join("\n");
}

export default function ListPage() {
  const hydrated = useHydrated();
  const list = useLarder((s) => s.shoppingList);
  const items = useLarder((s) => s.items);
  const events = useLarder((s) => s.events);
  const addToList = useLarder((s) => s.addToList);
  const toggleListItem = useLarder((s) => s.toggleListItem);
  const updateListItem = useLarder((s) => s.updateListItem);
  const removeListItem = useLarder((s) => s.removeListItem);
  const clearChecked = useLarder((s) => s.clearChecked);
  const addItems = useLarder((s) => s.addItems);

  const [editing, setEditing] = useState<ShoppingListItem | null>(null);
  const openedAt = useNow();

  const open = useMemo(() => list.filter((l) => !l.checked), [list]);
  const ticked = useMemo(() => list.filter((l) => l.checked), [list]);
  const groups = useMemo(() => groupByAisle(open), [open]);

  /* Suggestions: things we ran out of recently, then staples not in the larder. */
  const suggestions = useMemo(() => {
    const inLarder = new Set(items.map((i) => i.foodTypeId).filter(Boolean));
    const onList = new Set(open.map((l) => l.foodTypeId).filter(Boolean));
    const onListNames = new Set(open.map((l) => l.name.toLowerCase()));
    const out: Array<{ key: string; name: string; food?: FoodType; why: "ran-out" | "staple" }> = [];
    const seen = new Set<string>();

    const cutoff = openedAt - 21 * 86_400_000;
    const used = events
      .filter((e) => e.type === "used" && new Date(e.at).getTime() > cutoff)
      .sort((a, b) => b.at.localeCompare(a.at));
    for (const e of used) {
      const key = e.foodTypeId ?? e.itemName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (e.foodTypeId ? inLarder.has(e.foodTypeId) || onList.has(e.foodTypeId) : onListNames.has(key)) continue;
      if (!e.foodTypeId && items.some((i) => i.name.toLowerCase() === key)) continue;
      const food = getFoodType(e.foodTypeId);
      out.push({ key, name: food?.name ?? e.itemName, food, why: "ran-out" });
    }
    for (const f of FOOD_TYPES) {
      if (!f.staple || seen.has(f.id) || inLarder.has(f.id) || onList.has(f.id)) continue;
      seen.add(f.id);
      out.push({ key: f.id, name: f.name, food: f, why: "staple" });
    }
    return out.slice(0, 10);
  }, [items, events, open, openedAt]);

  const addFood = (food: FoodType, quantity?: number, name?: string) => {
    addToList([
      {
        name: name ?? food.name,
        foodTypeId: food.id,
        aisle: food.aisle,
        quantity: quantity ?? food.defaultQuantity,
        unit: food.defaultUnit,
        reason: "manual",
      },
    ]);
    toast(`Added ${name ?? food.name}`);
  };

  const addFreeText = (raw: string) => {
    const { quantity, text } = parseQuickAdd(raw);
    if (!text) return;
    const match = matchFoodType(text);
    if (match && match.confidence !== "low") {
      addFood(match.food, quantity);
      return;
    }
    const name = text.charAt(0).toUpperCase() + text.slice(1);
    addToList([{ name, foodTypeId: null, aisle: "Other", quantity, reason: "manual" }]);
    toast(`Added ${name}`);
  };

  const putInLarder = () => {
    if (ticked.length === 0) return;
    const drafts: DraftItem[] = ticked.map((l) => {
      const match = l.foodTypeId ? undefined : matchFoodType(l.name);
      const food = getFoodType(l.foodTypeId) ?? (match?.confidence === "high" ? match.food : undefined);
      const unknown = defaultsForUnknown(l.name);
      return {
        key: l.id,
        name: l.name,
        foodTypeId: food?.id ?? null,
        emoji: food?.emoji ?? "🛒",
        locationId: food?.defaultLocation ?? unknown.locationId,
        quantity: l.quantity ?? food?.defaultQuantity ?? 1,
        unit: isUnit(l.unit) ? l.unit : (food?.defaultUnit ?? "item"),
        dateKind: food?.dateKind ?? unknown.dateKind,
        include: true,
      };
    });
    // One undoable step: the items go in and the ticked rows come off the list.
    const created = addItems(drafts, "list", { removeListIds: ticked.map((l) => l.id) });
    toast(`Put ${created.length} item${created.length === 1 ? "" : "s"} in the larder`, { undoable: true });
  };

  const share = async () => {
    const text = listAsText(list);
    if (open.length === 0) {
      toast("Nothing on the list to share yet");
      return;
    }
    try {
      if (typeof navigator !== "undefined" && "share" in navigator && navigator.share) {
        await navigator.share({ title: "Shopping list", text });
        return;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast("List copied, ready to paste");
    } catch {
      toast("Couldn't copy the list. Try selecting it by hand.", { tone: "error" });
    }
  };

  const subtitle = !hydrated
    ? " "
    : open.length === 0
      ? ticked.length
        ? "Everything's in the trolley"
        : "Nothing to get yet"
      : `${open.length} thing${open.length === 1 ? "" : "s"} to get`;

  return (
    <div className="px-0 lg:pb-8">
      <PageHeader
        title="Shopping list"
        subtitle={subtitle}
        actions={
          <IconButton label="Share list" onClick={share} disabled={!hydrated || open.length === 0}>
            <Share2 size={20} />
          </IconButton>
        }
      />

      <div className="px-5 lg:px-0">
        <QuickAdd onAddFood={addFood} onAddText={addFreeText} />

        {hydrated && suggestions.length > 0 && (
          <section aria-labelledby="suggestions-heading" className="mt-5">
            <h2 id="suggestions-heading" className="mb-2 text-sm font-medium text-ink-2">
              Running low? One tap to add
            </h2>
            <div className="scrollbar-none -mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
              {suggestions.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() =>
                    s.food
                      ? addFood(s.food)
                      : (addToList([{ name: s.name, foodTypeId: null, aisle: "Other", reason: "manual" }]),
                        toast(`Added ${s.name}`))
                  }
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface pl-3 pr-3.5 text-sm font-medium text-ink transition-colors hover:border-primary hover:bg-primary-soft"
                >
                  <Plus size={15} aria-hidden className="text-primary" />
                  {s.food?.emoji && <span aria-hidden>{s.food.emoji}</span>}
                  {s.name}
                  {s.why === "ran-out" && <span className="text-xs text-ink-3">ran out</span>}
                </button>
              ))}
            </div>
          </section>
        )}

        {!hydrated ? (
          <div className="mt-8 space-y-3" aria-busy>
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-2xl bg-surface-2" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState
            emoji="🧺"
            title="Your list is empty"
            body="Add what you're running low on, pick ingredients from a recipe, or tap a suggestion above."
          />
        ) : (
          <>
            {groups.map((g) => (
              <section key={g.aisle} aria-labelledby={`aisle-${g.aisle}`}>
                <SectionTitle>
                  <span id={`aisle-${g.aisle}`}>{g.aisle}</span>
                </SectionTitle>
                <Card className="divide-y divide-line">
                  {g.items.map((it) => (
                    <ListRow
                      key={it.id}
                      item={it}
                      onToggle={() => toggleListItem(it.id)}
                      onEdit={() => setEditing(it)}
                      onRemove={() => {
                        removeListItem(it.id);
                        toast(`Removed ${it.name}`);
                      }}
                    />
                  ))}
                </Card>
              </section>
            ))}

            {ticked.length > 0 && (
              <section aria-labelledby="trolley-heading">
                <SectionTitle
                  action={
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        clearChecked();
                        toast(`Cleared ${ticked.length} ticked item${ticked.length === 1 ? "" : "s"}`, { undoable: true });
                      }}
                    >
                      Clear ticked
                    </Button>
                  }
                >
                  <span id="trolley-heading">In the trolley</span>
                </SectionTitle>
                <Card className="divide-y divide-line">
                  {ticked.map((it) => (
                    <ListRow
                      key={it.id}
                      item={it}
                      onToggle={() => toggleListItem(it.id)}
                      onEdit={() => setEditing(it)}
                      onRemove={() => {
                        removeListItem(it.id);
                        toast(`Removed ${it.name}`);
                      }}
                    />
                  ))}
                </Card>
                <div className="mt-4">
                  <Button block size="lg" onClick={putInLarder}>
                    Put {ticked.length} item{ticked.length === 1 ? "" : "s"} in the larder
                  </Button>
                  <p className="mt-2 text-center text-xs text-ink-3">
                    Each goes to its usual spot with an estimated date. You can adjust them in the larder.
                  </p>
                </div>
              </section>
            )}
          </>
        )}
      </div>

      <EditSheet
        key={editing?.id ?? "none"}
        item={editing}
        onClose={() => setEditing(null)}
        onSave={(patch) => {
          if (editing) updateListItem(editing.id, patch);
          setEditing(null);
        }}
        onRemove={() => {
          if (editing) {
            removeListItem(editing.id);
            toast(`Removed ${editing.name}`);
          }
          setEditing(null);
        }}
      />
    </div>
  );
}

/* ---------- Row ---------- */

function ListRow({
  item,
  onToggle,
  onEdit,
  onRemove,
}: {
  item: ShoppingListItem;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const food = getFoodType(item.foodTypeId);
  const q = quantityLabel(item);
  const why = item.reason ? REASON_LABEL[item.reason] : null;
  return (
    <div className="flex items-center gap-1 pr-1">
      <button
        type="button"
        role="checkbox"
        aria-checked={item.checked}
        onClick={onToggle}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pl-3 text-left"
      >
        <span
          aria-hidden
          className={cx(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
            item.checked ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface",
          )}
        >
          {item.checked && <Check size={16} strokeWidth={3} />}
        </span>
        <span aria-hidden className="w-7 shrink-0 text-center text-xl leading-none">
          {food?.emoji ?? "🛒"}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={cx(
              "block truncate text-[15px] font-medium",
              item.checked ? "text-ink-3 line-through decoration-ink-3/60" : "text-ink",
            )}
          >
            {item.name}
          </span>
          {why && <span className="block truncate text-xs text-ink-3">{why}</span>}
        </span>
      </button>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Change quantity of ${item.name}${q ? `, currently ${q}` : ""}`}
        className={cx(
          "h-9 shrink-0 rounded-full px-3 text-sm font-semibold tabular-nums transition-colors hover:bg-surface-2",
          q ? "text-ink-2" : "text-ink-3",
        )}
      >
        {q ?? "qty"}
      </button>
      <IconButton label={`Remove ${item.name}`} onClick={onRemove} className="h-10 w-10">
        <X size={18} />
      </IconButton>
    </div>
  );
}

/* ---------- Edit sheet ---------- */

function EditSheet({
  item,
  onClose,
  onSave,
  onRemove,
}: {
  item: ShoppingListItem | null;
  onClose: () => void;
  onSave: (patch: Partial<ShoppingListItem>) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [quantity, setQuantity] = useState(item?.quantity ?? 1);
  const [unit, setUnit] = useState<string>(item?.unit ?? getFoodType(item?.foodTypeId)?.defaultUnit ?? "item");

  const step = unit === "g" || unit === "ml" ? 50 : unit === "kg" || unit === "L" ? 0.5 : 1;

  return (
    <Sheet
      open={item !== null}
      onClose={onClose}
      title={item?.name ?? ""}
      footer={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onRemove} className="text-spoiled">
            <Trash2 size={16} aria-hidden />
            Remove
          </Button>
          <Button block onClick={() => onSave({ name: name.trim() || item?.name, quantity, unit })}>
            Save
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5 pt-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-2">Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-2">How much</span>
          <div className="flex flex-wrap items-center gap-3">
            <Stepper value={quantity} onChange={(v) => setQuantity(Math.max(step, v))} step={step} min={step} label="quantity" />
            <label className="flex items-center gap-2 text-sm text-ink-2">
              <span className="sr-only">Unit</span>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="h-10 rounded-full border border-line bg-surface px-3 text-sm font-medium text-ink"
              >
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u === "item" ? "each" : u}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

/* ---------- Quick add with suggestions ---------- */

function QuickAdd({ onAddFood, onAddText }: { onAddFood: (f: FoodType, q?: number) => void; onAddText: (t: string) => void }) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const parsed = parseQuickAdd(text);
  const matches = useMemo(() => (parsed.text.length >= 2 ? searchFoodTypes(parsed.text, 6) : []), [parsed.text]);
  const showList = focused && matches.length > 0;

  const reset = () => {
    setText("");
    setActive(-1);
    inputRef.current?.focus();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (active >= 0 && matches[active]) {
      onAddFood(matches[active], parsed.quantity);
    } else if (text.trim()) {
      onAddText(text);
    }
    reset();
  };

  return (
    <form onSubmit={submit} className="relative" role="search" aria-label="Add to the list">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            ref={inputRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setActive(-1);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 120)}
            onKeyDown={(e) => {
              if (!showList) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(matches.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(-1, a - 1));
              } else if (e.key === "Escape") {
                setFocused(false);
              }
            }}
            placeholder="Add something, like 2 milk"
            aria-label="Add something to the list"
            role="combobox"
            aria-expanded={showList}
            aria-controls="quick-add-options"
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `quick-add-opt-${active}` : undefined}
            autoComplete="off"
            enterKeyHint="done"
          />
        </div>
        <Button type="submit" aria-label="Add to list" className="h-12 w-12 shrink-0 px-0" disabled={!text.trim()}>
          <Plus size={22} aria-hidden />
        </Button>
      </div>
      <ul
        id="quick-add-options"
        role="listbox"
        aria-label="Matching foods"
        className={cx(
          "absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-2xl border border-line bg-surface shadow-card",
          !showList && "hidden",
        )}
      >
        {matches.map((f, i) => (
          <li
            key={f.id}
            id={`quick-add-opt-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onAddFood(f, parsed.quantity);
              reset();
            }}
            className={cx(
              "flex h-12 cursor-pointer items-center gap-3 px-4 text-[15px]",
              i === active ? "bg-primary-soft text-ink" : "text-ink hover:bg-surface-2",
            )}
          >
            <span aria-hidden className="w-6 text-center text-lg">
              {f.emoji}
            </span>
            <span className="flex-1">{f.name}</span>
            <span className="text-xs text-ink-3">{f.aisle}</span>
          </li>
        ))}
      </ul>
    </form>
  );
}
