"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { getSyncEngine } from "@/lib/sync/engine";
import { useSyncStatus } from "@/lib/sync/status";
import { Button } from "@/components/ui";

/**
 * Last line of defence around the app: if a screen throws while rendering (say, a record that
 * slipped past validation), show a way out instead of a blank page. Local data is never touched.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Larder crashed while rendering", error, info.componentStack);
  }

  render() {
    return this.state.failed ? <CrashScreen /> : this.props.children;
  }
}

function CrashScreen() {
  const householdId = useSyncStatus((s) => s.householdId);
  const householdName = useSyncStatus((s) => s.householdName);

  const stopSyncing = () => {
    // Keeps the food here; only the link to the household goes.
    getSyncEngine()?.unbind();
    window.location.reload();
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div role="alert" className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
        <h1 className="font-display text-2xl leading-tight text-ink">Something went wrong</h1>
        <p className="mt-2 text-[15px] text-ink-2">
          Larder hit a problem showing this screen. Your food is still saved on this device. Reloading usually sorts it out.
        </p>
        {householdId && (
          <p className="mt-2 text-[15px] text-ink-2">
            If it keeps happening, something synced from {householdName ?? "your household"} may be to blame. You can stop syncing on
            this device and keep everything that&apos;s here.
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={() => window.location.reload()}>Reload</Button>
          {householdId && (
            <Button variant="secondary" onClick={stopSyncing}>
              Stop syncing on this device
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
