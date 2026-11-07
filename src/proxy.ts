import { NextResponse, type NextRequest } from "next/server";
import { FORM_OVERHEAD_BYTES, MAX_IMAGE_BYTES } from "@/lib/http-body";

/**
 * Guards the API routes against abuse: same-origin only for writes, an early body-size check, and
 * per-IP rate limits (20 writes a minute to the AI and test-reminder routes; 60 a minute for the
 * recipe search and barcode lookups).
 *
 * This is a speed bump, not a quota: the counts live in one instance's memory, so they reset
 * on a cold start and aren't shared between instances. The real limits are elsewhere: the AI
 * routes need a signed-in user and count each call in Postgres (src/lib/server-auth.ts), and
 * each route reads its body with a hard byte cap (src/lib/http-body.ts), since Content-Length
 * can be left out of a chunked upload.
 */

const WINDOW_MS = 60_000;
const WRITE_LIMIT = 20;
const LOOKUP_LIMIT = 60;
const MAX_BODY: Record<string, number> = {
  "/api/scan": MAX_IMAGE_BYTES + FORM_OVERHEAD_BYTES,
  "/api/parse-text": 128 * 1024,
  // More specific paths first: routeKey takes the first prefix match.
  "/api/recipes/import": MAX_IMAGE_BYTES + FORM_OVERHEAD_BYTES, // recipe photo, or a small JSON body with a link
  "/api/recipes": 64 * 1024,
  "/api/push/test": 4 * 1024, // { endpoint }
};

const buckets = { write: new Map<string, number[]>(), lookup: new Map<string, number[]>() };

/**
 * The caller's address. Vercel sets x-real-ip, and appends the address it saw to the right of
 * x-forwarded-for, so the leftmost entries are whatever the client sent and can't be trusted.
 */
export function clientIp(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  return fwd?.[fwd.length - 1] || "local";
}

function json(status: number, error: string, message: string, headers?: HeadersInit) {
  return NextResponse.json({ error, message }, { status, headers });
}

function routeKey(pathname: string): string | undefined {
  return Object.keys(MAX_BODY).find((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Count one request for `ip`. A 429 response when it is over `limit` a minute, else null. */
export function rateLimit(bucket: Map<string, number[]>, ip: string, limit: number, now = Date.now()): NextResponse | null {
  const recent = (bucket.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    const retry = Math.ceil((WINDOW_MS - (now - recent[0])) / 1000);
    bucket.set(ip, recent);
    return json(429, "rate_limited", "That's a lot of requests. Wait a minute and try again.", { "Retry-After": String(retry) });
  }
  recent.push(now);
  bucket.set(ip, recent);
  // Keep the map small: drop idle addresses now and then.
  if (bucket.size > 5000) {
    for (const [k, v] of bucket) if (now - v[v.length - 1] > WINDOW_MS) bucket.delete(k);
  }
  return null;
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const ip = clientIp(req.headers);

  // Lookups that call other services: a looser limit, any method.
  if (pathname.startsWith("/api/barcode/") || pathname === "/api/recipes/search") {
    if (pathname.startsWith("/api/barcode/")) {
      // A malformed escape in a barcode URL ("%E0%A4%A") would otherwise fail param decoding with a 500.
      try {
        decodeURIComponent(pathname);
      } catch {
        return json(400, "bad_code", "Barcodes are 6 to 14 digits. Check the number and try again.");
      }
    }
    return rateLimit(buckets.lookup, ip, LOOKUP_LIMIT) ?? NextResponse.next();
  }

  const key = routeKey(pathname);
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

  // An early answer for honest clients; the routes enforce the cap on the bytes actually sent.
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY[key]) {
    return json(413, "too_large", "That's too much to send in one go. Try something smaller.");
  }

  return rateLimit(buckets.write, ip, WRITE_LIMIT) ?? NextResponse.next();
}

export const config = {
  matcher: ["/api/scan/:path*", "/api/parse-text/:path*", "/api/recipes/:path*", "/api/barcode/:path*", "/api/push/test"],
};
