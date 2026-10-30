"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export type LarderClient = SupabaseClient<Database>;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** True when this build knows where the Supabase project is. Without it Larder is local-only. */
export const supabaseConfigured = Boolean(url && key);

let client: LarderClient | null | undefined;

/**
 * The browser Supabase client, or null when the env vars are missing (or on the server).
 * PKCE flow; the session lives in localStorage under `larder-auth` and refreshes itself.
 * `detectSessionInUrl` exchanges `?code=` from a magic link or Google redirect on load.
 */
export function getSupabase(): LarderClient | null {
  if (client !== undefined) return client;
  if (typeof window === "undefined" || !url || !key) return null;
  client = createClient<Database>(url, key, {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "larder-auth",
    },
    realtime: { params: { eventsPerSecond: 5 } },
  });
  return client;
}

/** Whether a sign-in provider (e.g. Google) is switched on for the project. Null if unknown (offline). */
export async function providerEnabled(provider: "google"): Promise<boolean | null> {
  if (!url || !key) return false;
  try {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
    if (!res.ok) return null;
    const body = (await res.json()) as { external?: Record<string, boolean> };
    return Boolean(body.external?.[provider]);
  } catch {
    return null;
  }
}
