"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { authMessage, authReturnMessage } from "@/components/account/auth-errors";
import { Card, cx } from "@/components/ui";
import type { PreviousBinding } from "@/lib/sync/outbox";

/**
 * After a magic link or Google sends the user back (`?code=…`, or `?error=…&error_code=…`),
 * report any sign-in error and tidy the address bar. Only the error code is read, and mapped
 * to our own words: the description in the URL could say anything (see auth-errors.ts).
 */
export function useAuthReturn(): string | null {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const client = getSupabase();
    if (!client) return;
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    const param = (k: string) => url.searchParams.get(k) ?? hash.get(k);
    const failed = ["error", "error_code", "error_description"].some((k) => param(k) !== null);
    const code = param("error_code") ?? param("error");
    const hadParams = ["code", "error", "error_code", "error_description"].some((k) => url.searchParams.has(k)) || hash.has("error");
    let cancelled = false;
    void client.auth.initialize().then(({ error: err }) => {
      if (cancelled) return;
      if (failed) setError(authReturnMessage(code));
      else if (err) setError(authMessage(err));
      if (hadParams) window.history.replaceState(null, "", url.pathname);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return error;
}

/** "3 changes haven't synced yet and will be lost": shared wording for leave, sign out and switching. */
export function unsyncedWarning(pending: number, householdName = "the household"): string {
  return `${pending} change${pending === 1 ? " hasn't" : "s haven't"} synced yet and will be lost. They stay on this device, but won't reach ${householdName}.`;
}

export type JoinMode = "merge" | "replace";

/**
 * The food here came from a household this device no longer syncs with (signed out and kept,
 * or another account was signed in). Say so, so it isn't carried into another household by
 * accident. Null when there's nothing to warn about.
 */
export function previousWarning(previous: PreviousBinding | null, userId: string | null): string | null {
  if (!previous) return null;
  const name = previous.householdName ? `“${previous.householdName}”` : "another household";
  return previous.userId && previous.userId !== userId
    ? `The food on this device was shared with ${name} by a different account. Unless it's yours to share, start fresh.`
    : `The food on this device came from ${name}, which this device was signed out of. Start fresh unless it's yours to share.`;
}

/** Default choice for a join or start screen: start fresh when the food here came from elsewhere. */
export const defaultJoinMode = (previous: PreviousBinding | null, linkedElsewhere = false): JoinMode =>
  previous || linkedElsewhere ? "replace" : "merge";

/**
 * "Bring the food on this device" vs "Start fresh with the household's food". For a brand-new
 * household (`fresh`), the second option starts it empty.
 */
export function JoinModeChoice({
  householdName,
  value,
  onChange,
  itemCount,
  fresh = false,
}: {
  householdName: string;
  value: JoinMode;
  onChange: (m: JoinMode) => void;
  itemCount: number;
  fresh?: boolean;
}) {
  const options: Array<{ value: JoinMode; title: string; body: string }> = [
    {
      value: "merge",
      title: `Bring the food on this device into ${householdName}`,
      body: fresh
        ? `Your ${itemCount ? `${itemCount} item${itemCount === 1 ? "" : "s"}, ` : ""}list, recipes and history go up to the new household.`
        : `Your ${itemCount ? `${itemCount} item${itemCount === 1 ? "" : "s"}, ` : ""}list, recipes and history are added to the household's. Where both have the same thing, the household's version is kept.`,
    },
    fresh
      ? {
          value: "replace",
          title: `Start ${householdName} empty`,
          body: "This device's food, list, recipes and history are cleared first. Your theme and reminder settings stay as they are.",
        }
      : {
          value: "replace",
          title: "Start fresh with the household's food",
          body: "This device's food, list, recipes and history are replaced with the household's. Your theme and reminder settings stay as they are.",
        },
  ];
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium text-ink-2">There&apos;s already food on this device</legend>
      {options.map((o) => (
        <label
          key={o.value}
          className={cx(
            "flex cursor-pointer gap-3 rounded-2xl border p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary",
            value === o.value ? "border-primary bg-primary-soft" : "border-line bg-surface hover:bg-surface-2",
          )}
        >
          <input
            type="radio"
            name="join-mode"
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="mt-1 h-5 w-5 shrink-0 accent-[var(--primary)]"
          />
          <span>
            <span className="block text-[15px] font-medium text-ink">{o.title}</span>
            <span className="mt-0.5 block text-sm text-ink-2">{o.body}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error" | "warn"; children: React.ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cx(
        "rounded-xl px-3 py-2 text-sm text-ink",
        tone === "error" ? "bg-spoiled-soft" : tone === "warn" ? "bg-soon-soft" : "bg-primary-soft",
      )}
    >
      {children}
    </p>
  );
}

export function NotConfigured() {
  return (
    <Card className="p-5">
      <p className="font-display text-xl text-ink">Accounts aren&apos;t available here yet</p>
      <p className="mt-2 text-[15px] text-ink-2">
        Larder works fully on this device without an account. Sharing with your household, syncing between devices and
        reminders while Larder is closed will appear here once accounts are switched on.
      </p>
    </Card>
  );
}

export function SkeletonCards({ count = 2 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-busy aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-32 animate-pulse rounded-2xl bg-surface-2" />
      ))}
    </div>
  );
}
