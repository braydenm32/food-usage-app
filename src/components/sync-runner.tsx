"use client";

import { useEffect } from "react";
import { getSyncEngine } from "@/lib/sync/engine";
import { syncStatusStore } from "@/lib/sync/status";

/** Starts household sync for this tab (when Supabase is configured). Renders nothing. */
export function SyncRunner() {
  useEffect(() => {
    // Without Supabase the status stays "off" and the app is purely local.
    if (!getSyncEngine()) syncStatusStore.setState({ state: "off", ready: true });
  }, []);
  return null;
}
