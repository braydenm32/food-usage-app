"use client";

/**
 * Background reminders in the browser: ask for permission in context, subscribe this device
 * to Web Push, and keep its reminder preferences on the server in step with Settings.
 *
 * Background push needs an account in a household (the server reads the household's synced
 * food to write the digest). Without one, reminders are shown when Larder is opened (see
 * `src/components/reminder-runner.tsx`).
 */
import { useLarder } from "@/lib/store";
import { getSupabase, supabaseConfigured } from "@/lib/supabase/client";
import { syncStatusStore } from "@/lib/sync/status";
import { notificationSupport } from "@/lib/reminders";
import { browserTimeZone } from "@/lib/push/schedule";
import type { Settings } from "@/lib/types";

const VAPID_PUBLIC_KEY = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").trim().replace(/^["']|["']$/g, "");
/** The endpoint this device saved on the server, when background reminders are on. */
const ENDPOINT_KEY = "larder-push-endpoint";
/** Set once the first-add prompt has been shown, so it never nags. */
const ASKED_KEY = "larder-reminders-asked";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Blocked storage: we may ask again next time; harmless.
  }
}

/** This browser can receive background pushes (iPhone: only once installed on the Home Screen). */
export function browserSupportsPush(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

/** This copy of Larder is set up to send background reminders (keys and sync configured). */
export const backgroundPushConfigured = Boolean(VAPID_PUBLIC_KEY && supabaseConfigured);

/** Signed in and sharing a household: the server can read the food to remind about. */
function accountHousehold(): { householdId: string } | null {
  const s = syncStatusStore.getState();
  return s.userId && s.householdId ? { householdId: s.householdId } : null;
}

/** True when this device's reminders come from the server, so the in-app check should stay quiet. */
export function backgroundRemindersActive(): boolean {
  return !!read(ENDPOINT_KEY) && !!accountHousehold();
}

export type ReminderAccess =
  /** Push is on and saved on the server: reminders arrive even when Larder is closed. */
  | "background"
  /** Notifications allowed, but reminders only show when Larder is opened (no account, or push not set up here). */
  | "in-app"
  | "denied"
  /** The prompt was closed without an answer. */
  | "dismissed"
  | "unsupported"
  /** iPhone or iPad: add to the Home Screen first. */
  | "needs-install"
  /** Not asked: the first-add prompt was already shown once. */
  | "skipped";

function base64UrlToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!browserSupportsPush()) return null;
  try {
    // Don't wait forever when the service worker failed to register (dev, blocked).
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);
  } catch {
    return null;
  }
}

/**
 * Subscribe this device and save its reminder preferences on the server. Returns true when
 * background reminders are now on. Quietly false without an account, keys or support.
 */
export async function ensurePushSubscription(settings: Pick<Settings, "digest" | "digestHour" | "useSoonDays"> = useLarder.getState().settings): Promise<boolean> {
  const account = accountHousehold();
  const client = getSupabase();
  if (!backgroundPushConfigured || !account || !client || settings.digest === "off") return false;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  const reg = await registration();
  if (!reg) return false;
  try {
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(VAPID_PUBLIC_KEY) }));
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return false;
    const { error } = await client.rpc("save_push_subscription", {
      hid: account.householdId,
      sub_endpoint: json.endpoint,
      sub_p256dh: json.keys.p256dh,
      sub_auth: json.keys.auth,
      sub_cadence: settings.digest,
      sub_hour: settings.digestHour,
      sub_time_zone: browserTimeZone(),
      sub_use_soon_days: settings.useSoonDays,
      sub_weekday: 0,
    });
    if (error) return false;
    write(ENDPOINT_KEY, json.endpoint);
    return true;
  } catch {
    // A push service that refused (e.g. keys changed): fall back to in-app reminders.
    return false;
  }
}

/** Stop background reminders on this device (server row and browser subscription). */
export async function removePushSubscription(): Promise<void> {
  const saved = read(ENDPOINT_KEY);
  write(ENDPOINT_KEY, null);
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  const endpoint = sub?.endpoint ?? saved;
  const client = getSupabase();
  if (endpoint && client) {
    // Best effort: if this fails (offline, signed out), the unsubscribe below makes the
    // endpoint dead, and the sender drops the row the next time it tries it.
    await client.from("push_subscriptions").delete().eq("endpoint", endpoint).then(
      () => undefined,
      () => undefined,
    );
  }
  await sub?.unsubscribe().catch(() => false);
}

/**
 * Ask for notification permission in context and turn reminders on. Call it from a tap
 * (browsers only show the prompt after a user action).
 *
 * - `{ once: true }` is for the nudge right after the first successful add: it asks at most
 *   once ever, and never if the person already answered or turned reminders off themselves.
 * - From Settings, call it without options.
 */
export async function askForReminders(opts: { once?: boolean } = {}): Promise<ReminderAccess> {
  if (opts.once) {
    const { settings } = useLarder.getState();
    if (read(ASKED_KEY) || settings.pushEnabled) return "skipped";
    write(ASKED_KEY, new Date().toISOString());
    if (typeof Notification !== "undefined" && Notification.permission !== "default") return "skipped";
  }
  const support = notificationSupport();
  if (support === "unsupported" || support === "needs-install" || support === "denied") return support;
  let permission: NotificationPermission = Notification.permission;
  if (permission === "default") {
    try {
      permission = await Notification.requestPermission();
    } catch {
      return "dismissed";
    }
  }
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "dismissed";

  const store = useLarder.getState();
  const digest = store.settings.digest === "off" ? "daily" : store.settings.digest;
  store.setSettings({ pushEnabled: true, digest });
  const background = await ensurePushSubscription({ ...store.settings, digest });
  return background ? "background" : "in-app";
}

/** Send this device's reminder now, to check it arrives. Returns an error sentence, or null when sent. */
export async function sendTestReminder(): Promise<string | null> {
  const client = getSupabase();
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription().catch(() => null);
  if (!client || !sub) return "This device isn't set up for background reminders yet.";
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return "Sign in again to send a test reminder.";
  try {
    const res = await fetch("/api/push/test", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    if (res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    return body.message ?? "Couldn't send a test reminder. Try again in a minute.";
  } catch {
    return "You're offline. Connect to the internet and try again.";
  }
}
