/**
 * Builds a household's reminder digest from its synced records, for the push sender.
 * Pure (no IO), so it runs on the server and in tests. Uses the same shelf-life engine and
 * wording as the app, so a push says exactly what the Today screen would.
 */
import { buildDigest, type Digest } from "@/lib/reminders";
import type { ItemView } from "@/lib/selectors";
import { computeExpiry, parseLocalDate, STATUS_ORDER } from "@/lib/shelf-life/engine";
import { getFoodType } from "@/lib/shelf-life/foods";
import type { PantryItem, ShelfLifeOverride, StorageLocation } from "@/lib/types";
import { zonedDateISO } from "@/lib/push/schedule";

/** One synced row as the sender reads it from `household_records`. */
export interface RecordRow {
  collection: string;
  id: string;
  data: unknown;
}

/** The built-in spots (the store adds these too; ids match their kind). */
const BUILT_IN: StorageLocation[] = [
  { id: "fridge", name: "Fridge", kind: "fridge" },
  { id: "freezer", name: "Freezer", kind: "freezer" },
  { id: "pantry", name: "Pantry", kind: "pantry" },
];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const KINDS = new Set(["pantry", "fridge", "freezer"]);

function toItem(id: string, d: Record<string, unknown>): PantryItem | null {
  if (!isStr(d.name) || !isStr(d.addedAt) || Number.isNaN(new Date(d.addedAt).getTime())) return null;
  const quantity = typeof d.quantity === "number" ? d.quantity : 1;
  if (quantity <= 0) return null;
  return {
    ...(d as unknown as PantryItem),
    id,
    name: d.name,
    foodTypeId: isStr(d.foodTypeId) ? d.foodTypeId : null,
    locationId: isStr(d.locationId) ? d.locationId : "fridge",
    quantity,
    dateKind: d.dateKind === "best-before" ? "best-before" : "use-by",
    printedDate: isStr(d.printedDate) && /^\d{4}-\d{2}-\d{2}/.test(d.printedDate) ? d.printedDate : undefined,
  };
}

/** Sort the way the app does: most urgent first. */
function byUrgency(a: ItemView, b: ItemView): number {
  return (
    STATUS_ORDER[a.expiry.status] - STATUS_ORDER[b.expiry.status] ||
    a.expiry.daysLeft - b.expiry.daysLeft ||
    a.item.name.localeCompare(b.item.name)
  );
}

/**
 * Item views for a household on its local "today". The engine works in the runtime's local
 * calendar, so today's date in the household's zone is handed to it as a local midnight.
 * Timestamps such as `addedAt` are still read in the server's zone, which can shift an
 * estimate by a day for food added late at night; printed dates are exact.
 */
export function householdViews(rows: RecordRow[], opts: { useSoonDays: number; now: Date; timeZone: string }): ItemView[] {
  const locations = new Map(BUILT_IN.map((l) => [l.id, l]));
  const overrides = new Map<string, ShelfLifeOverride>();
  const items: PantryItem[] = [];
  for (const r of rows) {
    if (!isObj(r.data)) continue;
    if (r.collection === "locations" && isStr(r.data.name) && KINDS.has(r.data.kind as string)) {
      locations.set(r.id, { id: r.id, name: r.data.name, kind: r.data.kind as StorageLocation["kind"] });
    } else if (r.collection === "overrides") {
      overrides.set(r.id, { ...(r.data as unknown as ShelfLifeOverride), foodTypeId: r.id });
    } else if (r.collection === "items") {
      const item = toItem(r.id, r.data);
      if (item) items.push(item);
    }
  }
  const today = parseLocalDate(zonedDateISO(opts.now, opts.timeZone));
  return items
    .map((item) => {
      const food = getFoodType(item.foodTypeId);
      const location = locations.get(item.locationId) ?? BUILT_IN[0];
      const expiry = computeExpiry(item, {
        food,
        override: item.foodTypeId ? overrides.get(item.foodTypeId) : undefined,
        location,
        useSoonDays: opts.useSoonDays,
        now: today,
      });
      return { item, food, location, expiry };
    })
    .sort(byUrgency);
}

/** The digest to push, or null when nothing needs attention. */
export function householdDigest(rows: RecordRow[], opts: { useSoonDays: number; now: Date; timeZone: string }): Digest | null {
  return buildDigest(householdViews(rows, opts));
}
