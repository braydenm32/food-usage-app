"use client";

import { getSupabase } from "@/lib/supabase/client";

/**
 * Browser side of the AI routes (/api/scan, /api/parse-text, /api/recipes, /api/recipes/import):
 * they need the signed-in user's Supabase access token, and answer 401 `sign_in_required` without
 * one and 429 `ai_quota` once today's allowance is used.
 */

/** "Sign in to use recipe ideas.": the sign-in line, worded for the feature asking. */
export const aiSignInCopy = (feature = "photo scanning and AI recipes") => `Sign in to use ${feature}.`;
export const AI_SIGN_IN_COPY = aiSignInCopy();
export const AI_QUOTA_COPY = "You've reached today's AI limit. It resets tomorrow.";

/** The current access token, or null when signed out (or sync isn't set up in this build). */
export async function aiAccessToken(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Whether AI calls from here would carry a sign-in. */
export async function hasAiSession(): Promise<boolean> {
  return (await aiAccessToken()) !== null;
}

/** fetch() with the sign-in attached when there is one. */
export async function aiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = await aiAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

export type AiDenial = "sign-in" | "quota";

/** Why an AI route said no, when it was the sign-in or the daily limit. */
export function aiDenial(status: number, body: unknown): AiDenial | null {
  const code = (body as { error?: unknown } | null)?.error;
  if (status === 401 && (code === "sign_in_required" || code === "unauthorised")) return "sign-in";
  if (status === 429 && code === "ai_quota") return "quota";
  return null;
}
