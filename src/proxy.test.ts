import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { clientIp, proxy, rateLimit } from "./proxy";

describe("clientIp", () => {
  it("prefers x-real-ip", () => {
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1, 203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("takes the rightmost forwarded entry, not the one the client wrote", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(new Headers())).toBe("local");
  });
});

describe("rateLimit", () => {
  it("allows up to the limit in a minute, then asks the caller to wait", () => {
    const bucket = new Map<string, number[]>();
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) expect(rateLimit(bucket, "a", 3, now + i)).toBeNull();
    const res = rateLimit(bucket, "a", 3, now + 10);
    expect(res?.status).toBe(429);
    expect(Number(res?.headers.get("retry-after"))).toBeGreaterThan(0);
    // Someone else isn't affected, and the window moves on.
    expect(rateLimit(bucket, "b", 3, now + 10)).toBeNull();
    expect(rateLimit(bucket, "a", 3, now + 61_000)).toBeNull();
  });
});

describe("proxy", () => {
  const post = (path: string, headers: Record<string, string> = {}) =>
    new NextRequest(`http://localhost${path}`, { method: "POST", headers: { host: "localhost", ...headers } });

  it("rejects other sites", () => {
    expect(proxy(post("/api/scan", { origin: "https://evil.example" })).status).toBe(403);
  });

  it("refuses a declared body over the route's cap", () => {
    expect(proxy(post("/api/scan", { "content-length": String(5 * 1024 * 1024), "x-real-ip": "192.0.2.50" })).status).toBe(413);
  });

  it("rate limits recipe search lookups per address", () => {
    const get = () => proxy(new NextRequest("http://localhost/api/recipes/search?ingredient=egg", { headers: { "x-real-ip": "192.0.2.77" } }));
    const statuses = Array.from({ length: 61 }, () => get().status);
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
  });

  it("answers a malformed barcode escape with 400", () => {
    expect(proxy(new NextRequest("http://localhost/api/barcode/%E0%A4%A")).status).toBe(400);
  });
});
