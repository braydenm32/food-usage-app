"use client";

import { z } from "zod";
import { getSupabase } from "@/lib/supabase/client";
import { syncStatusStore } from "@/lib/sync/status";
import { useLarder } from "@/lib/store";
import { isSafeId } from "@/lib/sync/collections";
import { webUrl } from "@/lib/web-url";
import { useMealLog, type MealEntry, type Target } from "@/lib/nutrition/meal-log";
import { NUTRIENTS, type NutrientKey } from "@/lib/nutrition/nutrients";
import type { Staple } from "@/lib/types";

/**
 * Parts of a backup that live outside the main larder snapshot: the household's staples and
 * this device's meal log (meals, daily targets, pinned nutrients).
 *
 * Settings → "Export a copy" adds `extras: getBackupExtras()` beside `state`, and Import calls
 * `applyBackupExtras(file.extras)` after restoring the larder. Old backups have no `extras`,
 * which leaves the current staples and meal log as they are.
 */
export interface BackupExtras {
  staples: Staple[];
  mealLog: {
    meals: MealEntry[];
    targets: Partial<Record<NutrientKey, Target>>;
    pinned: NutrientKey[];
  };
}

export function getBackupExtras(): BackupExtras {
  const m = useMealLog.getState();
  return {
    staples: useLarder.getState().staples,
    mealLog: { meals: m.meals, targets: m.targets, pinned: m.pinned },
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const NUTRIENT_KEYS = new Set<string>(NUTRIENTS.map((n) => n.key));

/** Caps on how much one backup may hold. Far above real use, far below what could hang the page. */
export const BACKUP_LIMITS = {
  bytes: 20 * 1024 * 1024,
  items: 20_000,
  events: 5_000,
  recipes: 2_000,
  locations: 200,
  overrides: 2_000,
  shoppingList: 5_000,
  mealPlan: 5_000,
  staples: 2_000,
  meals: 5_000,
  tags: 200,
} as const;

/** `{ [nutrient]: finite number }` with only known nutrient keys. */
function cleanNutrients(v: unknown): Record<string, number> | null {
  if (!isObj(v)) return null;
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) {
    if (!NUTRIENT_KEYS.has(k) || !isNum(n)) return null;
    out[k] = n;
  }
  return out;
}

function cleanTarget(v: unknown): Target | null {
  if (!isObj(v)) return null;
  const out: Target = {};
  for (const k of ["min", "goal", "max"] as const) {
    if (v[k] === undefined) continue;
    if (!isNum(v[k])) return null;
    out[k] = v[k] as number;
  }
  return out;
}

const isoOk = (v: unknown) => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

/**
 * Restore staples and the meal log from a backup's `extras`. Anything missing or malformed is
 * skipped rather than wiping what's here. Returns what was restored, for the toast.
 */
export function applyBackupExtras(raw: unknown): { staples: number; meals: number } {
  const out = { staples: 0, meals: 0 };
  if (!isObj(raw)) return out;

  if (Array.isArray(raw.staples) && raw.staples.length <= BACKUP_LIMITS.staples) {
    const staples = raw.staples
      .filter((s): s is Staple => isObj(s) && isSafeId(s.id) && typeof s.name === "string" && s.name.length <= 300)
      .map((s) => ({ ...s, foodTypeId: typeof s.foodTypeId === "string" ? s.foodTypeId : null }));
    useLarder.setState({ staples });
    out.staples = staples.length;
  }

  const log = raw.mealLog;
  if (isObj(log)) {
    const patch: Partial<BackupExtras["mealLog"]> = {};
    if (Array.isArray(log.meals) && log.meals.length <= BACKUP_LIMITS.meals) {
      patch.meals = log.meals
        .map((m) => {
          if (!isObj(m) || !isSafeId(m.id) || !isoOk(m.at) || typeof m.date !== "string" || m.date.length > 40) return null;
          if (typeof m.title !== "string" || m.title.length > 300) return null;
          const perServing = cleanNutrients(m.perServing);
          if (!perServing) return null;
          const entry: MealEntry = {
            ...(m as unknown as MealEntry),
            perServing,
            servings: isNum(m.servings) && m.servings > 0 ? m.servings : 1,
          };
          if (Array.isArray(m.contributors)) {
            entry.contributors = m.contributors.flatMap((c) => {
              const n = isObj(c) && typeof c.name === "string" ? cleanNutrients(c.n) : null;
              return n ? [{ name: (c as { name: string }).name, n }] : [];
            });
          } else {
            delete entry.contributors;
          }
          return entry;
        })
        .filter((m): m is MealEntry => m !== null);
      out.meals = patch.meals.length;
    }
    if (isObj(log.targets)) {
      const targets: BackupExtras["mealLog"]["targets"] = {};
      for (const [k, t] of Object.entries(log.targets)) {
        const clean = NUTRIENT_KEYS.has(k) ? cleanTarget(t) : null;
        if (clean) targets[k as NutrientKey] = clean;
      }
      patch.targets = targets;
    }
    if (Array.isArray(log.pinned)) {
      patch.pinned = log.pinned.filter((k): k is NutrientKey => typeof k === "string" && NUTRIENT_KEYS.has(k)).slice(0, 50);
    }
    if (Object.keys(patch).length) useMealLog.setState(patch);
  }
  return out;
}

/* ---------- Reading a backup file ---------- */

/*
 * A backup is the user's own data, often years old (recipes saved from TheMealDB long ago can
 * have a link without "https://" or an empty image). So cosmetic problems are tidied rather than
 * refused: odd links are dropped, long text is cut short, numbers are kept in range, and a row
 * that can't be used at all is left out. What stays strict: the file size, how many rows each
 * list may have, and ids that could reach object prototypes (those mean the file was made to
 * cause trouble, so nothing is restored).
 */

/** Largest number restored for a quantity or price. */
const MAX_AMOUNT = 1_000_000;

const UNSAFE_ID = "unsafe id";
const safeId = z.string().refine(isSafeId, UNSAFE_ID);
/** A string cut to `max` characters. */
const text = (max: number) => z.string().transform((v) => v.slice(0, max));
/** Optional text: cut short, or left out when it isn't text. */
const textOpt = (max: number) => text(max).nullish().catch(undefined);
const iso = z.string().max(40).refine((v) => !Number.isNaN(Date.parse(v)), "not a date");
/** Optional date: left out when it isn't one. */
const isoOpt = iso.nullish().catch(undefined);
const num = z.number(); // zod 4 rejects NaN and Infinity
const amount = num.transform((n) => Math.min(Math.max(n, 0), MAX_AMOUNT));
const numOpt = num.nullish().catch(undefined);
const amountOpt = amount.nullish().catch(undefined);
/** Only plain http(s) links are kept; anything else (schemeless, empty, javascript:) is dropped. */
const httpUrl = z
  .unknown()
  .optional()
  .transform((v) => (typeof v === "string" && v.length <= 2000 ? webUrl(v) : undefined));
/** Text tags: non-text dropped, each cut to 100 characters. The count stays a hard cap. */
const tags = z
  .array(z.unknown())
  .max(BACKUP_LIMITS.tags)
  .transform((a) => a.filter((t): t is string => typeof t === "string").map((t) => t.slice(0, 100)))
  .default([]);

/**
 * A list of rows, at most `max` of them (more refuses the file). A row with an unsafe id refuses
 * the file too; any other row that doesn't fit `row` is left out.
 */
function rows<T extends z.ZodType>(row: T, max: number) {
  return z
    .array(z.unknown())
    .max(max)
    .transform((list, ctx) => {
      const out: z.output<T>[] = [];
      for (const r of list) {
        if (isObj(r) && typeof r.id === "string" && !isSafeId(r.id)) {
          ctx.addIssue({ code: "custom", message: UNSAFE_ID });
          return z.NEVER;
        }
        const parsed = row.safeParse(r);
        if (parsed.success) out.push(parsed.data);
      }
      return out;
    });
}

/**
 * Shape check for a backup. Only `items` is required; everything else is optional and gets
 * defaults here, then `normalisePersisted` fills in profile arrays, settings and the built-in spots.
 */
export const importSchema = z.object({
  items: rows(
    z
      .object({
        id: safeId,
        name: text(300),
        locationId: text(100),
        quantity: amount,
        initialQuantity: amountOpt,
        price: amountOpt,
        addedAt: isoOpt,
        printedDate: isoOpt,
        openedAt: isoOpt,
        frozenAt: isoOpt,
        thawedAt: isoOpt,
        notes: textOpt(2000),
      })
      .loose(),
    BACKUP_LIMITS.items,
  ),
  events: rows(z.object({ id: safeId, type: text(40), at: iso, quantity: numOpt, value: numOpt }).loose(), BACKUP_LIMITS.events).default([]),
  locations: rows(
    z.object({ id: safeId, name: text(100), kind: z.enum(["pantry", "fridge", "freezer"]) }).loose(),
    BACKUP_LIMITS.locations,
  ).default([]),
  overrides: z
    .record(z.string(), z.unknown())
    .refine((o) => Object.keys(o).length <= BACKUP_LIMITS.overrides, "too many overrides")
    .transform((o) => {
      // Keys were checked on the raw object (parseBackupText). A bad entry is left out.
      const entry = z.object({ foodTypeId: text(100) }).loose();
      const out: Record<string, z.output<typeof entry>> = {};
      for (const [k, v] of Object.entries(o)) {
        const parsed = entry.safeParse(v);
        if (parsed.success) out[k] = parsed.data;
      }
      return out;
    })
    .default({}),
  profile: z
    .object({
      householdName: textOpt(200),
      people: num.optional().catch(undefined),
      diets: tags,
      allergies: tags,
      likes: tags,
      dislikes: tags,
    })
    .loose()
    .default({ diets: [], allergies: [], likes: [], dislikes: [] }),
  settings: z
    .object({
      theme: z.enum(["system", "light", "dark"]).optional().catch(undefined),
      digest: z.enum(["off", "daily", "weekly"]).optional().catch(undefined),
    })
    .loose()
    .default({}),
  savedRecipes: rows(
    z
      .object({
        id: safeId,
        title: text(300),
        ingredients: z.array(z.any()).max(500),
        steps: z.array(z.any()).max(500).optional().catch(undefined),
        sourceUrl: httpUrl,
        image: httpUrl,
      })
      .loose(),
    BACKUP_LIMITS.recipes,
  ).default([]),
  shoppingList: rows(
    z.object({ id: safeId, name: text(300), checked: z.boolean().catch(false) }).loose(),
    BACKUP_LIMITS.shoppingList,
  ).default([]),
  mealPlan: rows(z.object({ id: safeId, date: z.string().max(40), recipeId: z.string().max(100) }).loose(), BACKUP_LIMITS.mealPlan).default([]),
  // Optional: older backups have no staples, and then the current ones are kept.
  staples: rows(z.object({ id: safeId, name: text(300) }).loose(), BACKUP_LIMITS.staples).optional(),
});

export type ParsedBackup = { data: z.infer<typeof importSchema>; exportedAt?: string; extras?: unknown };

/** Why a backup file was refused, in words fit for a toast. */
export type BackupResult = { ok: true; backup: ParsedBackup } | { ok: false; message: string };

const NOT_A_BACKUP = "That file isn't a Larder backup, so nothing was changed.";

/**
 * Check a backup's text and shape without touching the store. Never throws: a hostile or broken
 * file gives `{ ok: false }` with a friendly message and the caller changes nothing.
 */
export function parseBackupText(textContent: string): BackupResult {
  try {
    if (textContent.length > BACKUP_LIMITS.bytes) {
      return { ok: false, message: "That file is too big to be a Larder backup (over 20 MB), so nothing was changed." };
    }
    const raw: unknown = JSON.parse(textContent);
    // Accept our export, or a raw zustand persist blob.
    const candidate = isObj(raw) && "state" in raw ? raw.state : raw;
    // Keys of `overrides` become property names, so check them on the raw object (a schema may skip them).
    if (isObj(candidate) && isObj(candidate.overrides) && !Object.keys(candidate.overrides).every(isSafeId)) {
      return { ok: false, message: NOT_A_BACKUP };
    }
    const parsed = importSchema.safeParse(candidate);
    if (!parsed.success) return { ok: false, message: NOT_A_BACKUP };
    const extras = isObj(raw) ? raw.extras : undefined;
    if (extras !== undefined && !extrasWithinLimits(extras)) {
      return { ok: false, message: "That backup has more history than Larder can restore, so nothing was changed." };
    }
    const exportedAt = isObj(raw) && typeof raw.exportedAt === "string" && isoOk(raw.exportedAt) ? raw.exportedAt : undefined;
    return { ok: true, backup: { data: parsed.data, exportedAt, extras } };
  } catch {
    return { ok: false, message: "Couldn't read that file. It should be a .json export from Larder, so nothing was changed." };
  }
}

function extrasWithinLimits(extras: unknown): boolean {
  if (!isObj(extras)) return true;
  if (Array.isArray(extras.staples) && extras.staples.length > BACKUP_LIMITS.staples) return false;
  const log = extras.mealLog;
  if (isObj(log) && Array.isArray(log.meals) && log.meals.length > BACKUP_LIMITS.meals) return false;
  return true;
}

/* ---------- Account section of an export (APP 12) ---------- */

export interface AccountExport {
  email: string | null;
  userId: string;
  memberships: Array<Record<string, unknown>>;
  /** This account's reminder subscriptions. The browser's private push keys are left out. */
  pushSubscriptions: Array<Record<string, unknown>>;
}

/** How long Export waits for the account section before going ahead without it. */
export const ACCOUNT_EXPORT_TIMEOUT = 4000;

/**
 * What the server holds about this account, read with the user's own session (row-level rules
 * only allow their own rows). Returns null when signed out, offline, slow (over ~4 s), or
 * anything fails, so an export always still works.
 */
export async function getAccountExport(timeoutMs = ACCOUNT_EXPORT_TIMEOUT): Promise<AccountExport | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([readAccountExport(), late]);
  } finally {
    clearTimeout(timer);
  }
}

async function readAccountExport(): Promise<AccountExport | null> {
  try {
    const { userId, email } = syncStatusStore.getState();
    const supabase = getSupabase();
    if (!userId || !supabase) return null;
    const [members, subs] = await Promise.all([
      supabase.from("household_members").select("household_id, display_name, role, joined_at").eq("user_id", userId),
      supabase
        .from("push_subscriptions")
        .select("household_id, endpoint, cadence, hour, weekday, time_zone, use_soon_days, created_at, updated_at, last_sent_at")
        .eq("user_id", userId),
    ]);
    if (members.error || subs.error) return null;
    return { email, userId, memberships: members.data ?? [], pushSubscriptions: subs.data ?? [] };
  } catch {
    return null;
  }
}
