/**
 * Which parts of the store sync, and how each maps to one-row-per-record in
 * `household_records`. Pure: no IO, no React, safe to unit test.
 *
 * - Array collections (items, events, locations, savedRecipes, shoppingList, mealPlan) use each
 *   record's `id`.
 * - `overrides` is a record keyed by foodTypeId, so the key is the row id.
 * - `profile` is a singleton stored as the row id "profile".
 * - `settings` is per device and never syncs.
 */
import { DEFAULT_LOCATIONS, DEFAULT_PROFILE, MAX_EVENTS, type LarderState } from "@/lib/store";
import type {
  Aisle,
  HouseholdProfile,
  ItemEvent,
  MealPlanEntry,
  PantryItem,
  Recipe,
  RecipeIngredient,
  ShelfLifeOverride,
  ShoppingListItem,
  StorageLocation,
  Unit,
} from "@/lib/types";

export const SYNCED_COLLECTIONS = [
  "items",
  "events",
  "locations",
  "overrides",
  "profile",
  "savedRecipes",
  "shoppingList",
  "mealPlan",
] as const;

export type CollectionName = (typeof SYNCED_COLLECTIONS)[number];
export type SyncedState = Pick<LarderState, CollectionName>;

export const PROFILE_ID = "profile";

/** Longest id the table accepts (check constraint). Longer ids can't sync. */
export const MAX_ID_LENGTH = 100;

const ARRAY_COLLECTIONS = new Set<CollectionName>(["items", "events", "locations", "savedRecipes", "shoppingList", "mealPlan"]);

export const isCollection = (c: string): c is CollectionName => (SYNCED_COLLECTIONS as readonly string[]).includes(c);

/** Key used in the outbox and in sets of seen records. */
export const recordKey = (collection: CollectionName, id: string) => `${collection}:${id}`;

/** Every record of one collection, by id. */
export function recordsOf(state: SyncedState, collection: CollectionName): Map<string, unknown> {
  if (collection === "profile") return new Map([[PROFILE_ID, state.profile]]);
  if (collection === "overrides") return new Map(Object.entries(state.overrides));
  const list = state[collection] as Array<{ id: string }>;
  return new Map(list.map((r) => [r.id, r]));
}

/** One record by id, or undefined when it no longer exists locally. */
export function getRecord(state: SyncedState, collection: CollectionName, id: string): unknown {
  if (collection === "profile") return id === PROFILE_ID ? state.profile : undefined;
  if (collection === "overrides") return Object.prototype.hasOwnProperty.call(state.overrides, id) ? state.overrides[id] : undefined;
  return (state[collection] as Array<{ id: string }>).find((r) => r.id === id);
}

/**
 * Same record? Reference equality first (the store replaces only what changed); JSON as a
 * fallback, because rehydrating from another tab or a backup rebuilds every object.
 */
