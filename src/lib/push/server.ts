import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import webpush, { WebPushError, type PushSubscription } from "web-push";
import type { Database } from "@/lib/supabase/database.types";
import type { Digest } from "@/lib/reminders";
import { householdDigest, type RecordRow } from "@/lib/push/digest";
import { isDue, isValidTimeZone, type Cadence } from "@/lib/push/schedule";
import { isAllowedPushEndpoint } from "@/lib/push/endpoint";

/**
 * Sends reminder digests as Web Push notifications. Runs on the server only, with the
 * Supabase service-role key (to read every household's subscriptions and food) and the
 * VAPID private key (to sign pushes). Called hourly by the cron route.
 */

type Admin = SupabaseClient<Database>;
type SubscriptionRow = Database["public"]["Tables"]["push_subscriptions"]["Row"];

export interface PushConfig {
  supabaseUrl: string;
  serviceKey: string;
  vapidPublic: string;
  vapidPrivate: string;
  vapidSubject: string;
}

/** What's missing, by env var name, so the route can say so. Empty when push can run. */
export function missingPushEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const needed = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
  ];
  return needed.filter((k) => !env[k]);
}

export function pushConfig(env: NodeJS.ProcessEnv = process.env): PushConfig | null {
  if (missingPushEnv(env).length) return null;
  return {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceKey: env.SUPABASE_SERVICE_ROLE_KEY!,
    vapidPublic: env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    vapidPrivate: env.VAPID_PRIVATE_KEY!,
    vapidSubject: env.VAPID_SUBJECT!,
  };
}

export function adminClient(cfg: PushConfig): Admin {
  return createClient<Database>(cfg.supabaseUrl, cfg.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Drop a subscription after this many failed sends in a row (other than "gone"). */
const MAX_FAILURES = 5;
/** Pushes not delivered within this time are dropped by the push service. */
const TTL_SECONDS = 6 * 60 * 60;
const PAGE = 1000;
const CONCURRENCY = 8;
/** Give up on one push service request after this long, so one slow host can't stall the run. */
const SEND_TIMEOUT_MS = 10_000;

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export function digestPayload(d: Digest): PushPayload {
  return { title: d.title, body: d.body, url: d.url, tag: "larder-digest" };
}

type SendResult = "sent" | "gone" | "failed";

export async function sendPush(cfg: PushConfig, row: Pick<SubscriptionRow, "endpoint" | "p256dh" | "auth">, payload: PushPayload): Promise<SendResult> {
  // Never post anywhere but a browser push service (the row could have been written by anyone signed in).
  if (!isAllowedPushEndpoint(row.endpoint)) return "gone";
  const sub: PushSubscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload), {
      TTL: TTL_SECONDS,
      timeout: SEND_TIMEOUT_MS,
      urgency: "normal",
      topic: payload.tag,
      vapidDetails: { subject: cfg.vapidSubject, publicKey: cfg.vapidPublic, privateKey: cfg.vapidPrivate },
    });
    return "sent";
  } catch (e) {
    // 404/410: the browser unsubscribed or the subscription expired.
    if (e instanceof WebPushError && (e.statusCode === 404 || e.statusCode === 410)) return "gone";
    return "failed";
  }
}

async function allSubscriptions(db: Admin): Promise<SubscriptionRow[]> {
  const out: SubscriptionRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("push_subscriptions").select("*").order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`Couldn't read push subscriptions: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/** The household's live food, spots and overrides. */
export async function householdRows(db: Admin, householdId: string): Promise<RecordRow[]> {
  const out: RecordRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("household_records")
      .select("collection, id, data")
      .eq("household_id", householdId)
      .eq("deleted", false)
      .in("collection", ["items", "locations", "overrides"])
      .order("seq")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Couldn't read household food: ${error.message}`);
    out.push(...((data ?? []) as RecordRow[]));
    if (!data || data.length < PAGE) return out;
  }
}

export function scheduleOf(row: Pick<SubscriptionRow, "cadence" | "hour" | "weekday" | "time_zone">) {
  return {
    cadence: (row.cadence === "weekly" ? "weekly" : "daily") as Cadence,
    hour: row.hour,
    weekday: row.weekday,
    timeZone: isValidTimeZone(row.time_zone) ? row.time_zone : "Australia/Sydney",
  };
}

