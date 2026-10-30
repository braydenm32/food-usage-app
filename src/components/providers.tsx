"use client";

import { ThemeProvider, useTheme } from "next-themes";
import { useEffect, type ReactNode } from "react";
import { useLarder } from "@/lib/store";
import { Toaster } from "@/components/toast";
import { ReminderRunner } from "@/components/reminder-runner";
import { SyncRunner } from "@/components/sync-runner";

/** Keeps next-themes in step with the theme saved in settings. */
function ThemeSync() {
  const theme = useLarder((s) => s.settings.theme);
  const { setTheme } = useTheme();
  useEffect(() => setTheme(theme), [theme, setTheme]);
  return null;
}

function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <ThemeSync />
      <ServiceWorker />
      <ReminderRunner />
      <SyncRunner />
      {children}
      <Toaster />
    </ThemeProvider>
  );
}
