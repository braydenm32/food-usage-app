import { describe, expect, it } from "vitest";
import { DEFAULT_PROFILE } from "@/lib/store";
import { addsSensitive, aiProfile } from "./sensitive";

const profile = { ...DEFAULT_PROFILE, people: 3, diets: ["vegetarian" as const], allergies: ["Peanuts"], likes: ["spicy"], dislikes: ["olives"] };

describe("addsSensitive", () => {
  it("is false for removing or keeping what's there", () => {
    expect(addsSensitive(profile, [], [])).toBe(false);
    expect(addsSensitive(profile, ["vegetarian"], ["peanuts "])).toBe(false);
  });
  it("is true for a new diet or allergy", () => {
    expect(addsSensitive(profile, ["vegetarian", "vegan"], ["Peanuts"])).toBe(true);
    expect(addsSensitive(profile, [], ["Shellfish"])).toBe(true);
  });
});

describe("aiProfile", () => {
  it("leaves out diets and allergies without consent", () => {
    expect(aiProfile(profile, true)).toEqual({ people: 3, diets: [], allergies: [], likes: ["spicy"], dislikes: ["olives"] });
  });
  it("includes them with consent and the switch on", () => {
    const p = { ...profile, sensitiveConsentAt: "2026-11-01T00:00:00.000Z" };
    expect(aiProfile(p, true)).toMatchObject({ diets: ["vegetarian"], allergies: ["Peanuts"] });
    expect(aiProfile(p, false)).toEqual({ people: 3 });
  });
});
