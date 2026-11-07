import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAllLocalData } from "./local-data";

function fakeStorage(init: Record<string, string>): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  } as Storage;
}

describe("clearAllLocalData", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("clears larder keys and recipe caches but leaves other keys", () => {
    const localStorage = fakeStorage({ "larder-v1": "{}", "larder-ai-ideas": "{}", "larder-cook-timers": "{}", other: "keep" });
    const sessionStorage = fakeStorage({ "larder-recipe:abc": "{}", other: "keep" });
    vi.stubGlobal("window", { localStorage, sessionStorage });
    clearAllLocalData();
    expect(localStorage.getItem("larder-v1")).toBeNull();
    expect(localStorage.getItem("larder-ai-ideas")).toBeNull();
    expect(localStorage.getItem("larder-cook-timers")).toBeNull();
    expect(localStorage.getItem("other")).toBe("keep");
    expect(sessionStorage.getItem("larder-recipe:abc")).toBeNull();
    expect(sessionStorage.getItem("other")).toBe("keep");
  });

  it("does nothing without a browser", () => {
    expect(() => clearAllLocalData()).not.toThrow();
  });
});
