import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import webpush, { WebPushError, type PushSubscription } from "web-push";
import type { Database } from "@/lib/supabase/database.types";
import type { Digest } from "@/lib/reminders";
import { householdDigest, type RecordRow } from "@/lib/push/digest";
import { isDue, isValidTimeZone, type Cadence } from "@/lib/push/schedule";

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
  const sub: PushSubscription = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload), {
      TTL: TTL_SECONDS,
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
}

/** Send every digest that's due now. Safe to run more often than hourly: each slot sends once. */
export async function sendDueDigests(cfg: PushConfig, now: Date = new Date()): Promise<SendSummary> {
  const db = adminClient(cfg);
  const subs = await allSubscriptions(db);
  const due = subs.filter((s) => isDue(now, scheduleOf(s), s.last_sent_at ?? s.created_at));
  const summary: SendSummary = { checked: subs.length, due: due.length, sent: 0, quiet: 0, removed: 0, failed: 0 };

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
      const { timeZone } = scheduleOf(s);
      const digest = householdDigest(records, { useSoonDays: s.use_soon_days, now, timeZone });
      if (!digest) {
        // Nothing to say counts as sent, so it isn't re-checked until the next slot.
        summary.quiet++;
        await db.from("push_subscriptions").update({ last_sent_at: now.toISOString() }).eq("id", s.id);
        continue;
      }
      const result = await sendPush(cfg, s, digestPayload(digest));
      if (result === "sent") {
        summary.sent++;
        await db.from("push_subscriptions").update({ last_sent_at: now.toISOString(), failures: 0 }).eq("id", s.id);
      } else if (result === "gone" || s.failures + 1 >= MAX_FAILURES) {
        summary.removed++;
        await db.from("push_subscriptions").delete().eq("id", s.id);
      } else {
        summary.failed++;
        // Try again next hour.
        await db.from("push_subscriptions").update({ failures: s.failures + 1 }).eq("id", s.id);
      }
    }
  });
  return summary;
}

/** Constant-time check of `Authorization: Bearer <secret>`. */
export function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const given = header.slice(7);
  if (given.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}
