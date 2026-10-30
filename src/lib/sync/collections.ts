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
import type { HouseholdProfile, ShelfLifeOverride } from "@/lib/types";

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

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);

/** Validate and tidy a record from the server. Returns null for anything unusable. */
export function parseIncoming(collection: CollectionName, id: string, data: unknown): unknown | null {
  if (!isObj(data)) return null;
  if (collection === "profile") {
    return {
      ...DEFAULT_PROFILE,
      ...data,
      diets: strArr(data.diets),
      allergies: strArr(data.allergies),
      likes: strArr(data.likes),
      dislikes: strArr(data.dislikes),
    } as HouseholdProfile;
  }
  if (collection === "overrides") return { ...data, foodTypeId: id } as ShelfLifeOverride;
  // Array records: the row id is the record id.
  return { ...data, id };
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
    const next = { ...state.overrides };
    for (const c of changes) {
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
