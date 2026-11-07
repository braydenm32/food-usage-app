import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Who may use the AI routes, and how much. Every AI call needs a signed-in Supabase user
 * (`Authorization: Bearer <access token>`) and counts against that user's daily allowance,
 * kept in Postgres (public.ai_usage via consume_ai_call), so it holds across server instances.
 *
 * Everything goes through `authenticateAi` and `consumeAiCall`: to switch to one cap for the
 * whole app, change what `consumeAiCall` counts against, not the routes.
 */

export const AI_SIGN_IN_REQUIRED = {
  error: "sign_in_required",
  message: "Sign in to use photo scanning and AI recipes.",
} as const;

export const AI_QUOTA_REACHED = {
  error: "ai_quota",
  message: "You've reached today's AI limit. It resets tomorrow, or you can add things by hand meanwhile.",
} as const;

export const AI_UNAVAILABLE = {
  error: "ai_not_configured",
  message: "AI features aren't available right now. You can still add things by hand.",
} as const;

const DEFAULT_DAILY_LIMIT = 40;

/** AI calls per user per day: AI_DAILY_LIMIT, or 40. */
export function aiDailyLimit(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt(env.AI_DAILY_LIMIT ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 100_000) : DEFAULT_DAILY_LIMIT;
}

/** The parts of the Supabase client this needs, so tests can pass a fake. */
export type GateClient = Pick<SupabaseClient, "auth" | "rpc">;

let cached: GateClient | null | undefined;

/** The service-role client, or null when the server isn't set up with it (AI then stays off). */
function serviceClient(env: NodeJS.ProcessEnv = process.env): GateClient | null {
  if (cached !== undefined) return cached;
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  cached =
    url && key
      ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
      : null;
  return cached;
}

export function bearerToken(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  return /^Bearer\s+\S+$/i.test(auth) ? auth.replace(/^Bearer\s+/i, "") : "";
}

const deny = (status: number, body: { error: string; message: string }, headers?: HeadersInit) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

export type AiUser = { ok: true; userId: string; client: GateClient } | { ok: false; response: Response };

/** Check the caller is signed in. Fails closed (503) when the server can't check. */
export async function authenticateAi(req: Request, client: GateClient | null = serviceClient()): Promise<AiUser> {
  const token = bearerToken(req);
  if (!token) return { ok: false, response: deny(401, AI_SIGN_IN_REQUIRED) };
  if (!client) {
    console.error("[ai] SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL is missing, so AI calls are off");
    return { ok: false, response: deny(503, AI_UNAVAILABLE) };
  }
  try {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return { ok: false, response: deny(401, AI_SIGN_IN_REQUIRED) };
    return { ok: true, userId: data.user.id, client };
  } catch (e) {
    console.error("[ai] couldn't check the sign-in", e);
    return { ok: false, response: deny(503, AI_UNAVAILABLE) };
  }
}

/**
 * Count one AI call for this user. Null when it's allowed; otherwise the response to send
 * (429 when today's allowance is used up, 503 when the count couldn't be kept).
 */
export async function consumeAiCall(user: { userId: string; client: GateClient }, limit = aiDailyLimit()): Promise<Response | null> {
  try {
    const { data, error } = await user.client.rpc("consume_ai_call", { uid: user.userId, daily_limit: limit });
    if (error) {
      console.error("[ai] consume_ai_call failed", error.message);
      return deny(503, AI_UNAVAILABLE);
    }
    if (data !== true) return deny(429, AI_QUOTA_REACHED, { "Retry-After": String(secondsToSydneyMidnight()) });
    return null;
  } catch (e) {
    console.error("[ai] consume_ai_call failed", e);
    return deny(503, AI_UNAVAILABLE);
  }
}

/** Sign-in check and one counted call, for routes that call the AI straight away. */
export async function gateAi(req: Request, client: GateClient | null = serviceClient()): Promise<AiUser> {
  const user = await authenticateAi(req, client);
  if (!user.ok) return user;
  const denied = await consumeAiCall(user);
  return denied ? { ok: false, response: denied } : user;
}

/** Seconds until the allowance resets (midnight in Sydney, matching consume_ai_call). */
export function secondsToSydneyMidnight(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" })
    .formatToParts(now)
    .reduce<Record<string, number>>((acc, p) => (p.type === "literal" ? acc : { ...acc, [p.type]: Number(p.value) }), {});
  const elapsed = (parts.hour ?? 0) * 3600 + (parts.minute ?? 0) * 60 + (parts.second ?? 0);
  return Math.max(60, 86_400 - elapsed);
}

/** Whether the server could check sign-ins at all (for the GET probes). */
export function aiAuthConfigured(): boolean {
  return serviceClient() !== null;
}
