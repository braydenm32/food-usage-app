"use client";

import Link from "next/link";
import { CalendarDays, Check, Plus, Share2, Trash2, X } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useLarder } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";
import { useNow } from "@/lib/use-now";
import { defaultsForUnknown } from "@/lib/shelf-life/engine";
import { FOOD_TYPES, getFoodType, matchFoodType, searchFoodTypes } from "@/lib/shelf-life/foods";
import type { Aisle, DraftItem, FoodType, ShoppingListItem, Unit } from "@/lib/types";
import { Button, Card, EmptyState, IconButton, Input, PageHeader, SectionTitle, Sheet, Stepper, cx } from "@/components/ui";
import { toast } from "@/components/toast";
import { useRouter } from "next/navigation";
import { startReviewSession } from "@/components/add/session";
import { formatQuantity } from "@/components/pantry/format";
import { isLikelyNonFood, lineToDraft } from "@/lib/drafts";
// Swapped for `useHouseholdStaples` from "@/lib/selectors" at merge (see the shim).
import { useHouseholdStaples } from "@/lib/selectors";

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

const UNITS: Unit[] = ["item", "g", "kg", "ml", "L", "pack", "bag", "punnet", "tub", "tray", "bunch", "dozen", "loaf", "tin", "jar", "bottle"];
const isUnit = (u: string | undefined): u is Unit => !!u && (UNITS as string[]).includes(u);

const REASON_LABEL: Record<NonNullable<ShoppingListItem["reason"]>, string | null> = {
  manual: null,
  recipe: "for a recipe",
  staple: "staple",
  plan: "for this week's meals",
};

/** Toiletries go to Health & Beauty; cleaning, paper and the rest to Household. */
const HEALTH_BEAUTY =
  /\b(shampoo|conditioner|body ?wash|soap|deodorant|toothpaste|toothbrush|floss|razor|sunscreen|moisturiser|panadol|nurofen|paracetamol|ibuprofen|band-?aids?|plasters?|tampons?|pads|napp(y|ies))\b/i;

function nonFoodAisle(name: string): Aisle {
  return HEALTH_BEAUTY.test(name) ? "Health & Beauty" : "Household";
}

/**
 * Non-food on the list (toilet paper, dish liquid). These live in their own "Household"
 * section, are never put in the larder and never get a date: ticking one just clears it.
 */
