"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { addAmounts } from "@/lib/recipes/quantity";
import { CATCH_ALL_IDS, familyOf } from "@/lib/recipes/families";
import type {
  Aisle,
  BarcodeMemory,
  DraftItem,
  FoodCategory,
  FoodType,
  HouseholdProfile,
  ItemEvent,
  ItemEventType,
  MealPlanEntry,
  PantryItem,
  Recipe,
  Settings,
  ShelfLifeOverride,
  ShoppingListItem,
  Staple,
  StorageLocation,
} from "@/lib/types";
import { getFoodType } from "@/lib/shelf-life/foods";
import { isPastDateForFreezing, parseLocalDate, startOfDay } from "@/lib/shelf-life/engine";

export const DEFAULT_LOCATIONS: StorageLocation[] = [
  { id: "fridge", name: "Fridge", kind: "fridge", emoji: "🧊" },
  { id: "freezer", name: "Freezer", kind: "freezer", emoji: "❄️" },
  { id: "pantry", name: "Pantry", kind: "pantry", emoji: "🥫" },
];

export const DEFAULT_PROFILE: HouseholdProfile = {
  householdName: "My household",
  people: 2,
  diets: [],
  allergies: [],
  likes: [],
  dislikes: [],
};

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  digest: "daily",
  digestHour: 17,
  pushEnabled: false,
  useSoonDays: 2,
  // A weekly habit, on for everyone; Settings can turn it off.
  mealPlannerEnabled: true,
  onboarded: false,
};

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

const nowISO = () => new Date().toISOString();

/** Most events kept in history (oldest dropped first). */
export const MAX_EVENTS = 2000;

/** One record touched by an undoable action: its state before (null = it didn't exist) and old index. */
interface Touched<T> {
  id: string;
  before: T | null;
  index: number;
}

/**
 * What an undoable action changed. Undo reverts only these records, so unrelated edits made
 * after the action survive. `id` lets a toast check it is undoing the action it announced.
 */
export interface UndoSnapshot {
  id: string;
  label: string;
  items: Touched<PantryItem>[];
  list: Touched<ShoppingListItem>[];
  /** Events the action appended (removed again on undo). */
  eventIds: string[];
  /** Barcode memories the action wrote: each code's memory before (null = it was new). */
  barcodes?: { code: string; before: BarcodeMemory | null }[];
  /**
   * Older actions that can still be undone, newest first along the chain. Each toast keeps
   * its own Undo for its window, so a second action doesn't take away the first one's Undo.
   * Setting `undo: null` (Import, Erase) forgets the whole chain.
   */
  prev?: UndoSnapshot;
}

/** How many undoable actions are kept at once. */
export const MAX_UNDO = 8;

/** The undo chain as a list, newest first. */
export function undoChain(u: UndoSnapshot | null | undefined): UndoSnapshot[] {
  const out: UndoSnapshot[] = [];
  for (let x = u; x && out.length < MAX_UNDO; x = x.prev) out.push(x);
  return out;
}

/** Rebuild a chain (newest first) into linked snapshots. */
function linkChain(list: UndoSnapshot[]): UndoSnapshot | null {
  let head: UndoSnapshot | undefined;
  for (let i = Math.min(list.length, MAX_UNDO) - 1; i >= 0; i--) {
    const { prev: _ignored, ...rest } = list[i]; // eslint-disable-line @typescript-eslint/no-unused-vars
    head = head ? { ...rest, prev: head } : rest;
  }
  return head ?? null;
}

const touchedIds = (u: UndoSnapshot) =>
  new Set([
    ...u.items.map((t) => `i:${t.id}`),
    ...u.list.map((t) => `l:${t.id}`),
    ...(u.barcodes ?? []).map((b) => `b:${b.code}`),
  ]);

/**
 * Drop `dropId` from the chain, plus every older snapshot that touched the same records
 * (transitively). Otherwise undoing an older action later would put back records the
 * dropped, newer action changed, silently reverting it too.
 */
export function dropFromChain(chain: UndoSnapshot[], dropId: string): UndoSnapshot[] {
  const at = chain.findIndex((u) => u.id === dropId);
  if (at < 0) return chain;
  const ids = touchedIds(chain[at]);
  const drop = new Set([dropId]);
  for (let i = at + 1; i < chain.length; i++) {
    const t = touchedIds(chain[i]);
    if ([...t].some((x) => ids.has(x))) {
      drop.add(chain[i].id);
      t.forEach((x) => ids.add(x));
    }
  }
  return chain.filter((u) => !drop.has(u.id));
}

/** Records in `prev` that changed or vanished in `next`, plus records new in `next`. */
export function diffById<T extends { id: string }>(prev: T[], next: T[]): Touched<T>[] {
  const nextById = new Map(next.map((x) => [x.id, x]));
  const prevIds = new Set(prev.map((x) => x.id));
  const out: Touched<T>[] = [];
  prev.forEach((p, index) => {
    if (nextById.get(p.id) !== p) out.push({ id: p.id, before: p, index });
  });
  for (const n of next) if (!prevIds.has(n.id)) out.push({ id: n.id, before: null, index: -1 });
  return out;
}

