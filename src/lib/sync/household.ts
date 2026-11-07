"use client";

/** Household calls for the account and join screens: thin wrappers with friendly errors. */
import type { LarderClient } from "@/lib/supabase/client";

export interface Membership {
  householdId: string;
  householdName: string;
  role: "owner" | "member";
  displayName: string | null;
}

export interface Member {
  userId: string;
  displayName: string | null;
  role: "owner" | "member";
  joinedAt: string;
}

export interface InvitePeek {
  /** Only given for an invite that can still be used, or when this account is already a member. */
  householdId: string | null;
  householdName: string;
  expired: boolean;
  /** This account is already in the household (say, the invite it joined with, opened again). */
  alreadyMember?: boolean;
}

/** How long invite links last (set by the database default). Each link lets one person join. */
export const INVITE_HOURS = 48;
/** "2 days", for copy. */
export const INVITE_LIFETIME = `${INVITE_HOURS / 24} days`;

/** Turn a Supabase/network error into a sentence for the screen. */
export function explain(e: unknown, fallback = "Something went wrong. Try again."): string {
  if (typeof navigator !== "undefined" && !navigator.onLine) return "You're offline. Connect to the internet and try again.";
  const err = e as { message?: string; code?: string; status?: number } | null;
  const msg = err?.message ?? "";
  if (e instanceof TypeError || /failed to fetch|network|load failed/i.test(msg)) {
    return "Couldn't reach the sync server. Check your connection and try again.";
  }
  if (/expired or is not valid/i.test(msg)) return "This invite link has expired or isn't valid. Ask for a new one.";
  if (/not a member/i.test(msg)) return "You're not in that household any more.";
  if (/sign in with an email/i.test(msg)) return "Sign in with your email address to start or join a household.";
  if (/at most 5 households/i.test(msg)) return "You can be in up to 5 households. Leave one before starting or joining another.";
  if (/household is full/i.test(msg)) return "That household is full. A household can have up to 20 people.";
  if (/too many open invites/i.test(msg)) {
    return `This household has too many invite links waiting to be used. Cancel the open ones below, or wait: links stop working after ${INVITE_LIFETIME}.`;
  }
  if (/cannot be moved/i.test(msg)) return "That change belongs to a different household, so it wasn't saved.";
  if (/storage limit/i.test(msg)) return "This household has reached its storage limit, so new changes can't sync.";
  if (/not signed in|jwt/i.test(msg)) return "Your sign-in has expired. Sign in again.";
  return msg ? `${fallback} (${msg})` : fallback;
}

async function userId(client: LarderClient): Promise<string> {
  const { data } = await client.auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error("Not signed in");
  return id;
}

/** Households this account belongs to (usually zero or one). */
export async function listMemberships(client: LarderClient): Promise<Membership[]> {
  const uid = await userId(client);
  const { data, error } = await client
    .from("household_members")
    .select("household_id, role, display_name, joined_at, households(name)")
    .eq("user_id", uid)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((m) => ({
    householdId: m.household_id,
    householdName: (m.households as { name: string } | null)?.name ?? "Household",
    role: m.role === "owner" ? "owner" : "member",
    displayName: m.display_name,
  }));
}

