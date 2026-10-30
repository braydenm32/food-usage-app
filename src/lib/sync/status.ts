"use client";

import { createStore, useStore } from "zustand";

export type SyncState =
  /** This build has no Supabase project configured. */
  | "off"
  | "signed-out"
  /** Signed in, but this device isn't syncing with a household. */
  | "no-household"
  | "syncing"
  | "synced"
  | "offline"
  | "error";

export interface SyncStatus {
  state: SyncState;
  /** False until the saved session has been read (avoid flashing "signed out"). */
  ready: boolean;
  lastSyncedAt: string | null;
  /** Local changes not yet on the server. */
  pending: number;
  error: string | null;
  userId: string | null;
  email: string | null;
  householdId: string | null;
  householdName: string | null;
  /** One-off message for the account screen, e.g. "You were removed from the household". */
  notice: string | null;
}

export const syncStatusStore = createStore<SyncStatus>(() => ({
  state: "off",
  ready: false,
  lastSyncedAt: null,
  pending: 0,
  error: null,
  userId: null,
  email: null,
  householdId: null,
  householdName: null,
  notice: null,
}));

/** Live sync status for this tab: state, last synced time, pending changes, account and household. */
export function useSyncStatus(): SyncStatus;
export function useSyncStatus<T>(select: (s: SyncStatus) => T): T;
export function useSyncStatus<T>(select?: (s: SyncStatus) => T) {
  return useStore(syncStatusStore, select ?? ((s: SyncStatus) => s as unknown as T));
}

/** Short, honest words for a status, e.g. for a settings row. */
export function describeSync(
  s: Pick<SyncStatus, "state" | "pending" | "householdName" | "lastSyncedAt">,
  now = Date.now(),
  short = false,
): string {
  if (short) {
    // For tight spots like the desktop rail.
    if (s.state === "off") return "Not set up";
    if (s.state === "signed-out") return "Not signed in";
    if (s.state === "no-household") return "Not sharing yet";
    if (s.state === "offline") return s.pending ? `Offline · ${s.pending} to sync` : "Offline";
    if (s.state === "error") return "Couldn't sync. Retrying";
  }
  const changes = `${s.pending} change${s.pending === 1 ? "" : "s"}`;
  switch (s.state) {
    case "off":
      return "Sync isn't set up on this server";
    case "signed-out":
      return "Not signed in. Food stays on this device";
    case "no-household":
      return "Signed in. Not sharing yet";
    case "offline":
      return s.pending ? `Offline. ${changes} will sync when you're back online` : "Offline. Will sync when you're back online";
    case "error":
      return s.pending ? `Couldn't sync ${changes}. Trying again` : "Couldn't sync. Trying again";
    case "syncing":
      return s.pending ? `Syncing ${changes}…` : "Syncing…";
    case "synced":
      return s.lastSyncedAt ? `Synced ${timeAgo(s.lastSyncedAt, now)}` : "Synced";
  }
}

export function timeAgo(iso: string, now = Date.now()): string {
  const secs = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