/** Put touched records back as they were, leaving everything else alone. */
export function revertById<T extends { id: string }>(current: T[], touched: Touched<T>[]): T[] {
  const byId = new Map(touched.map((t) => [t.id, t]));
  // Drop created records and swap changed ones back in place.
  const out: T[] = [];
  const present = new Set<string>();
  for (const c of current) {
    const t = byId.get(c.id);
    if (!t) out.push(c);
    else if (t.before) {
      out.push(t.before);
      present.add(c.id);
    }
  }
  // Re-insert removed records near where they were.
  const missing = touched.filter((t) => t.before && !present.has(t.id)).sort((a, b) => a.index - b.index);
  for (const t of missing) out.splice(Math.min(t.index, out.length), 0, t.before as T);
  return out;
}

const capEvents = (events: ItemEvent[]) => (events.length > MAX_EVENTS ? events.slice(-MAX_EVENTS) : events);

const NEVER_OPENED_BY_USE: FoodCategory[] = ["fruit", "vegetables", "herbs", "meat", "seafood", "eggs", "bakery"];
const SEALED_CATEGORIES: FoodCategory[] = ["condiments", "dairy", "deli", "drinks"];
const SEALED_UNITS = new Set(["jar", "tin", "bottle", "L", "ml"]);

/**
 * Whether using part of an item means its pack is now open (so the opened clock applies).
 * True for jars, tins, bottles, cartons and dairy/deli packs; false for produce, meat,
 * seafood, eggs, bread and dry pantry goods like rice, pasta and flour.
 */
export function opensWhenUsed(item: Pick<PantryItem, "unit" | "foodTypeId">, food: FoodType | undefined = getFoodType(item.foodTypeId)): boolean {
  const sealedUnit = SEALED_UNITS.has(item.unit);
  if (!food) return sealedUnit;
  if (NEVER_OPENED_BY_USE.includes(food.category)) return false;
  if (SEALED_CATEGORIES.includes(food.category)) return true;
  return sealedUnit || SEALED_UNITS.has(food.defaultUnit);
}

const RISKY_CATEGORIES: FoodCategory[] = ["meat", "seafood", "eggs", "dairy", "deli"];
const OVERRIDE_KEYS = ["pantryDays", "fridgeDays", "freezerDays", "openedDays"] as const;

/**
 * Learned overrides can't stretch use-by or high-risk foods past 1.5× the table value
 * (and can't invent a life where the table says "not suited").
 */
export function clampOverride(o: ShelfLifeOverride): ShelfLifeOverride {
  const food = getFoodType(o.foodTypeId);
  if (!food || (food.dateKind !== "use-by" && !RISKY_CATEGORIES.includes(food.category))) return o;
  const out: ShelfLifeOverride = { ...o };
  for (const k of OVERRIDE_KEYS) {
    const v = o[k];
    if (v === undefined || v === null) continue;
    const table = food[k];
    if (table === null) delete out[k];
    else out[k] = Math.min(v, Math.floor(table * 1.5));
  }
  return out;
}

/** An answer in the weekly "Fridge check". */
export type ReconcileAnswer = "used" | "binned" | "half" | "keep";

export interface CookDeduction {
  itemId: string;
  /** Amount used, in the item's unit. */
  quantity: number;
}

export interface LarderState {
  items: PantryItem[];
  events: ItemEvent[];
  locations: StorageLocation[];
  overrides: Record<string, ShelfLifeOverride>;
  profile: HouseholdProfile;
  settings: Settings;
  savedRecipes: Recipe[];
  shoppingList: ShoppingListItem[];
  mealPlan: MealPlanEntry[];
  /** Barcode → what this household said it is, checked before any network lookup. */
  barcodes: Record<string, BarcodeMemory>;
  /** Household staples: "Always keep in stock". */
  staples: Staple[];
  /** Not persisted: last undoable action (older ones hang off `undo.prev`). Toasts read `undo.id` when shown. */
  undo: UndoSnapshot | null;

  /**
   * Add drafts (only those with include). `removeListIds` takes shopping-list rows off the
   * list in the same undoable step (used by "Put in the larder").
   */
  addItems: (
    drafts: DraftItem[],
    source: PantryItem["source"],
    opts?: {
      removeListIds?: string[];
      /** Top up existing items instead of adding new ones (same undo step). Quantity is in the item's unit. */
      merge?: { itemId: string; quantity: number; price?: number }[];
    },
  ) => PantryItem[];
  /** Remember what a barcode is (set automatically when a scanned line is added). */
  rememberBarcode: (code: string, memo: Omit<BarcodeMemory, "at">) => void;
  updateItem: (id: string, patch: Partial<PantryItem>) => void;
  openItem: (id: string) => void;
  /** Move an item. With `quantity` less than what's there, only that much moves, as a new item. */
  moveItem: (id: string, locationId: string, quantity?: number) => void;
  /** Mark some or all of an item used or binned. Removes it when nothing is left. */
  consumeItem: (id: string, quantity: number | "all", how: "used" | "binned") => void;
  /** Use or bin several whole items as one undoable step. */
  consumeMany: (ids: string[], how: "used" | "binned") => void;
  /**
   * Apply a "Fridge check" in one undoable step: each item was eaten (all used), binned,
   * is about half gone, or is still there. Returns how many were used and binned.
   */
  /** Move several whole items as one undoable step. Returns how many moved. */
  moveMany: (ids: string[], locationId: string) => number;
  reconcileItems: (answers:{ id: string; answer: ReconcileAnswer }[]) => { used: number; binned: number; half: number };
  deleteItem: (id: string) => void;
  /** `leftovers` adds a new item in the same undo step (the cook sheet's "Save leftovers"). */
  cookRecipe: (recipe: Recipe, deductions: CookDeduction[], leftovers?: DraftItem) => void;
  /**
   * Revert the last undoable action, or with an id that action while it is still in the undo
   * chain. Later actions that touched the same records are undone with it (newest first), so
   * nothing is left half reverted. Returns how many actions were undone.
   */
  performUndo: (id?: string) => number;
  /** Forget the newest undo snapshot, or with an id just that one. */
  clearUndo: (id?: string) => void;
  /** Mark or unmark a food as one the household always keeps in stock. */
  setStaple: (food: { name: string; foodTypeId: string | null; emoji?: string }, on: boolean) => void;

