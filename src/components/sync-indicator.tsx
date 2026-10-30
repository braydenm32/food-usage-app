"use client";

import Link from "next/link";
import clsx from "clsx";
import { ChevronRight, Cloud, CloudAlert, CloudCheck, CloudOff, CloudUpload, type LucideIcon } from "lucide-react";
import { useHydrated } from "@/lib/use-hydrated";
import { useNow } from "@/lib/use-now";
import { describeSync, useSyncStatus, type SyncState } from "@/lib/sync/status";

const ICONS: Record<SyncState, LucideIcon> = {
  off: CloudOff,
  "signed-out": Cloud,
  "no-household": Cloud,
  syncing: CloudUpload,
  synced: CloudCheck,
  offline: CloudOff,
  error: CloudAlert,
};

const TONE: Record<SyncState, string> = {
  off: "text-ink-3",
  "signed-out": "text-ink-3",
  "no-household": "text-ink-3",
  syncing: "text-primary",
  synced: "text-fresh",
  offline: "text-ink-3",
  error: "text-today",
};

export function SyncIcon({ state, size = 18, className }: { state: SyncState; size?: number; className?: string }) {
  const Icon = ICONS[state];
  return <Icon size={size} aria-hidden className={clsx(TONE[state], className)} />;
}

/** One line of honest status, e.g. "Synced 2 min ago". */
export function useSyncLine(short = false): { state: SyncState; line: string; title: string; ready: boolean } {
  const status = useSyncStatus();
  const now = useNow();
  const hydrated = useHydrated();
  const title = status.householdName ?? (status.state === "signed-out" || status.state === "off" ? "Sync and share" : "Your account");
  return { state: status.state, line: describeSync(status, now, short), title, ready: hydrated && status.ready };
}

/** Desktop rail footer: small cloud status that links to /account. */
export function RailSyncStatus({ active }: { active: boolean }) {
  const { state, line, title, ready } = useSyncLine(true);
  return (
    <Link
      href="/account"
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex min-h-11 items-center gap-3 rounded-2xl px-3 py-2 transition-colors",
        active ? "bg-primary-soft" : "hover:bg-surface-2",
      )}
    >
      <SyncIcon state={ready ? state : "signed-out"} size={20} className="shrink-0" />
      <span className="min-w-0">
        <span className="block truncate text-[15px] font-medium text-ink">{title}</span>
        <span className="block truncate text-xs text-ink-2">{ready ? line : "Checking…"}</span>
      </span>
    </Link>
  );
}

/** Settings, top: "Sync and share" row with the live status. */
export function SettingsSyncRow() {
  const { state, line, ready } = useSyncLine();
  const householdName = useSyncStatus((s) => s.householdName);
  return (
    <Link
      href="/account"
      className="flex min-h-16 items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 transition-colors hover:bg-surface-2"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft">
        <SyncIcon state={ready ? state : "signed-out"} size={20} />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium text-ink">
          Sync and share{householdName ? <span className="font-normal text-ink-2"> · {householdName}</span> : null}
        </span>
        <span className="block text-sm text-ink-2">{ready ? line : "Checking…"}</span>
      </span>
      <ChevronRight size={18} aria-hidden className="ml-auto shrink-0 text-ink-3" />
    </Link>
  );
}
