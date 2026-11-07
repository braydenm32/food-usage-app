import { createClient } from "@supabase/supabase-js";
import { deleteAccount, type DeleteAdmin } from "./handler";

/** The service-role client, or null when the server isn't set up for it (fail closed: 503). */
function admin(): DeleteAdmin | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

/**
 * POST with `Authorization: Bearer <Supabase access token>`: permanently delete the caller's
 * account. Same-origin only. The account screen clears this device's data afterwards.
 */
export async function POST(request: Request) {
  return deleteAccount(request, admin());
}