function isHouseholdItem(l: Pick<ShoppingListItem, "aisle" | "foodTypeId" | "name">): boolean {
  if (l.foodTypeId) return false;
  return l.aisle === "Household" || l.aisle === "Health & Beauty" || isLikelyNonFood(l.name);
}

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
  const plannerOn = useLarder((s) => s.settings.mealPlannerEnabled);

  const [editing, setEditing] = useState<ShoppingListItem | null>(null);
  const openedAt = useNow();
  const router = useRouter();

  const open = useMemo(() => list.filter((l) => !l.checked), [list]);
  const ticked = useMemo(() => list.filter((l) => l.checked), [list]);
  /** Ticked food: what "Put in the larder" takes. Ticked non-food just comes off the list with it. */
  const tickedFood = useMemo(() => ticked.filter((l) => !isHouseholdItem(l)), [ticked]);
  const groups = useMemo(() => groupByAisle(open.filter((l) => !isHouseholdItem(l))), [open]);
  const householdRows = useMemo(
    () => open.filter(isHouseholdItem).sort((a, b) => a.name.localeCompare(b.name)),
    [open],
  );
  const staples = useHouseholdStaples();
  const locations = useLarder((s) => s.locations);
  /** Larder stock per food type (and per name for unmatched items), for the "Already have" hint. */
  const haveFor = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of items) {
      const key = i.foodTypeId ?? i.name.toLowerCase();
      if (m.has(key) || (i.initialQuantity && i.quantity / i.initialQuantity <= 0.25)) continue;
      const where = locations.find((l) => l.id === i.locationId)?.name.toLowerCase();
      m.set(key, `${formatQuantity(i.quantity, i.unit)}${where ? ` in the ${where}` : ""}`);
    }
    return (l: ShoppingListItem) => m.get(l.foodTypeId ?? l.name.toLowerCase());
  }, [items, locations]);

  /* Suggestions: things we ran out of recently, then staples not in the larder. */
  const suggestions = useMemo(() => {
    const inLarder = new Set(items.map((i) => i.foodTypeId).filter(Boolean));
    const onList = new Set(open.map((l) => l.foodTypeId).filter(Boolean));
    const onListNames = new Set(open.map((l) => l.name.toLowerCase()));
    const out: Array<{ key: string; name: string; food?: FoodType; why: "ran-out" | "low" | "often" | "staple" }> = [];
    const seen = new Set<string>();

    // The household's own staples that have run out or are running low.
    for (const v of staples) {
      const key = v.staple.foodTypeId ?? v.staple.name.toLowerCase();
      if (v.onList || seen.has(key) || (v.inStock && !v.low)) continue;
      if (v.staple.foodTypeId ? onList.has(v.staple.foodTypeId) : onListNames.has(key)) continue;
      seen.add(key);
      const food = getFoodType(v.staple.foodTypeId);
      out.push({ key, name: food?.name ?? v.staple.name, food, why: v.inStock ? "low" : "staple" });
    }

    // Running low: a quarter or less left of something we don't have a fuller one of.
    for (const i of items) {
      if (!i.initialQuantity || i.quantity / i.initialQuantity > 0.25) continue;
      const key = i.foodTypeId ?? i.name.toLowerCase();
      if (seen.has(key) || (i.foodTypeId ? onList.has(i.foodTypeId) : onListNames.has(key))) continue;
      const fuller = items.some((o) => o.id !== i.id && (i.foodTypeId ? o.foodTypeId === i.foodTypeId : o.name.toLowerCase() === key) && o.quantity / (o.initialQuantity || 1) > 0.25);
      if (fuller) continue;
      seen.add(key);
      const food = getFoodType(i.foodTypeId);
      out.push({ key, name: food?.name ?? i.name, food, why: "low" });
    }

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
    // Often bought: added three or more times in the last two months, and none in the larder now.
    const since = openedAt - 60 * 86_400_000;
    const adds = new Map<string, number>();
    for (const e of events) {
      if (e.type === "added" && e.foodTypeId && new Date(e.at).getTime() > since) adds.set(e.foodTypeId, (adds.get(e.foodTypeId) ?? 0) + 1);
    }
    for (const [id, n] of [...adds].sort((a, b) => b[1] - a[1])) {
      if (n < 3 || seen.has(id) || inLarder.has(id) || onList.has(id)) continue;
      const food = getFoodType(id);
      if (!food) continue;
      seen.add(id);
      out.push({ key: id, name: food.name, food, why: "often" });
    }
    return out.slice(0, 10);
  }, [items, events, open, openedAt, staples]);

  /** A brand-new household gets generic ideas; once it has history (or its own staples) they go. */
  const hasHistory = items.length > 0 || staples.length > 0 || events.some((e) => e.type === "added");
  const commonStaples = useMemo(() => {
    if (hasHistory) return [];
    const onList = new Set(list.map((l) => l.foodTypeId).filter(Boolean));
    return FOOD_TYPES.filter((f) => f.staple && !onList.has(f.id)).slice(0, 10);
  }, [hasHistory, list]);

  /** Typed adds show up on the list right away, so they don't need a toast over it. */
  const addFood = (food: FoodType, quantity?: number) => {
    addToList([
      {
        name: food.name,
        foodTypeId: food.id,
        aisle: food.aisle,
        quantity: quantity ?? food.defaultQuantity,
        unit: food.defaultUnit,
        reason: "manual",
      },
    ]);
  };

  const addFreeText = (raw: string) => {
    const { quantity, text } = parseQuickAdd(raw);
    if (!text) return;
    const name = text.charAt(0).toUpperCase() + text.slice(1);
    // Toilet paper, dish liquid…: straight to the Household section, never matched to a food.
    if (isLikelyNonFood(text)) {
      addToList([{ name, foodTypeId: null, aisle: nonFoodAisle(text), quantity, reason: "manual" }]);
      return;
    }
    const match = matchFoodType(text);
    if (match && match.confidence !== "low") {
      addFood(match.food, quantity);
      return;
    }
    addToList([{ name, foodTypeId: null, aisle: "Other", quantity, reason: "manual" }]);
  };

  const removeRow = (it: ShoppingListItem) => {
    removeListItem(it.id);
    toast(`Removed ${it.name}`, { undoable: true });
  };

  /** Non-food has nowhere to go in the larder: ticking it just takes it off the list. */
  const tickHousehold = (it: ShoppingListItem) => {
    removeListItem(it.id);
    toast(`Ticked off ${it.name.toLowerCase()}`, { undoable: true });
  };

  const tickedDrafts = (): DraftItem[] =>
    tickedFood.map((l) => {
      const match = l.foodTypeId ? undefined : matchFoodType(l.name);
      const food = getFoodType(l.foodTypeId) ?? (match?.confidence === "high" ? match.food : undefined);
      const unknown = defaultsForUnknown(l.name);
      return {
        key: l.id,
        // A matched food gets its proper name ("Full cream milk", not "milk"); anything else keeps what was typed.
        name: food?.name ?? l.name,
        foodTypeId: food?.id ?? null,
        emoji: food?.emoji ?? "🛒",
        locationId: food?.defaultLocation ?? unknown.locationId,
        quantity: l.quantity ?? food?.defaultQuantity ?? 1,
        unit: isUnit(l.unit) ? l.unit : (food?.defaultUnit ?? "item"),
        dateKind: food?.dateKind ?? unknown.dateKind,
        include: true,
      };
    });

  /** Review the ticked items first, so printed dates can be typed in before they're put away. */
  const reviewPutAway = () => {
    if (tickedFood.length === 0) return;
    const drafts = tickedDrafts().map((d) => ({ ...lineToDraft({ name: d.name }), ...d, isFood: true }));
    // "putaway": the review's Back goes to the List, and it says "N things from your list".
    startReviewSession("list", {
      drafts,
      source: "putaway",
      removeListIds: ticked.map((l) => l.id),
      note: "Type any printed dates you can see on the packs. Anything left blank gets an estimate.",
    });
    router.push("/add?method=list&step=review");
  };

  const putInLarder = () => {
    if (tickedFood.length === 0) return;
    const drafts = tickedDrafts();
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
        showSettings
        actions={
          <>
            {hydrated && plannerOn && (
              <Link
                href="/plan"
                aria-label="Meal plan"
                title="Meal plan"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink lg:hidden"
              >
                <CalendarDays size={22} aria-hidden />
              </Link>
            )}
            <IconButton label="Share list" onClick={share} disabled={!hydrated || open.length === 0} className="h-11! w-11! shrink-0">
              <Share2 size={20} />
            </IconButton>
          </>
        }
      />

      <div className="px-5 lg:px-0">
        <QuickAdd onAddFood={addFood} onAddText={addFreeText} />

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
            body={
              suggestions.length > 0
                ? "Add what you're running low on, pick ingredients from a recipe, or tap a suggestion below."
                : "Add what you're running low on, or pick ingredients from a recipe."
            }
          />
        ) : (
          <div className="mt-6">
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
                      have={haveFor(it)}
                      onToggle={() => toggleListItem(it.id)}
                      onEdit={() => setEditing(it)}
                      onRemove={() => removeRow(it)}
                    />
                  ))}
                </Card>
              </section>
            ))}

            {householdRows.length > 0 && (
              <section aria-labelledby="household-heading">
                <SectionTitle>
                  <span id="household-heading">Household</span>
                </SectionTitle>
                <p className="-mt-1 mb-2 text-sm text-ink-3">Not food, so these never go in the larder. Tick one to clear it.</p>
                <Card className="divide-y divide-line">
                  {householdRows.map((it) => (
                    <ListRow
                      key={it.id}
                      item={it}
                      household
                      onToggle={() => tickHousehold(it)}
                      onEdit={() => setEditing(it)}
                      onRemove={() => removeRow(it)}
                    />
                  ))}
                </Card>
              </section>
            )}

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
                      have={haveFor(it)}
                      onToggle={() => toggleListItem(it.id)}
                      onEdit={() => setEditing(it)}
                      onRemove={() => removeRow(it)}
                    />
                  ))}
                </Card>
                {tickedFood.length > 0 && (
                  <div className="mt-4">
                    <Button block size="lg" onClick={reviewPutAway}>
                      Put {tickedFood.length} item{tickedFood.length === 1 ? "" : "s"} in the larder
                    </Button>
                    <p className="mt-2 text-center text-xs text-ink-3">
                      You can type printed dates on the next screen.{" "}
                      <button type="button" onClick={putInLarder} className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-2 hover:underline">
                        Skip and use estimates
                      </button>
                    </p>
                  </div>
                )}
              </section>
            )}
          </div>
        )}

        {hydrated && suggestions.length > 0 && (
          <SuggestionRow
            id="suggestions-heading"
            title="Running low? One tap to add"
            className={list.length === 0 ? "mt-2" : "mt-8"}
            chips={suggestions.map((s) => ({
              key: s.key,
              name: s.name,
              emoji: s.food?.emoji,
              note: s.why === "ran-out" ? "ran out" : s.why === "low" ? "running low" : s.why === "often" ? "often bought" : "always keep",
              onAdd: () => {
                if (s.food) addFood(s.food);
                else addToList([{ name: s.name, foodTypeId: null, aisle: "Other", reason: "staple" }]);
                toast(`Added ${s.name}`);
              },
            }))}
          />
        )}
        {hydrated && commonStaples.length > 0 && (
          <SuggestionRow
            id="common-staples-heading"
            title="Common staples"
            className={list.length === 0 && suggestions.length === 0 ? "mt-2" : "mt-6"}
            chips={commonStaples.map((f) => ({
              key: f.id,
              name: f.name,
              emoji: f.emoji,
              onAdd: () => {
                addFood(f);
                toast(`Added ${f.name}`);
              },
            }))}
          />
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
          if (editing) removeRow(editing);
          setEditing(null);
        }}
      />
    </div>
  );
}

