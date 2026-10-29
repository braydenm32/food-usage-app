"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  Aisle,
  DraftItem,
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

interface UndoSnapshot {
  label: string;
  items: PantryItem[];
  events: ItemEvent[];
  shoppingList: ShoppingListItem[];
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
  /** Not persisted: last undoable action. */
  undo: UndoSnapshot | null;

  addItems: (drafts: DraftItem[], source: PantryItem["source"]) => PantryItem[];
  updateItem: (id: string, patch: Partial<PantryItem>) => void;
  openItem: (id: string) => void;
  moveItem: (id: string, locationId: string) => void;
  /** Mark some or all of an item used or binned. Removes it when nothing is left. */
  consumeItem: (id: string, quantity: number | "all", how: "used" | "binned") => void;
  deleteItem: (id: string) => void;
  cookRecipe: (recipe: Recipe, deductions: CookDeduction[]) => void;
  performUndo: () => void;
  clearUndo: () => void;

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

export const useLarder = create<LarderState>()(
  persist(
    (set, get) => {
      const snapshot = (label: string): UndoSnapshot => ({
        label,
        items: get().items,
        events: get().events,
        shoppingList: get().shoppingList,
      });

      return {
        ...initialData(),
        undo: null,

        addItems: (drafts, source) => {
          const created: PantryItem[] = drafts
            .filter((d) => d.include)
            .map((d) => ({
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
              frozenAt: get().locations.find((l) => l.id === d.locationId)?.kind === "freezer" ? nowISO() : undefined,
              source,
            }));
          set((s) => ({
            undo: snapshot(`Added ${created.length} item${created.length === 1 ? "" : "s"}`),
            items: [...s.items, ...created],
            events: [...s.events, ...created.map((i) => makeEvent(i, "added", { detail: source }))],
            // Ticking things off the list by adding them to the pantry.
            shoppingList: s.shoppingList.filter(
              (l) => !(l.checked && created.some((c) => c.foodTypeId && c.foodTypeId === l.foodTypeId)),
            ),
          }));
          return created;
        },

        updateItem: (id, patch) =>
          set((s) => ({
            items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
          })),

        openItem: (id) => {
          const item = get().items.find((i) => i.id === id);
          if (!item || item.openedAt) return;
          set((s) => ({
            undo: snapshot(`Marked ${item.name} opened`),
            items: s.items.map((i) => (i.id === id ? { ...i, openedAt: nowISO() } : i)),
            events: [...s.events, makeEvent(item, "opened")],
          }));
        },

        moveItem: (id, locationId) => {
          const { items, locations } = get();
          const item = items.find((i) => i.id === id);
          if (!item || item.locationId === locationId) return;
          const from = locations.find((l) => l.id === item.locationId);
          const to = locations.find((l) => l.id === locationId);
          const patch: Partial<PantryItem> = { locationId };
          if (to?.kind === "freezer") {
            patch.frozenAt = nowISO();
            patch.thawedAt = undefined;
          } else if (from?.kind === "freezer") {
            patch.thawedAt = nowISO();
          }
          set((s) => ({
            undo: snapshot(`Moved ${item.name} to ${to?.name ?? "new spot"}`),
            items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
            events: [...s.events, makeEvent(item, "moved", { detail: `${from?.name ?? "?"} → ${to?.name ?? "?"}` })],
          }));
        },

        consumeItem: (id, quantity, how) => {
          const item = get().items.find((i) => i.id === id);
          if (!item) return;
          const q = quantity === "all" ? item.quantity : Math.min(quantity, item.quantity);
          const remaining = Math.max(0, Math.round((item.quantity - q) * 1000) / 1000);
          const label =
            remaining === 0
              ? `${how === "used" ? "Used" : "Binned"} ${item.name}`
              : `${how === "used" ? "Used" : "Binned"} some ${item.name}`;
          set((s) => ({
            undo: snapshot(label),
            items:
              remaining === 0
                ? s.items.filter((i) => i.id !== id)
                : s.items.map((i) => (i.id === id ? { ...i, quantity: remaining, openedAt: i.openedAt ?? nowISO() } : i)),
            events: [...s.events, makeEvent(item, how, { quantity: q, unit: item.unit, value: valueOf(item, q) })],
          }));
        },

        deleteItem: (id) => {
          const item = get().items.find((i) => i.id === id);
          if (!item) return;
          set((s) => ({
            undo: snapshot(`Removed ${item.name}`),
            items: s.items.filter((i) => i.id !== id),
          }));
        },

        cookRecipe: (recipe, deductions) => {
          const before = snapshot(`Cooked ${recipe.title}`);
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
            else items[idx] = { ...item, quantity: remaining, openedAt: item.openedAt ?? nowISO() };
          }
          set((s) => ({ undo: before, items, events: [...s.events, ...events] }));
        },

        performUndo: () => {
          const u = get().undo;
          if (!u) return;
          set({ items: u.items, events: u.events, shoppingList: u.shoppingList, undo: null });
        },
        clearUndo: () => set({ undo: null }),

        setOverride: (o) => set((s) => ({ overrides: { ...s.overrides, [o.foodTypeId]: { ...s.overrides[o.foodTypeId], ...o } } })),
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
          set((s) => ({ undo: snapshot("Cleared ticked items"), shoppingList: s.shoppingList.filter((l) => !l.checked) })),

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
      name: "larder-v1",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { undo, ...rest } = s;
        return Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v !== "function"));
      },
    },
  ),
);
