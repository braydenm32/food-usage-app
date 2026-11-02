import { adminClient, claimTestSend, digestPayload, householdRows, pushConfig, scheduleOf, sendPush, TEST_COOLDOWN_SECONDS } from "@/lib/push/server";
import { householdDigest } from "@/lib/push/digest";

function error(status: number, code: string, message: string) {
  return Response.json({ error: code, message }, { status });
}

/**
 * POST `{ endpoint }` with `Authorization: Bearer <Supabase access token>`: send this
 * device's reminder now, so people can check it arrives. Only to the caller's own subscription.
 */
export async function POST(request: Request) {
  const cfg = pushConfig();
  if (!cfg) return error(503, "not_configured", "Background reminders aren't available yet.");
  const auth = request.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return error(401, "unauthorised", "Sign in to send a test reminder.");

  let endpoint = "";
  try {
    const body = (await request.json()) as { endpoint?: unknown };
    endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  } catch {
    // Handled below.
  }
  if (!endpoint) return error(400, "bad_request", "Missing the device's push endpoint.");

  const db = adminClient(cfg);
  const { data: user, error: userError } = await db.auth.getUser(token);
  if (userError || !user.user) return error(401, "unauthorised", "Your sign-in has expired. Sign in again.");

  const { data: sub } = await db
    .from("push_subscriptions")
    .select("*")
    .eq("endpoint", endpoint)
    .eq("user_id", user.user.id)
    .maybeSingle();
  if (!sub) return error(404, "not_found", "This device isn't set up for reminders yet. Turn reminders off and on again.");
  if (!(await claimTestSend(db, sub.id))) {
    return Response.json(
      { error: "rate_limited", message: "A test reminder was just sent. Wait a few seconds and try again." },
      { status: 429, headers: { "Retry-After": String(TEST_COOLDOWN_SECONDS) } },
    );
  }

  let payload = {
    title: "Reminders are on",
    body: "Nothing needs using right now. Larder will let you know when something does.",
    url: "/",
    tag: "larder-test",
  };
  try {
    const rows = await householdRows(db, sub.household_id);
    const digest = householdDigest(rows, { useSoonDays: sub.use_soon_days, now: new Date(), timeZone: scheduleOf(sub).timeZone });
    if (digest) payload = { ...digestPayload(digest), tag: "larder-test" };
  } catch {
    // Send the plain test message.
  }
  const result = await sendPush(cfg, sub, payload);
  if (result === "gone") {
    await db.from("push_subscriptions").delete().eq("id", sub.id);
    return error(410, "gone", "This device stopped accepting notifications. Turn reminders off and on again.");
  }
  if (result === "failed") return error(502, "failed", "Couldn't reach this device's notification service. Try again in a minute.");
  return Response.json({ ok: true });
}