/** Run `fn` over `list` with at most `n` at a time. */
async function pool<T>(list: T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(n, list.length) }, async () => {
    while (next < list.length) await fn(list[next++]);
  });
  await Promise.all(workers);
}

export interface SendSummary {
  checked: number;
  due: number;
  sent: number;
  /** Due, but nothing in the larder needed attention. */
  quiet: number;
  removed: number;
  failed: number;
  /** Due, but another run already claimed it. */
  skipped: number;
}

/**
 * Mark a due subscription as sent for this slot, only if no other run got there first.
 * True when this run owns the send.
 */
async function claim(db: Admin, s: SubscriptionRow, now: Date): Promise<boolean> {
  const q = db.from("push_subscriptions").update({ last_sent_at: now.toISOString() }).eq("id", s.id);
  const { data, error } = await (s.last_sent_at === null ? q.is("last_sent_at", null) : q.eq("last_sent_at", s.last_sent_at)).select("id");
  return !error && (data?.length ?? 0) > 0;
}

/** Send every digest that's due now. Safe to run more often than hourly: each slot sends once. */
export async function sendDueDigests(cfg: PushConfig, now: Date = new Date()): Promise<SendSummary> {
  const db = adminClient(cfg);
  const subs = await allSubscriptions(db);
  const due = subs.filter((s) => isDue(now, scheduleOf(s), s.last_sent_at ?? s.created_at));
  const summary: SendSummary = { checked: subs.length, due: due.length, sent: 0, quiet: 0, removed: 0, failed: 0, skipped: 0 };

  const byHousehold = new Map<string, SubscriptionRow[]>();
  for (const s of due) byHousehold.set(s.household_id, [...(byHousehold.get(s.household_id) ?? []), s]);

  await pool([...byHousehold], CONCURRENCY, async ([householdId, rows]) => {
    let records: RecordRow[];
    try {
      records = await householdRows(db, householdId);
    } catch {
      summary.failed += rows.length;
      return;
    }
    for (const s of rows) {
      // Claim the slot first: only the run that moves last_sent_at on from the value it read
      // sends, so two overlapping runs (a retried cron call, say) never push the same digest twice.
      if (!(await claim(db, s, now))) {
        summary.skipped++;
        continue;
      }
      const { timeZone } = scheduleOf(s);
      const digest = householdDigest(records, { useSoonDays: s.use_soon_days, now, timeZone });
      if (!digest) {
        // Nothing to say counts as sent (the claim already recorded it), so it waits for the next slot.
        summary.quiet++;
        continue;
      }
      const result = await sendPush(cfg, s, digestPayload(digest));
      if (result === "sent") {
        summary.sent++;
        if (s.failures) await db.from("push_subscriptions").update({ failures: 0 }).eq("id", s.id);
      } else if (result === "gone" || s.failures + 1 >= MAX_FAILURES) {
        summary.removed++;
        await db.from("push_subscriptions").delete().eq("id", s.id);
      } else {
        summary.failed++;
        // Give the slot back so the next hourly run tries again.
        await db.from("push_subscriptions").update({ failures: s.failures + 1, last_sent_at: s.last_sent_at }).eq("id", s.id);
      }
    }
  });
  return summary;
}

/**
 * Constant-time check of `Authorization: Bearer <secret>`. Both sides are hashed first, so the
 * comparison takes the same time whatever the length or content of what was sent.
 */
export function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const digest = (v: string) => createHash("sha256").update(v, "utf8").digest();
  return timingSafeEqual(digest(header.slice(7)), digest(secret));
}

/** Seconds between test reminders from one device. */
export const TEST_COOLDOWN_SECONDS = 10;

/**
 * Start a test send for this subscription, at most once per cooldown. True when allowed
 * (and the time is recorded); false while a recent test is still cooling down.
 */
export async function claimTestSend(db: Admin, id: string, now: Date = new Date()): Promise<boolean> {
  const cutoff = new Date(now.getTime() - TEST_COOLDOWN_SECONDS * 1000).toISOString();
  const { data, error } = await db
    .from("push_subscriptions")
    .update({ last_test_at: now.toISOString() })
    .eq("id", id)
    .or(`last_test_at.is.null,last_test_at.lt.${cutoff}`)
    .select("id");
  return !error && (data?.length ?? 0) > 0;
}
