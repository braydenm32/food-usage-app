import { describe, expect, it } from "vitest";
import { clampInt, isWebUrl, webUrl } from "./web-url";

describe("isWebUrl", () => {
  it.each(["https://www.themealdb.com/meal/1", "http://example.com", "HTTPS://Example.com/a?b=c"])("allows %s", (u) => expect(isWebUrl(u)).toBe(true));
  it.each(["javascript:alert(1)", " javascript:alert(1)", "data:text/html,hi", "/recipes/1", "//evil.example", "https//x", "", null, undefined, 3])(
    "drops %s",
    (u) => expect(isWebUrl(u)).toBe(false),
  );
  it("trims", () => expect(webUrl(" https://a.example/ ")).toBe("https://a.example/"));
});

describe("clampInt", () => {
  it("keeps a query number in range", () => {
    expect(clampInt("-1", 1, 10, 6)).toBe(1);
    expect(clampInt("0", 1, 10, 6)).toBe(1);
    expect(clampInt("500", 1, 10, 6)).toBe(10);
    expect(clampInt("3.7", 1, 10, 6)).toBe(3);
    expect(clampInt("abc", 1, 10, 6)).toBe(6);
    expect(clampInt(null, 1, 10, 6)).toBe(6);
    expect(clampInt("", 1, 10, 6)).toBe(6);
  });
});
