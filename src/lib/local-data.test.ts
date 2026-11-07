import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAllLocalData } from "@/lib/local-data";

function fakeStorage(initial: Record<string, string>): Storage {
  const m = new Map(Object.entries(initial));
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("clearAllLocalData", () => {
  it("removes every Larder key from both storages and leaves other sites' keys alone", () => {
    const local = fakeStorage({
      "larder-v1": "{}",
      "larder-meal-log": "{}",
      "larder-sync": "{}",
      "larder-auth": "{}",
      "larder-auth-code-verifier": "x",
      "larder-cook-timers": "{}",
      "larder-ai-ideas": "{}",
      "larder-push-endpoint": "https://fcm.googleapis.com/x",
      "larder-reminders-asked": "2026",
      "larder-pantry-sort": "name",
      unrelated: "keep",
    });
    const session = fakeStorage({ "larder-recipe:abc": "{}", "larder-add:photo": "{}", other: "keep" });
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("sessionStorage", session);
    clearAllLocalData();
    expect(local.length).toBe(1);
    expect(local.getItem("unrelated")).toBe("keep");
    expect(session.length).toBe(1);
    expect(session.getItem("other")).toBe("keep");
  });

  it("never throws when storage is blocked or missing", () => {
    vi.stubGlobal("localStorage", {
      get length(): number {
        throw new Error("SecurityError");
      },
      removeItem() {
        throw new Error("SecurityError");
      },
    });
    expect(() => clearAllLocalData()).not.toThrow();
  });
});
