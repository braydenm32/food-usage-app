import { bearerMatches, missingPushEnv, pushConfig, sendDueDigests } from "@/lib/push/server";

/**
 * GET (Vercel Cron) or POST (any other scheduler): send the reminder digests that are due.
 * Runs hourly; each subscription has its own local hour and zone, and each slot sends once.
 * Needs `Authorization: Bearer <CRON_SECRET>`. Vercel Cron sends that header itself when
 * the CRON_SECRET env var is set.
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

export const GET = run;
export const POST = run;