/* ---------- Suggestions ---------- */

function SuggestionRow({
  id,
  title,
  className,
  chips,
}: {
  id: string;
  title: string;
  className?: string;
  chips: Array<{ key: string; name: string; emoji?: string; note?: string; onAdd: () => void }>;
}) {
  return (
    <section aria-labelledby={id} className={className}>
      <h2 id={id} className="mb-2 text-sm font-medium text-ink-2">
        {title}
      </h2>
      <div className="scrollbar-none fade-x -mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:flex-wrap lg:px-0">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={c.onAdd}
            className="relative inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface pl-3 pr-3.5 text-sm font-medium text-ink transition-colors after:absolute after:-inset-y-1 after:inset-x-0 after:content-[''] hover:border-primary hover:bg-primary-soft"
          >
            <Plus size={15} aria-hidden className="text-primary" />
            {c.emoji && <span aria-hidden>{c.emoji}</span>}
            {c.name}
            {c.note && <span className="text-xs text-ink-3">{c.note}</span>}
          </button>
        ))}
      </div>
    </section>
  );
}

/* ---------- Row ---------- */

function ListRow({
  item,
  have,
  household,
  onToggle,
  onEdit,
  onRemove,
}: {
  item: ShoppingListItem;
  /** Non-food: ticking clears it rather than moving it to the trolley. */
  household?: boolean;
  /** What's already in the larder, e.g. "1 L in the fridge", so you don't double up. */
  have?: string;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const food = getFoodType(item.foodTypeId);
  const q = quantityLabel(item);
  const why = item.note ?? (item.reason ? REASON_LABEL[item.reason] : null);
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
          {food?.emoji ?? (household ? "🧻" : "🛒")}
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
          {have && !item.checked ? (
            <span className="block truncate text-xs font-medium text-soon">Already have {have}</span>
          ) : (
            why && <span className="block truncate text-xs text-ink-3">{why}</span>
          )}
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
      <IconButton label={`Remove ${item.name}`} onClick={onRemove} className="h-11 w-11 shrink-0">
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
    } else {
      // Nothing typed yet: the button stays live and just puts the cursor in the box.
      inputRef.current?.focus();
      return;
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
        <Button type="submit" className="h-12 shrink-0 gap-1.5 px-4 text-[15px]">
          <Plus size={22} strokeWidth={2.5} aria-hidden />
          Add
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
