import "server-only";

/**
 * Account deletion, kept apart from the route file so it can be tested with a fake admin client.
 *
 * Deleting the auth.users row is all it takes; the database does the rest (see
 * supabase/migrations/20261107000000_security_hardening.sql): memberships and reminder
 * subscriptions cascade, records and invites keep their household but forget who wrote them,
 * the last member out deletes the household, and a household that loses its owner promotes
 * the longest-standing member.
 */

export interface DeleteAdmin {
  auth: {
    getUser(token: string): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
    admin: { deleteUser(id: string): Promise<{ error: unknown }> };
  };
}

const json = (status: number, error: string, message: string) =>
  Response.json({ error, message }, { status, headers: { "Cache-Control": "no-store" } });

/**
 * Browsers say where a request came from. Refuse anything from another site; requests without
 * the headers (not from a browser) still need a valid access token.
 */
export function fromThisSite(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  const hosts = [request.headers.get("host"), request.headers.get("x-forwarded-host"), safeHost(request.url)].filter(Boolean);
  return hosts.includes(originHost);
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export async function deleteAccount(request: Request, admin: DeleteAdmin | null): Promise<Response> {
  if (!fromThisSite(request)) return json(403, "forbidden", "Requests must come from Larder itself.");
  if (!admin) return json(503, "not_configured", "Account deletion isn't available here yet. Contact us and we'll delete it for you.");

  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return json(401, "unauthorised", "Sign in again, then delete your account.");

  let uid: string | undefined;
  try {
    const { data, error } = await admin.auth.getUser(token);
    if (!error) uid = data.user?.id;
  } catch {
    return json(502, "unavailable", "Couldn't reach the account server. Try again in a minute.");
  }
  if (!uid) return json(401, "unauthorised", "Your sign-in has expired. Sign in again, then delete your account.");

  try {
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (error) return json(502, "failed", "Couldn't delete your account just now. Try again in a minute.");
  } catch {
    return json(502, "unavailable", "Couldn't reach the account server. Try again in a minute.");
  }
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
