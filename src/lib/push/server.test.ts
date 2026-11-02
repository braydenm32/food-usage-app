import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { bearerMatches, cleanEnv, sendPush } = await import("./server");

describe("push sender guards", () => {
  it("checks the cron secret", () => {
    expect(bearerMatches("Bearer s3cret-value", "s3cret-value")).toBe(true);
    expect(bearerMatches("Bearer s3cret-valuf", "s3cret-value")).toBe(false);
    expect(bearerMatches("Bearer short", "s3cret-value")).toBe(false);
    expect(bearerMatches("s3cret-value", "s3cret-value")).toBe(false);
    expect(bearerMatches(null, "s3cret-value")).toBe(false);
    expect(bearerMatches("Bearer ", undefined)).toBe(false);
  });

  it("never posts to an endpoint that isn't a browser push service", async () => {
    const cfg = { supabaseUrl: "", serviceKey: "", vapidPublic: "", vapidPrivate: "", vapidSubject: "" };
    const row = { endpoint: "https://169.254.169.254/latest/meta-data", p256dh: "x", auth: "y" };
    expect(await sendPush(cfg, row, { title: "t", body: "b", url: "/", tag: "x" })).toBe("gone");
  });
});

describe("cleanEnv", () => {
  it("strips pasted whitespace and quotes", () => {
    expect(cleanEnv('  "abc-DEF_123"\n')).toBe("abc-DEF_123");
    expect(cleanEnv("'mailto:a@b.com' ")).toBe("mailto:a@b.com");
    expect(cleanEnv("plain")).toBe("plain");
    expect(cleanEnv("VAPID_PRIVATE_KEY=abc_123")).toBe("abc_123");
    expect(cleanEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY="BAbc-1"')).toBe("BAbc-1");
  });
});