  setOverride: (o: ShelfLifeOverride) => void;
  removeOverride: (foodTypeId: string) => void;
  setProfile: (p: Partial<HouseholdProfile>) => void;
  setSettings: (s: Partial<Settings>) => void;
  addLocation: (name: string, kind: StorageLocation["kind"], emoji?: string) => void;
  removeLocation: (id: string) => void;

  saveRecipe: (r: Recipe) => void;
  unsaveRecipe: (id: string) => void;
  /** Edit a saved recipe in place (title, servings, ingredients, steps…). */
  updateSavedRecipe: (id: string, patch: Partial<Recipe>) => void;

  addToList: (entries: Array<Omit<ShoppingListItem, "id" | "checked" | "addedAt" | "aisle"> & { aisle?: Aisle }>) => void;
  toggleListItem: (id: string) => void;
  updateListItem: (id: string, patch: Partial<ShoppingListItem>) => void;
  removeListItem: (id: string) => void;
  clearChecked: () => void;

  /**
   * Plan a recipe for a day, for `servings` people. Doesn't add it to Saved: built-in and saved
   * recipes are looked up by id, anything else is kept as a copy on the plan entry.
   */
  planMeal: (date: string, recipe: Recipe, servings?: number) => void;
  unplanMeal: (id: string) => void;
  /** Mark a planned meal cooked (or not, with null). */
  setPlanCooked: (id: string, cooked: boolean) => void;

  resetAll: () => void;
  loadDemoData: () => void;
}

function makeEvent(item: PantryItem, type: ItemEventType, extra: Partial<ItemEvent> = {}): ItemEvent {
  return {
    id: uid(),
    itemId: item.id,
    itemName: item.name,
    foodTypeId: item.foodTypeId,
    type,
    at: nowISO(),
    ...extra,
  };
}

function valueOf(item: PantryItem, quantity: number): number | undefined {
  if (item.price === undefined || !item.initialQuantity) return undefined;
  return Math.round((item.price * quantity * 100) / item.initialQuantity) / 100;
}

const initialData = () => ({
  items: [] as PantryItem[],
  events: [] as ItemEvent[],
  locations: DEFAULT_LOCATIONS,
  overrides: {} as Record<string, ShelfLifeOverride>,
  profile: DEFAULT_PROFILE,
  settings: DEFAULT_SETTINGS,
  savedRecipes: [] as Recipe[],
  shoppingList: [] as ShoppingListItem[],
  mealPlan: [] as MealPlanEntry[],
  barcodes: {} as Record<string, BarcodeMemory>,
  staples: [] as Staple[],
});

const STORAGE_KEY = "larder-v1";

/** Fired on window once per session when the browser refuses to save (quota full or blocked). */
export const STORAGE_FULL_EVENT = "larder:storage-full";
let warnedStorageFull = false;

/** localStorage that never throws: a failed save raises STORAGE_FULL_EVENT once instead. */
const safeStorage = {
  getItem: (name: string) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name: string, value: string) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      if (!warnedStorageFull && typeof window !== "undefined") {
        warnedStorageFull = true;
        window.dispatchEvent(new Event(STORAGE_FULL_EVENT));
      }
    }
  },
  removeItem: (name: string) => {
    try {
      localStorage.removeItem(name);
    } catch {
      /* ignore */
    }
  },
};

type PersistedData = ReturnType<typeof initialData>;

const arr = <T,>(v: unknown, fallback: T[] = []): T[] => (Array.isArray(v) ? (v as T[]) : fallback);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * Fill in anything missing or malformed in saved/imported data with defaults: arrays stay
 * arrays, settings and profile are merged over the defaults, and the built-in spots always exist.
 * Used by the persist migrate/merge and by Settings → Import.
 */
