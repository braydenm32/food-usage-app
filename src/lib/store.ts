"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  Aisle,
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
  mealPlannerEnabled: false,
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
  /** Not persisted: last undoable action. Toasts read `undo.id` when shown. */
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
  updateItem: (id: string, patch: Partial<PantryItem>) => void;
  openItem: (id: string) => void;
  moveItem: (id: string, locationId: string) => void;
  /** Mark some or all of an item used or binned. Removes it when nothing is left. */
  consumeItem: (id: string, quantity: number | "all", how: "used" | "binned") => void;
  /** Use or bin several whole items as one undoable step. */
  consumeMany: (ids: string[], how: "used" | "binned") => void;
  deleteItem: (id: string) => void;
  /** `leftovers` adds a new item in the same undo step (the cook sheet's "Save leftovers"). */
  cookRecipe: (recipe: Recipe, deductions: CookDeduction[], leftovers?: DraftItem) => void;
  /** Revert the last undoable action. With an id, only if it is still that action. */
  performUndo: (id?: string) => void;
  /** Forget the undo snapshot. With an id, only if it is still that action. */
  clearUndo: (id?: string) => void;

  setOverride: (o: ShelfLifeOverride) => void;
  removeOverride: (foodTypeId: string) => void;
  setProfile: (p: Partial<HouseholdProfile>) => void;
  setSettings: (s: Partial<Settings>) => void;
  addLocation: (name: string, kind: StorageLocation["kind"], emoji?: string) => void;
  removeLocation: (id: string) => void;

  saveRecipe: (r: Recipe) => void;
  unsaveRecipe: (id: string) => void;

  addToList: (entries: Array<Omit<ShoppingListItem, "id" | "checked" | "addedAt" | "aisle"> & { aisle?: Aisle }>) => void;
  toggleListItem: (id: string) => void;
  updateListItem: (id: string, patch: Partial<ShoppingListItem>) => void;
  removeListItem: (id: string) => void;
  clearChecked: () => void;

  planMeal: (date: string, recipe: Recipe) => void;
  unplanMeal: (id: string) => void;

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
  };
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
            .filter((d) => d.include)
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
              };
            });
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

        moveItem: (id, locationId) => {
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
          act(`Moved ${item.name} to ${to?.name ?? "new spot"}`, (s) => ({
            items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
            events: [
              ...s.events,
              makeEvent(item, "moved", { detail: `${from?.name ?? "?"} → ${to?.name ?? "?"}`, locationId }),
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
          const u = get().undo;
          if (!u || (id !== undefined && id !== u.id)) return;
          const added = new Set(u.eventIds);
          set((s) => ({
            items: revertById(s.items, u.items),
            shoppingList: revertById(s.shoppingList, u.list),
            events: added.size ? s.events.filter((e) => !added.has(e.id)) : s.events,
            undo: null,
          }));
        },
        clearUndo: (id) => {
          const u = get().undo;
          if (!u || (id !== undefined && id !== u.id)) return;
          set({ undo: null });
        },

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
        unsaveRecipe: (id) => set((s) => ({ savedRecipes: s.savedRecipes.filter((r) => r.id !== id) })),

        addToList: (entries) =>
          set((s) => {
            const list = [...s.shoppingList];
            for (const e of entries) {
              const existing = list.find(
                (l) =>
                  !l.checked &&
                  ((e.foodTypeId && l.foodTypeId === e.foodTypeId) || l.name.toLowerCase() === e.name.toLowerCase()),
              );
              if (existing) continue;
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
        removeListItem: (id) => set((s) => ({ shoppingList: s.shoppingList.filter((l) => l.id !== id) })),
        clearChecked: () =>
          act("Cleared ticked items", (s) => ({ shoppingList: s.shoppingList.filter((l) => !l.checked) })),

        planMeal: (date, recipe) =>
          set((s) => ({
            mealPlan: [...s.mealPlan, { id: uid(), date, recipeId: recipe.id }],
            savedRecipes: s.savedRecipes.some((r) => r.id === recipe.id)
              ? s.savedRecipes
              : [{ ...recipe, savedAt: nowISO() }, ...s.savedRecipes],
          })),
        unplanMeal: (id) => set((s) => ({ mealPlan: s.mealPlan.filter((m) => m.id !== id) })),

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
      version: 2,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { undo, ...rest } = s;
        return Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v !== "function"));
      },
      // v1 → v2: nothing renamed; fill anything missing (older saves, hand-edited imports).
      migrate: (persisted) => normalisePersisted(persisted) as unknown as LarderState,
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
