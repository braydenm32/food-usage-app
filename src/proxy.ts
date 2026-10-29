import { NextResponse, type NextRequest } from "next/server";

/**
 * Guards the AI-backed API routes against abuse: same-origin only, a body-size cap, and a
 * simple per-IP rate limit (20 requests a minute). The limiter lives in this instance's
 * memory, so it is a speed bump rather than a hard quota on multi-instance hosting.
 */

const WINDOW_MS = 60_000;
const LIMIT = 20;
const MAX_BODY: Record<string, number> = {
  "/api/scan": 9 * 1024 * 1024, // 8 MB photo plus form overhead
  "/api/parse-text": 128 * 1024,
  "/api/recipes": 64 * 1024,
};

const hits = new Map<string, number[]>();

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

function json(status: number, error: string, message: string, headers?: HeadersInit) {
  return NextResponse.json({ error, message }, { status, headers });
}

function routeKey(pathname: string): string | undefined {
  return Object.keys(MAX_BODY).find((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function proxy(req: NextRequest) {
  const key = routeKey(req.nextUrl.pathname);
  if (!key || req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return NextResponse.next();

  // Same-origin only: browsers send Origin on POST; reject other sites.
  const origin = req.headers.get("origin");
  let originHost: string | undefined;
  try {
    originHost = origin ? new URL(origin).host : undefined;
  } catch {
    originHost = "invalid";
  }
  const hosts = [req.headers.get("host"), req.headers.get("x-forwarded-host"), req.nextUrl.host].filter(Boolean);
  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site" || (originHost && !hosts.includes(originHost))) {
    return json(403, "forbidden", "Requests must come from Larder itself.");
  }

  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY[key]) {
    return json(413, "too_large", "That's too much to send in one go. Try something smaller.");
  }

  const now = Date.now();
  const ip = clientIp(req);
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) {
    const retry = Math.ceil((WINDOW_MS - (now - recent[0])) / 1000);
    hits.set(ip, recent);
    return json(429, "rate_limited", "That's a lot of requests. Wait a minute and try again.", {
      "Retry-After": String(retry),
    });
  }
  recent.push(now);
  hits.set(ip, recent);
  // Keep the map small: drop idle addresses now and then.
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (now - v[v.length - 1] > WINDOW_MS) hits.delete(k);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/scan/:path*", "/api/parse-text/:path*", "/api/recipes/:path*"],
};