export function normalisePersisted(raw: unknown): PersistedData {
  const p = obj(raw);
  const profile = obj(p.profile);
  const locations = arr<StorageLocation>(p.locations).filter((l) => l && typeof l.id === "string");
  return {
    items: arr<PantryItem>(p.items).filter((i) => i && typeof i.id === "string"),
    events: capEvents(arr<ItemEvent>(p.events)),
    locations: [...DEFAULT_LOCATIONS.filter((d) => !locations.some((l) => l.id === d.id)), ...locations],
    overrides: obj(p.overrides) as Record<string, ShelfLifeOverride>,
    profile: {
      ...DEFAULT_PROFILE,
      ...profile,
      diets: arr(profile.diets),
      allergies: arr(profile.allergies),
      likes: arr(profile.likes),
      dislikes: arr(profile.dislikes),
    } as HouseholdProfile,
    settings: { ...DEFAULT_SETTINGS, ...obj(p.settings) } as Settings,
    savedRecipes: arr<Recipe>(p.savedRecipes),
    shoppingList: arr<ShoppingListItem>(p.shoppingList),
    mealPlan: arr<MealPlanEntry>(p.mealPlan),
    barcodes: obj(p.barcodes) as Record<string, BarcodeMemory>,
    staples: arr<Staple>(p.staples).filter((x) => x && typeof x.id === "string" && typeof x.name === "string"),
  };
}