export async function listMembers(client: LarderClient, householdId: string): Promise<Member[]> {
  const { data, error } = await client
    .from("household_members")
    .select("user_id, display_name, role, joined_at")
    .eq("household_id", householdId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((m) => ({
    userId: m.user_id,
    displayName: m.display_name,
    role: m.role === "owner" ? "owner" : "member",
    joinedAt: m.joined_at,
  }));
}

export async function createHousehold(client: LarderClient, name: string, memberName: string): Promise<string> {
  const { data, error } = await client.rpc("create_household", {
    household_name: name.trim().slice(0, 80) || "My household",
    member_name: memberName.trim().slice(0, 60),
  });
  if (error) throw error;
  return data;
}

export async function createInvite(client: LarderClient, householdId: string): Promise<string> {
  const { data, error } = await client.rpc("create_household_invite", { hid: householdId });
  if (error) throw error;
  return data;
}

/** Null when the token doesn't exist. */
export async function peekInvite(client: LarderClient, token: string): Promise<InvitePeek | null> {
  const { data, error } = await client.rpc("peek_household_invite", { invite_token: token });
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  // The server leaves the household id out for an expired or cancelled invite.
  return { householdId: row.household_id, householdName: row.household_name, expired: row.expired || !row.household_id };
}

/**
 * Peek at an invite, and when it can't be used any more, check whether this account is already
 * in that household: `join_household` hands a member the household id back before it looks at
 * whether the invite is used, and changes nothing then. For anyone else it refuses (nothing is
 * used up either way, since a used or expired invite can't be used).
 */
export async function checkInvite(client: LarderClient, token: string): Promise<InvitePeek | null> {
  const peek = await peekInvite(client, token);
  if (!peek || !peek.expired) return peek;
  try {
    const hid = await joinHousehold(client, token, "");
    if (typeof hid === "string" && hid) return { ...peek, householdId: hid, expired: false, alreadyMember: true };
  } catch {
    /* not a member: the invite really is spent */
  }
  return peek;
}

export async function joinHousehold(client: LarderClient, token: string, memberName: string): Promise<string> {
  const { data, error } = await client.rpc("join_household", {
    invite_token: token,
    member_name: memberName.trim().slice(0, 60),
  });
  if (error) throw error;
  return data;
}

export async function setDisplayName(client: LarderClient, householdId: string, name: string) {
  const uid = await userId(client);
  const { error } = await client
    .from("household_members")
    .update({ display_name: name.trim().slice(0, 60) || null })
    .eq("household_id", householdId)
    .eq("user_id", uid);
  if (error) throw error;
}

/**
 * Remove this account from a household. The database tidies up after: the last person out
 * deletes the household, and if the only owner leaves, the longest-standing member takes over.
 */
export async function leaveHousehold(client: LarderClient, householdId: string) {
  const uid = await userId(client);
  const { error } = await client.from("household_members").delete().eq("household_id", householdId).eq("user_id", uid);
  if (error) throw error;
}

/**
 * Owner only: take someone out of the household. Row-level security lets an owner delete any
 * membership in their household; the database then revokes every open invite, so the person
 * can't come back with a link they still hold.
 */
export async function removeMember(client: LarderClient, householdId: string, memberId: string) {
  const { data, error } = await client
    .from("household_members")
    .delete()
    .eq("household_id", householdId)
    .eq("user_id", memberId)
    .select("user_id");
  if (error) throw error;
  if (!data?.length) throw new Error("Only the person who started the household can remove people.");
}

/** Stop every invite link for this household that hasn't been used yet. Resolves to how many. */
export async function cancelOpenInvites(client: LarderClient, householdId: string): Promise<number> {
  const { data, error } = await client
    .from("household_invites")
    .update({ revoked: true })
    .eq("household_id", householdId)
    .eq("revoked", false)
    .is("used_at", null)
    .select("token");
  if (error) throw error;
  return data?.length ?? 0;
}

/**
 * Delete this account on the server (`/api/account/delete`). Memberships and reminder
 * subscriptions go with it; records shared with a household stay for the others. Throws an
 * Error with a sentence for the screen.
 */
export async function deleteAccount(client: LarderClient): Promise<void> {
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your sign-in has expired. Sign in again, then delete your account.");
  let res: Response;
  try {
    res = await fetch("/api/account/delete", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new Error("Couldn't reach Larder. Check your connection and try again.");
  }
  if (res.ok) return;
  const body = (await res.json().catch(() => ({}))) as { message?: unknown };
  throw new Error(typeof body.message === "string" ? body.message : "Couldn't delete your account. Try again in a minute.");
}

/** A sensible default name from an email address: "sam.lee@…" → "Sam". */
export function nameFromEmail(email: string | null | undefined): string {
  const local = (email ?? "").split("@")[0]?.split(/[._+-]/)[0] ?? "";
  return local ? local.charAt(0).toUpperCase() + local.slice(1).toLowerCase() : "";
}

/** The shareable link for an invite token. */
export const inviteUrl = (origin: string, token: string) => `${origin}/join/${encodeURIComponent(token)}`;

/** Pull a token out of whatever was pasted: a full link, a path, or the bare code. */
export function parseInviteInput(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const m = s.match(/\/join\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}