export function sameRecord(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Fresh, empty values for the synced collections (used by "Start fresh with the household's food"). */
export function emptySynced(): SyncedState {
  return {
    items: [],
    events: [],
    locations: DEFAULT_LOCATIONS,
    overrides: {},
    profile: DEFAULT_PROFILE,
    savedRecipes: [],
    shoppingList: [],
    mealPlan: [],
  };
}

/* ---------- Validating records from the server ---------- */
// Anyone in the household can write any row, so everything pulled is checked before it reaches
// the store. A record missing a required field (or with the wrong type) is skipped; optional
// fields with the wrong type are dropped. One bad row then costs one record, not the app.

/** Ids that would reach Object.prototype if used as a plain-object key. */
const UNSAFE_IDS = new Set(["__proto__", "constructor", "prototype"]);

/** An id this device will accept from the server. */
export const isSafeId = (id: unknown): id is string =>
  typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LENGTH && !UNSAFE_IDS.has(id);

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isDate = (v: unknown): v is string => isStr(v) && v.length <= 40 && !Number.isNaN(Date.parse(v));
const oneOf =
  <T extends string>(...values: T[]) =>
  (v: unknown): v is T =>
    (values as unknown[]).includes(v);
const isWebUrl = (v: unknown): v is string => isStr(v) && /^https?:\/\//i.test(v);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isStr) : []);

/** Copy only the fields that pass their check; missing or wrong fields are left out. */
function pick(data: Obj, checks: Record<string, (v: unknown) => boolean>): Obj {
  const out: Obj = {};
  for (const [k, ok] of Object.entries(checks)) if (data[k] !== undefined && ok(data[k])) out[k] = data[k];
  return out;
}

const isDateKind = oneOf("use-by", "best-before");
const isItemSource = oneOf("receipt", "list", "barcode", "manual", "order");
const isEventType = oneOf("added", "opened", "moved", "used", "binned", "edited", "cooked");
const isLocationKind = oneOf("pantry", "fridge", "freezer");
const isRecipeSource = oneOf("ai", "database", "saved", "builtin");
const isListReason = oneOf("manual", "recipe", "staple", "plan");
const isDiet = oneOf("vegetarian", "vegan", "pescatarian", "gluten-free", "dairy-free", "low-carb", "halal", "kosher");
const isDays = (v: unknown) => v === null || (isNum(v) && v >= 0);
const foodTypeIdOf = (v: unknown) => (isStr(v) ? v : null);

function parseItem(id: string, d: Obj): PantryItem | null {
  if (!isStr(d.name) || !isStr(d.locationId) || !isNum(d.quantity) || !isStr(d.unit)) return null;
  if (!isDate(d.addedAt) || !isDateKind(d.dateKind) || !isItemSource(d.source)) return null;
  return {
    ...pick(d, {
      price: isNum,
      printedDate: isDate,
      openedAt: isDate,
      frozenAt: isDate,
      thawedAt: isDate,
      expiredWhenFrozen: (v) => typeof v === "boolean",
      barcode: isStr,
      notes: isStr,
    }),
    id,
    name: d.name,
    foodTypeId: foodTypeIdOf(d.foodTypeId),
    emoji: isStr(d.emoji) ? d.emoji : "🍽️",
    locationId: d.locationId,
    quantity: d.quantity,
    initialQuantity: isNum(d.initialQuantity) ? d.initialQuantity : d.quantity,
    unit: d.unit as Unit,
    addedAt: d.addedAt,
    dateKind: d.dateKind,
    source: d.source,
  };
}

function parseEvent(id: string, d: Obj): ItemEvent | null {
  if (!isStr(d.itemId) || !isStr(d.itemName) || !isEventType(d.type) || !isDate(d.at)) return null;
  return {
    ...pick(d, { quantity: isNum, unit: isStr, value: isNum, detail: isStr, locationId: isStr }),
    id,
    itemId: d.itemId,
    itemName: d.itemName,
    foodTypeId: foodTypeIdOf(d.foodTypeId),
    type: d.type,
    at: d.at,
  };
}

function parseLocation(id: string, d: Obj): StorageLocation | null {
  if (!isStr(d.name) || !isLocationKind(d.kind)) return null;
  return { ...pick(d, { emoji: isStr }), id, name: d.name, kind: d.kind };
}

function parseOverride(id: string, d: Obj): ShelfLifeOverride {
  return { ...pick(d, { pantryDays: isDays, fridgeDays: isDays, freezerDays: isDays, openedDays: isDays }), foodTypeId: id };
}

function parseProfile(d: Obj): HouseholdProfile {
  return {
    householdName: isStr(d.householdName) ? d.householdName : DEFAULT_PROFILE.householdName,
    people: isNum(d.people) && d.people >= 1 ? Math.round(d.people) : DEFAULT_PROFILE.people,
    diets: Array.isArray(d.diets) ? d.diets.filter(isDiet) : [],
    allergies: strArr(d.allergies),
    likes: strArr(d.likes),
    dislikes: strArr(d.dislikes),
  };
}

function parseIngredient(v: unknown): RecipeIngredient | null {
  if (!isObj(v) || !isStr(v.name)) return null;
  return {
    ...pick(v, { quantity: isNum, unit: isStr, foodTypeId: (x) => x === null || isStr(x), optional: (x) => typeof x === "boolean" }),
    name: v.name,
  };
}

function parseRecipe(id: string, d: Obj): Recipe | null {
  if (!isStr(d.title) || !isRecipeSource(d.source) || !isNum(d.servings)) return null;
  if (!Array.isArray(d.ingredients) || !Array.isArray(d.steps)) return null;
  return {
    ...pick(d, { sourceUrl: isWebUrl, image: isWebUrl, minutes: isNum, summary: isStr, savedAt: isDate }),
    id,
    title: d.title,
    source: d.source,
    servings: d.servings,
    ingredients: d.ingredients.map(parseIngredient).filter((x): x is RecipeIngredient => x !== null),
    steps: strArr(d.steps),
    tags: strArr(d.tags),
  };
}

function parseListItem(id: string, d: Obj): ShoppingListItem | null {
  if (!isStr(d.name) || typeof d.checked !== "boolean" || !isDate(d.addedAt)) return null;
  return {
    ...pick(d, { quantity: isNum, unit: isStr, reason: isListReason, recipeId: isStr }),
    id,
    name: d.name,
    foodTypeId: foodTypeIdOf(d.foodTypeId),
    // The list groups unknown aisles under "Other".
    aisle: (isStr(d.aisle) ? d.aisle : "Other") as Aisle,
    checked: d.checked,
    addedAt: d.addedAt,
  };
}

function parseMealPlan(id: string, d: Obj): MealPlanEntry | null {
  if (!isDate(d.date) || !isStr(d.recipeId)) return null;
  return { ...pick(d, { servings: isNum }), id, date: d.date, recipeId: d.recipeId };
}

/** Validate and tidy a record from the server. Returns null for anything unusable. */
export function parseIncoming(collection: CollectionName, id: string, data: unknown): unknown | null {
  if (!isSafeId(id) || !isObj(data)) return null;
  switch (collection) {
    case "items":
      return parseItem(id, data);
    case "events":
      return parseEvent(id, data);
    case "locations":
      return parseLocation(id, data);
    case "overrides":
      return parseOverride(id, data);
    case "profile":
      // One profile per household; any other id is junk.
      return id === PROFILE_ID ? parseProfile(data) : null;
    case "savedRecipes":
      return parseRecipe(id, data);
    case "shoppingList":
      return parseListItem(id, data);
    case "mealPlan":
      return parseMealPlan(id, data);
    default:
      return null;
  }
}

/** Put incoming records in a sensible order after a remote apply. */
function order(collection: CollectionName, list: Array<{ id: string }>): Array<{ id: string }> {
  if (collection === "events") {
    const sorted = [...list].sort((a, b) => String((a as { at?: string }).at ?? "").localeCompare(String((b as { at?: string }).at ?? "")));
    return sorted.length > MAX_EVENTS ? sorted.slice(-MAX_EVENTS) : sorted;
  }
  if (collection === "savedRecipes") {
    return [...list].sort((a, b) =>
      String((b as { savedAt?: string }).savedAt ?? "").localeCompare(String((a as { savedAt?: string }).savedAt ?? "")),
    );
  }
  if (collection === "locations") {
    // The built-in spots always exist (the store relies on them).
    const missing = DEFAULT_LOCATIONS.filter((d) => !list.some((l) => l.id === d.id));
    return [...missing, ...list];
  }
  return list;
}

/** A change to one record: the new value, or null to remove it. */
export interface RecordChange {
  id: string;
  value: unknown | null;
}

/**
 * Apply a batch of record changes to one collection. Existing records keep their place,
 * new ones go on the end (then the collection's own order rules apply).
 */
export function applyToCollection(state: SyncedState, collection: CollectionName, changes: RecordChange[]): Partial<SyncedState> {
  if (changes.length === 0) return {};
  if (collection === "profile") {
    const last = changes[changes.length - 1];
    // The profile can't be removed; a deleted row means "back to defaults".
    return { profile: (last.value as HouseholdProfile | null) ?? DEFAULT_PROFILE };
  }
  if (collection === "overrides") {
    // No prototype: a key can never reach Object.prototype (ids are checked as well).
    const next: Record<string, ShelfLifeOverride> = Object.assign(Object.create(null), state.overrides);
    for (const c of changes) {
      if (!isSafeId(c.id)) continue;
      if (c.value === null) delete next[c.id];
      else next[c.id] = c.value as ShelfLifeOverride;
    }
    return { overrides: next };
  }
  if (!ARRAY_COLLECTIONS.has(collection)) return {};
  const list = [...(state[collection] as Array<{ id: string }>)];
  const index = new Map(list.map((r, i) => [r.id, i]));
  const removed = new Set<string>();
  for (const c of changes) {
    const i = index.get(c.id);
    if (c.value === null) {
      if (i !== undefined) removed.add(c.id);
      continue;
    }
    removed.delete(c.id);
    if (i !== undefined) list[i] = c.value as { id: string };
    else {
      index.set(c.id, list.length);
      list.push(c.value as { id: string });
    }
  }
  const kept = removed.size ? list.filter((r) => !removed.has(r.id)) : list;
  return { [collection]: order(collection, kept) } as Partial<SyncedState>;
}