/** Join two list-row notes ("6 slices for French toast" + "for sandwiches"), skipping repeats. */
export function joinNotes(a: string | undefined, b: string | undefined): string | undefined {
  const parts = [a, b].map((x) => x?.trim()).filter((x): x is string => !!x);
  const unique = parts.filter((x, i) => parts.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
  return unique.length ? unique.join("; ") : undefined;
}

/** Whether a staple and a larder item (or list row) are the same food. */
export function sameStapleFood(a: { name: string; foodTypeId: string | null }, b: { name: string; foodTypeId: string | null }): boolean {
  const sameName = a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
  if (a.foodTypeId && b.foodTypeId) {
    // A catch-all id ("spices") groups unlike foods, so the names must agree too.
    if (a.foodTypeId === b.foodTypeId) return !CATCH_ALL_IDS.has(a.foodTypeId) || sameName;
    // Same thing for the household: a "milk" staple is covered by skim or full cream.
    const fam = familyOf(a.foodTypeId);
    return !!fam && fam === familyOf(b.foodTypeId);
  }
  return sameName;
}

/** Whether an item going into the freezer is already past its date (freezing won't fix that). */
function pastDateWhenFrozen(
  item: PantryItem,
  state: Pick<LarderState, "locations" | "overrides">,
  fromLocationId: string,
): boolean {
  return isPastDateForFreezing(item, {
    food: getFoodType(item.foodTypeId),
    override: item.foodTypeId ? state.overrides[item.foodTypeId] : undefined,
    location: state.locations.find((l) => l.id === fromLocationId),
  });
}

export const useLarder = create<LarderState>()(
  persist(
    (set, get) => {
      /**
       * Apply an undoable change. The diff between before and after becomes the undo snapshot,
       * so undo puts back only the records this action touched.
       */
      const act = (label: string, change: (s: LarderState) => Partial<LarderState>) => {
        const prev = get();
        const patch = change(prev);
        const items = patch.items ?? prev.items;
        const shoppingList = patch.shoppingList ?? prev.shoppingList;
        const events = patch.events ?? prev.events;
        const prevEventIds = new Set(prev.events.map((e) => e.id));
        const undo: UndoSnapshot = {
          id: uid(),
          label,
          items: diffById(prev.items, items),
          list: diffById(prev.shoppingList, shoppingList),
          eventIds: events.filter((e) => !prevEventIds.has(e.id)).map((e) => e.id),
        };
        if (patch.barcodes) {
          const changed = Object.keys(patch.barcodes).filter((code) => patch.barcodes![code] !== prev.barcodes[code]);
          if (changed.length) undo.barcodes = changed.map((code) => ({ code, before: prev.barcodes[code] ?? null }));
        }
        const older = undoChain(prev.undo).slice(0, MAX_UNDO - 1);
        if (older.length) undo.prev = linkChain(older) ?? undefined;
        set({ ...patch, ...(patch.events ? { events: capEvents(patch.events) } : {}), undo });
      };

      const consumePatch = (s: LarderState, id: string, quantity: number | "all", how: "used" | "binned") => {
        const item = s.items.find((i) => i.id === id);
        if (!item) return null;
        const q = quantity === "all" ? item.quantity : Math.min(quantity, item.quantity);
        const remaining = Math.max(0, Math.round((item.quantity - q) * 1000) / 1000);
        const next: PantryItem | null =
          remaining === 0
            ? null
            : { ...item, quantity: remaining, openedAt: item.openedAt ?? (opensWhenUsed(item) ? nowISO() : undefined) };
        return { item, next, remaining, event: makeEvent(item, how, { quantity: q, unit: item.unit, value: valueOf(item, q) }) };
      };

      return {
        ...initialData(),
        undo: null,

        addItems: (drafts, source, opts) => {
          const { locations } = get();
          const today = startOfDay(new Date());
          const created: PantryItem[] = drafts
            // A zero or invalid amount is never stock.
            .filter((d) => d.include && Number.isFinite(d.quantity) && d.quantity > 0)
            // "2x milk 2L" arrives as one line of 2 packs: each pack is its own item, opened on its own.
            .flatMap((d) => {
              const packs = d.packs && Number.isInteger(d.packs) && d.packs > 1 ? Math.min(d.packs, 24) : 1;
              const price = d.price !== undefined && packs > 1 ? Math.round((d.price * 100) / packs) / 100 : d.price;
              return Array.from({ length: packs }, () => ({ ...d, price }));
            })
            .map((d) => {
              const frozen = locations.find((l) => l.id === d.locationId)?.kind === "freezer";
              return {
                id: uid(),
                name: d.name,
                foodTypeId: d.foodTypeId,
                emoji: d.emoji,
                locationId: d.locationId,
                quantity: d.quantity,
                initialQuantity: d.quantity,
                unit: d.unit,
                price: d.price,
                addedAt: nowISO(),
                printedDate: d.printedDate,
                dateKind: d.dateKind,
                frozenAt: frozen ? nowISO() : undefined,
                expiredWhenFrozen:
                  frozen && d.printedDate && d.dateKind === "use-by" && parseLocalDate(d.printedDate) < today ? true : undefined,
                source,
                ...(d.barcode ? { barcode: d.barcode } : {}),
              };
            });
          // Remember what each scanned barcode turned out to be, so the next scan needs no lookup.
          // Written in the same undoable step, so Undo forgets a mistaken scan too.
          const scanned = drafts.filter((d) => d.include && d.barcode && d.quantity > 0 && !d.name.startsWith("Barcode "));
          const scannedAt = nowISO();
          const removeIds = new Set(opts?.removeListIds ?? []);
          const merges = new Map((opts?.merge ?? []).filter((m) => m.quantity > 0).map((m) => [m.itemId, m]));
          const total = created.length + merges.size;
          act(`Added ${total} item${total === 1 ? "" : "s"}`, (s) => {
            const topped: PantryItem[] = [];
            const items = s.items.map((i) => {
              const m = merges.get(i.id);
              if (!m) return i;
              const q = Math.round((i.quantity + m.quantity) * 1000) / 1000;
              const next: PantryItem = {
                ...i,
                quantity: q,
                initialQuantity: Math.round((Math.max(i.initialQuantity, i.quantity) + m.quantity) * 1000) / 1000,
                price: i.price !== undefined && m.price !== undefined ? Math.round((i.price + m.price) * 100) / 100 : i.price,
              };
              topped.push(next);
              return next;
            });
            return {
              ...(scanned.length
                ? {
                    barcodes: {
                      ...s.barcodes,
                      ...Object.fromEntries(
                        scanned.map((d) => [
                          d.barcode!,
                          { foodTypeId: d.foodTypeId, name: d.name, emoji: d.emoji, unit: d.unit, quantity: d.quantity, at: scannedAt },
                        ]),
                      ),
                    },
                  }
                : {}),
              items: [...items, ...created],
              events: [
                ...s.events,
                ...created.map((i) =>
                  makeEvent(i, "added", { detail: source, locationId: i.locationId, quantity: i.quantity, unit: i.unit }),
                ),
                ...topped.map((i) =>
                  makeEvent(i, "added", { detail: source, locationId: i.locationId, quantity: merges.get(i.id)!.quantity, unit: i.unit }),
                ),
              ],
              // Ticking things off the list by adding them to the pantry.
              shoppingList: s.shoppingList.filter(
                (l) =>
                  !removeIds.has(l.id) &&
                  !(l.checked && [...created, ...topped].some((c) => c.foodTypeId && c.foodTypeId === l.foodTypeId)),
              ),
            };
          });
          return created;
        },

        rememberBarcode: (code, memo) =>
          set((s) => ({ barcodes: { ...s.barcodes, [code]: { ...memo, at: nowISO() } } })),

        updateItem: (id, patch) =>
          set((s) => ({
            items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
          })),

        openItem: (id) => {
          const item = get().items.find((i) => i.id === id);
          if (!item || item.openedAt) return;
          act(`Marked ${item.name} opened`, (s) => ({
            items: s.items.map((i) => (i.id === id ? { ...i, openedAt: nowISO() } : i)),
            events: [...s.events, makeEvent(item, "opened")],
          }));
        },

        moveItem: (id, locationId, quantity) => {
          const state = get();
          const item = state.items.find((i) => i.id === id);
          if (!item || item.locationId === locationId) return;
          const from = state.locations.find((l) => l.id === item.locationId);
          const to = state.locations.find((l) => l.id === locationId);
          const patch: Partial<PantryItem> = { locationId };
          if (to?.kind === "freezer" && from?.kind !== "freezer") {
            patch.frozenAt = nowISO();
            patch.thawedAt = undefined;
            if (!item.expiredWhenFrozen && pastDateWhenFrozen(item, state, item.locationId)) patch.expiredWhenFrozen = true;
          } else if (from?.kind === "freezer" && to?.kind !== "freezer") {
            patch.thawedAt = nowISO();
          }
          // Freezer to freezer keeps the frozen date.
          const splitting = quantity !== undefined && quantity > 0 && quantity < item.quantity;
          if (!splitting) {
            act(`Moved ${item.name} to ${to?.name ?? "new spot"}`, (s) => ({
              items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
              events: [
                ...s.events,
                makeEvent(item, "moved", { detail: `${from?.name ?? "?"} → ${to?.name ?? "?"}`, locationId }),
              ],
            }));
            return;
          }
          // Split: the moved part becomes its own item and keeps the original dates; price is shared out.
          const movedValue = valueOf(item, quantity);
          const moved: PantryItem = {
            ...item,
            ...patch,
            id: uid(),
            quantity,
            initialQuantity: quantity,
            price: movedValue,
          };
          if (moved.price === undefined) delete moved.price;
          const rest: PantryItem = {
            ...item,
            quantity: Math.round((item.quantity - quantity) * 1000) / 1000,
            initialQuantity: Math.max(item.quantity - quantity, Math.round((item.initialQuantity - quantity) * 1000) / 1000),
            price: item.price !== undefined && movedValue !== undefined ? Math.round((item.price - movedValue) * 100) / 100 : item.price,
          };
          if (rest.price === undefined) delete rest.price;
          act(`Moved ${quantity} ${item.name} to ${to?.name ?? "new spot"}`, (s) => ({
            items: [...s.items.map((i) => (i.id === id ? rest : i)), moved],
            events: [
              ...s.events,
              makeEvent(moved, "moved", { detail: `${quantity} of ${item.quantity}: ${from?.name ?? "?"} → ${to?.name ?? "?"}`, locationId, quantity, unit: item.unit }),
            ],
          }));
        },

        consumeItem: (id, quantity, how) => {
          const r = consumePatch(get(), id, quantity, how);
          if (!r) return;
          const verb = how === "used" ? "Used" : "Binned";
          act(r.remaining === 0 ? `${verb} ${r.item.name}` : `${verb} some ${r.item.name}`, (s) => ({
            items: r.next ? s.items.map((i) => (i.id === id ? r.next! : i)) : s.items.filter((i) => i.id !== id),
            events: [...s.events, r.event],
          }));
        },

        consumeMany: (ids, how) => {
          const s0 = get();
          const results = ids.map((id) => consumePatch(s0, id, "all", how)).filter((r) => r !== null);
          if (results.length === 0) return;
          const gone = new Set(results.map((r) => r.item.id));
          const verb = how === "used" ? "Used" : "Binned";
          act(`${verb} ${results.length} item${results.length === 1 ? "" : "s"}`, (s) => ({
            items: s.items.filter((i) => !gone.has(i.id)),
            events: [...s.events, ...results.map((r) => r.event)],
          }));
        },

        moveMany: (ids, locationId) => {
          const state = get();
          const to = state.locations.find((l) => l.id === locationId);
          if (!to) return 0;
          const patches = new Map<string, PantryItem>();
          const events: ItemEvent[] = [];
          for (const id of ids) {
            const item = state.items.find((i) => i.id === id);
            if (!item || item.locationId === locationId) continue;
            const from = state.locations.find((l) => l.id === item.locationId);
            const next: PantryItem = { ...item, locationId };
            if (to.kind === "freezer" && from?.kind !== "freezer") {
              next.frozenAt = nowISO();
              next.thawedAt = undefined;
              if (!item.expiredWhenFrozen && pastDateWhenFrozen(item, state, item.locationId)) next.expiredWhenFrozen = true;
            } else if (from?.kind === "freezer" && to.kind !== "freezer") {
              next.thawedAt = nowISO();
            }
            patches.set(id, next);
            events.push(makeEvent(item, "moved", { detail: `${from?.name ?? "?"} → ${to.name}`, locationId }));
          }
          if (patches.size === 0) return 0;
          act(`Moved ${patches.size} item${patches.size === 1 ? "" : "s"} to ${to.name}`, (s) => ({
            items: s.items.map((i) => patches.get(i.id) ?? i),
            events: [...s.events, ...events],
          }));
          return patches.size;
        },

        reconcileItems: (answers) => {
          const out = { used: 0, binned: 0, half: 0 };
          const s0 = get();
          const results: NonNullable<ReturnType<typeof consumePatch>>[] = [];
          for (const { id, answer } of answers) {
            if (answer === "keep") continue;
            const item = s0.items.find((i) => i.id === id);
            if (!item) continue;
            const q = answer === "half" ? Math.round((item.quantity / 2) * 1000) / 1000 : "all";
            const r = consumePatch(s0, id, q, answer === "binned" ? "binned" : "used");
            if (!r) continue;
            results.push(r);
            out[answer]++;
          }
          if (results.length === 0) return out;
          const byId = new Map(results.map((r) => [r.item.id, r.next]));
          act(`Fridge check: ${results.length} updated`, (s) => ({
            items: s.items.flatMap((i) => (byId.has(i.id) ? (byId.get(i.id) ? [byId.get(i.id)!] : []) : [i])),
            events: [...s.events, ...results.map((r) => r.event)],
          }));
          return out;
        },

        deleteItem: (id) => {
          const item = get().items.find((i) => i.id === id);
          if (!item) return;
          act(`Removed ${item.name}`, (s) => ({ items: s.items.filter((i) => i.id !== id) }));
        },

        cookRecipe: (recipe, deductions, leftovers) => {
          const items = [...get().items];
          const events: ItemEvent[] = [];
          for (const d of deductions) {
            const idx = items.findIndex((i) => i.id === d.itemId);
            if (idx < 0 || d.quantity <= 0) continue;
            const item = items[idx];
            const q = Math.min(d.quantity, item.quantity);
            const remaining = Math.round((item.quantity - q) * 1000) / 1000;
            events.push(
              makeEvent(item, "used", { quantity: q, unit: item.unit, value: valueOf(item, q), detail: recipe.title }),
            );
            if (remaining <= 0) items.splice(idx, 1);
            else
              items[idx] = {
                ...item,
                quantity: remaining,
                openedAt: item.openedAt ?? (opensWhenUsed(item) ? nowISO() : undefined),
              };
          }
          let added: PantryItem | undefined;
          if (leftovers) {
            added = {
              id: uid(),
              name: leftovers.name,
              foodTypeId: leftovers.foodTypeId,
              emoji: leftovers.emoji,
              locationId: leftovers.locationId,
              quantity: leftovers.quantity,
              initialQuantity: leftovers.quantity,
              unit: leftovers.unit,
              addedAt: nowISO(),
              dateKind: leftovers.dateKind,
              // Set only when the cook picked a different number of days than the estimate.
              ...(leftovers.printedDate ? { printedDate: leftovers.printedDate } : {}),
              source: "manual",
            };
            items.push(added);
            events.push(
              makeEvent(added, "added", { detail: "leftovers", locationId: added.locationId, quantity: added.quantity, unit: added.unit }),
            );
          }
          act(`Cooked ${recipe.title}`, (s) => ({ items, events: [...s.events, ...events] }));
        },

        performUndo: (id) => {
          const chain = undoChain(get().undo);
          const at = id === undefined ? 0 : chain.findIndex((u) => u.id === id);
          if (at < 0 || !chain[at]) return 0;
          // Undo newer actions that touched the same records first, so the target reverts cleanly.
          const target = chain[at];
          const ids = touchedIds(target);
          const revert = new Set([target.id]);
          for (let i = at - 1; i >= 0; i--) {
            const t = touchedIds(chain[i]);
            if ([...t].some((x) => ids.has(x))) {
              revert.add(chain[i].id);
              t.forEach((x) => ids.add(x));
            }
          }
          set((s) => {
            let items = s.items;
            let shoppingList = s.shoppingList;
            let barcodes = s.barcodes;
            const added = new Set<string>();
            for (const u of chain.slice(0, at + 1)) {
              if (!revert.has(u.id)) continue;
              items = revertById(items, u.items);
              shoppingList = revertById(shoppingList, u.list);
              u.eventIds.forEach((e) => added.add(e));
              if (u.barcodes?.length) {
                barcodes = { ...barcodes };
                for (const b of u.barcodes) {
                  if (b.before) barcodes[b.code] = b.before;
                  else delete barcodes[b.code];
                }
              }
            }
            return {
              items,
              shoppingList,
              barcodes,
              events: added.size ? s.events.filter((e) => !added.has(e.id)) : s.events,
              undo: linkChain(chain.filter((u) => !revert.has(u.id))),
            };
          });
          return revert.size;
        },
        clearUndo: (id) => {
          const chain = undoChain(get().undo);
          if (chain.length === 0) return;
          const drop = id === undefined ? chain[0].id : id;
          if (!chain.some((u) => u.id === drop)) return;
          set({ undo: linkChain(dropFromChain(chain, drop)) });
        },

        setStaple: (food, on) =>
          set((s) => {
            const has = s.staples.some((x) => sameStapleFood(x, food));
            if (on === has) return {};
            if (!on) return { staples: s.staples.filter((x) => !sameStapleFood(x, food)) };
            const entry: Staple = { id: uid(), name: food.name, foodTypeId: food.foodTypeId, addedAt: nowISO() };
            if (food.emoji) entry.emoji = food.emoji;
            return { staples: [...s.staples, entry] };
          }),

        setOverride: (o) =>
          set((s) => ({
            overrides: { ...s.overrides, [o.foodTypeId]: clampOverride({ ...s.overrides[o.foodTypeId], ...o }) },
          })),
        removeOverride: (foodTypeId) =>
          set((s) => {
            const next = { ...s.overrides };
            delete next[foodTypeId];
            return { overrides: next };
          }),
        setProfile: (p) => set((s) => ({ profile: { ...s.profile, ...p } })),
        setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
        addLocation: (name, kind, emoji) =>
          set((s) => ({ locations: [...s.locations, { id: uid(), name, kind, emoji }] })),
        removeLocation: (id) =>
          set((s) => {
            const loc = s.locations.find((l) => l.id === id);
            if (!loc || DEFAULT_LOCATIONS.some((d) => d.id === id)) return {};
            // Items in a removed spot fall back to the default location of the same kind.
            return {
              locations: s.locations.filter((l) => l.id !== id),
              items: s.items.map((i) => (i.locationId === id ? { ...i, locationId: loc.kind } : i)),
            };
          }),

        saveRecipe: (r) =>
          set((s) =>
            s.savedRecipes.some((x) => x.id === r.id)
              ? {}
              : { savedRecipes: [{ ...r, savedAt: nowISO() }, ...s.savedRecipes] },
          ),
        unsaveRecipe: (id) =>
          set((s) => {
            const saved = s.savedRecipes.find((r) => r.id === id);
            if (!saved) return {};
            // Planned meals keep a copy, so the plan can still open a recipe that is no longer saved.
            return {
              savedRecipes: s.savedRecipes.filter((r) => r.id !== id),
              mealPlan: s.mealPlan.some((m) => m.recipeId === id && !m.recipe)
                ? s.mealPlan.map((m) => (m.recipeId === id && !m.recipe ? { ...m, recipe: saved } : m))
                : s.mealPlan,
            };
          }),
        updateSavedRecipe: (id, patch) =>
          set((s) => ({ savedRecipes: s.savedRecipes.map((r) => (r.id === id ? { ...r, ...patch, id: r.id, savedAt: r.savedAt } : r)) })),

        addToList: (entries) =>
          set((s) => {
            const list = [...s.shoppingList];
            for (const e of entries) {
              const existing = list.find(
                (l) =>
                  !l.checked &&
                  ((e.foodTypeId && l.foodTypeId === e.foodTypeId) || l.name.toLowerCase() === e.name.toLowerCase()),
              );
              if (existing) {
                // The same recipe asking again (a second tap on "Add to list") shouldn't double it.
                if (e.recipeId && existing.recipeId === e.recipeId) continue;
                // Same thing again: add the amounts together when the units allow (1 egg + 2 eggs = 3).
                const sum = addAmounts(existing, e);
                if (sum) {
                  const i = list.indexOf(existing);
                  const note = joinNotes(existing.note, e.note);
                  list[i] = { ...existing, ...sum, ...(note ? { note } : {}) };
                  continue;
                }
                // Units that can't be added (1 bunch + 200 g): keep both rows rather than lose one.
              }
              const food = e.foodTypeId ? getFoodType(e.foodTypeId) : undefined;
              list.push({
                ...e,
                id: uid(),
                aisle: e.aisle ?? food?.aisle ?? "Other",
                checked: false,
                addedAt: nowISO(),
              });
            }
            return { shoppingList: list };
          }),
        toggleListItem: (id) =>
          set((s) => ({ shoppingList: s.shoppingList.map((l) => (l.id === id ? { ...l, checked: !l.checked } : l)) })),
        updateListItem: (id, patch) =>
          set((s) => ({ shoppingList: s.shoppingList.map((l) => (l.id === id ? { ...l, ...patch } : l)) })),
        removeListItem: (id) =>
          act("Removed from the list", (s) => ({ shoppingList: s.shoppingList.filter((l) => l.id !== id) })),
        clearChecked: () =>
          act("Cleared ticked items", (s) => ({ shoppingList: s.shoppingList.filter((l) => !l.checked) })),

        planMeal: (date, recipe, servings) =>
          set((s) => {
            const entry: MealPlanEntry = { id: uid(), date, recipeId: recipe.id };
            if (servings && servings > 0) entry.servings = Math.round(servings);
            // Anything not built in keeps a copy (saved ones too): it may be unsaved later, here or on
            // another device in the household. Built-in and saved recipes are still looked up first.
            if (!recipe.id.startsWith("builtin-")) entry.recipe = recipe;
            return { mealPlan: [...s.mealPlan, entry] };
          }),
        unplanMeal: (id) => set((s) => ({ mealPlan: s.mealPlan.filter((m) => m.id !== id) })),
        setPlanCooked: (id, cooked) =>
          set((s) => ({
            mealPlan: s.mealPlan.map((m) => (m.id === id ? { ...m, cookedAt: cooked ? nowISO() : undefined } : m)),
          })),

        resetAll: () => set({ ...initialData(), undo: null }),
        loadDemoData: () => {
          // Imported lazily so the demo set is not in every bundle.
          import("@/lib/demo").then(({ demoItems }) => {
            set((s) => ({ items: [...s.items, ...demoItems()] }));
          });
        },
      };
    },
    {
      name: STORAGE_KEY,
      version: 3,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { undo, ...rest } = s;
        return Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v !== "function"));
      },
      // v1 → v2: nothing renamed; fill anything missing (older saves, hand-edited imports).
      // v2 → v3: the meal planner became on by default, so switch it on once for existing households.
      migrate: (persisted, version) => {
        const next = normalisePersisted(persisted);
        if (version < 3) next.settings = { ...next.settings, mealPlannerEnabled: true };
        return next as unknown as LarderState;
      },
      // Deep-merge settings/profile so new defaults appear for existing households.
      merge: (persisted, current) => ({ ...current, ...normalisePersisted(persisted) }),
    },
  ),
);

let rehydratingFromOtherTab = false;

/**
 * True while the store is reloading what another tab saved. Sync uses it to tell those
 * changes (already queued by the tab that made them) from edits made here.
 */
export const isRehydratingFromOtherTab = () => rehydratingFromOtherTab;

// Another tab saved: pick up its changes so tabs don't overwrite each other.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    // localStorage is synchronous, so the state is replaced before rehydrate() returns.
    rehydratingFromOtherTab = true;
    try {
      void useLarder.persist.rehydrate();
    } finally {
      rehydratingFromOtherTab = false;
    }
  });
}
