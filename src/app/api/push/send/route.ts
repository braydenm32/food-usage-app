import { bearerMatches, missingPushEnv, pushConfig, sendDueDigests } from "@/lib/push/server";

/**
 * POST (Supabase pg_cron + pg_net, see the README) or GET: send the reminder digests that are
 * due. Runs hourly; each subscription has its own local hour and zone, and each slot sends once
 * (rows are claimed before sending, so overlapping runs don't double up).
 * Needs `Authorization: Bearer <CRON_SECRET>`.
 */
async function run(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "not_configured", message: "Set CRON_SECRET to enable the reminder sender." }, { status: 503 });
  }
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "unauthorised", message: "Missing or wrong cron secret." }, { status: 401 });
  }
  const cfg = pushConfig();
  if (!cfg) {
    return Response.json(
      { error: "not_configured", message: `Background reminders need these env vars: ${missingPushEnv().join(", ")}.` },
      { status: 503 },
    );
  }
  try {
    const summary = await sendDueDigests(cfg);
    return Response.json({ ok: true, ...summary }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: "failed", message: e instanceof Error ? e.message : "Sending failed." }, { status: 500 });
  }
}

/** One run reads every due household and sends with a 10 s timeout per push; give it room. */
export const maxDuration = 60;

export const GET = run;
export const POST = run;
