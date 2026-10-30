import type { ItemView } from "@/lib/selectors";
import type { Settings } from "@/lib/types";

/**
 * Client-side reminders. There is no server yet, so a digest is built from the
 * larder whenever the app is opened or becomes visible, and shown through the
 * service worker (or a plain Notification) if one is due.
 */

export const LAST_DIGEST_KEY = "larder-digest-last";

export interface Digest {
  title: string;
  body: string;
  /** Number of items the digest is about. */
  count: number;
  /** Where tapping the notification should go. */
  url: string;
}

function joinNames(names: string[], max = 4): string {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.join(", ");
}

function listName(v: ItemView): string {
  return v.item.name.toLowerCase();
}

function things(n: number) {
  return n === 1 ? "thing" : "things";
}

/**
 * Builds a short, honest digest from item views (most urgent first).
 * Returns null when nothing needs attention.
 *
 *   "3 things to use today: spinach, mince, yoghurt"
 *   "2 things to use soon: milk, broccoli"
 *   "1 thing to check: tasty cheese"
 */
export function buildDigest(views: ItemView[]): Digest | null {
  const today = views.filter((v) => v.expiry.status === "use-today");
  const soon = views.filter((v) => v.expiry.status === "use-soon");
  const check = views.filter((v) => v.expiry.status === "expired");

  if (today.length > 0) {
    const n = today.length;
    const extras: string[] = [];
    if (soon.length) extras.push(`${soon.length} more to use soon`);
    if (check.length) extras.push(`${check.length} to check`);
    return {
      title: `${n} ${things(n)} to use today`,
      body: `${joinNames(today.map(listName))}${extras.length ? `. Plus ${extras.join(" and ")}.` : ""}`,
      count: n,
      url: "/",
    };
  }
  if (soon.length > 0) {
    const n = soon.length;
    return {
      title: `${n} ${things(n)} to use soon`,
      body: `${joinNames(soon.map(listName))}${check.length ? `. Plus ${check.length} to check.` : ""}`,
      count: n,
      url: "/",
    };
  }
  if (check.length > 0) {
    const n = check.length;
    return {
      title: `${n} ${things(n)} to check`,
      body: `${joinNames(check.map(listName))}. Trust your senses before you bin anything.`,
      count: n,
      url: "/",
    };
  }
  return null;
}

/** One line version of a digest, for previews and tests. */
export function digestLine(d: Digest): string {
  return `${d.title}: ${d.body}`;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Whether a digest should be sent now. Daily digests go out once a day at or
 * after the chosen hour; weekly ones on Sundays at or after that hour.
 */
export function isDigestDue(
  settings: Pick<Settings, "digest" | "digestHour" | "pushEnabled">,
  lastSentISO: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!settings.pushEnabled || settings.digest === "off") return false;
  if (now.getHours() < settings.digestHour) return false;
  if (settings.digest === "weekly" && now.getDay() !== 0) return false;
  if (!lastSentISO) return true;
  const last = new Date(lastSentISO);
  if (Number.isNaN(last.getTime())) return true;
  return !sameLocalDay(last, now);
}

export function readLastSent(): string | null {
  try {
    return localStorage.getItem(LAST_DIGEST_KEY);
  } catch {
    return null;
  }
}

export function writeLastSent(now: Date = new Date()): void {
  try {
    localStorage.setItem(LAST_DIGEST_KEY, now.toISOString());
  } catch {
    // Private mode or blocked storage: the digest may repeat next open; harmless.
  }
}

export type NotificationSupport = "unsupported" | "needs-install" | "denied" | "default" | "granted";

/** What the current browser can do about notifications, with iOS quirks called out. */
export function notificationSupport(): NotificationSupport {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    // iOS Safari only exposes Notification once the site is added to the Home Screen.
    if (/iPhone|iPad|iPod/i.test(ua)) return "needs-install";
    return "unsupported";
  }
  return Notification.permission;
}

/** Shows a notification through the service worker when possible, else directly. */
export async function showNotification(d: Digest): Promise<boolean> {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  const options: NotificationOptions = {
    body: d.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "larder-digest",
    data: { url: d.url },
  };
  try {
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(d.title, options);
      return true;
    }
  } catch {
    // Fall through to a plain Notification.
  }
  try {
    const n = new Notification(d.title, options);
    n.onclick = () => {
      window.focus();
      window.location.assign(d.url);
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks whether a digest is due and shows it. Returns the digest if one was
 * shown, otherwise null.
 */
export async function runDigestIfDue(
  views: ItemView[],
  settings: Pick<Settings, "digest" | "digestHour" | "pushEnabled">,
  now: Date = new Date(),
): Promise<Digest | null> {
  if (!isDigestDue(settings, readLastSent(), now)) return null;
  const digest = buildDigest(views);
  // Nothing to say counts as "sent" so we don't keep re-checking all day.
  writeLastSent(now);
  if (!digest) return null;
  const shown = await showNotification(digest);
  return shown ? digest : null;
}
