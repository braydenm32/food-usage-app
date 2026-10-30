"use client";

import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { authMessage } from "@/components/account/auth-panel";
import { Card, cx } from "@/components/ui";

/**
 * After a magic link or Google sends the user back (`?code=…` or `?error_description=…`),
 * report any sign-in error and tidy the address bar.
 */
export function useAuthReturn(): string | null {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const client = getSupabase();
    if (!client) return;
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    const described = url.searchParams.get("error_description") ?? hash.get("error_description");
    const hadParams = ["code", "error", "error_code", "error_description"].some((k) => url.searchParams.has(k)) || hash.has("error");
    let cancelled = false;
    void client.auth.initialize().then(({ error: err }) => {
      if (cancelled) return;
      if (described) setError(authMessage({ message: described }));
      else if (err) setError(authMessage(err));
      if (hadParams) window.history.replaceState(null, "", url.pathname);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return error;
}

export type JoinMode = "merge" | "replace";

/** "Bring the food on this device" vs "Start fresh with the household's food". */
export function JoinModeChoice({
  householdName,
  value,
  onChange,
  itemCount,
}: {
  householdName: string;
  value: JoinMode;
  onChange: (m: JoinMode) => void;
  itemCount: number;
}) {
  const options: Array<{ value: JoinMode; title: string; body: string }> = [
    {
      value: "merge",
      title: `Bring the food on this device into ${householdName}`,
      body: `Your ${itemCount ? `${itemCount} item${itemCount === 1 ? "" : "s"}, ` : ""}list, recipes and history are added to the household's. Where both have the same thing, the household's version is kept.`,
    },
    {
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
      <p className="font-display text-xl text-ink">Sync isn&apos;t set up on this server</p>
      <p className="mt-2 text-[15px] text-ink-2">
        Larder works fully on this device without an account. Sharing with your household and syncing between devices needs a
        Supabase project connected to this copy of Larder; whoever runs it can follow the setup steps in the README.
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
