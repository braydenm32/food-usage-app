import type { Diet, HouseholdProfile } from "@/lib/types";

/**
 * Diets and allergies can reveal health or beliefs. They're only kept once someone has ticked
 * the consent box, and only sent to the AI with that consent and the Settings switch on.
 * Taking them away never needs consent.
 */

/** True when `diets`/`allergies` add anything the profile doesn't already have. */
export function addsSensitive(profile: Pick<HouseholdProfile, "diets" | "allergies">, diets: Diet[], allergies: string[]): boolean {
  const known = new Set(profile.allergies.map((a) => a.trim().toLowerCase()));
  return diets.some((d) => !profile.diets.includes(d)) || allergies.some((a) => a.trim() && !known.has(a.trim().toLowerCase()));
}

/** What the AI hears about the household for recipe ideas. */
export function aiProfile(profile: HouseholdProfile, includeProfile: boolean) {
  if (!includeProfile) return { people: profile.people };
  const sensitive = profile.sensitiveConsentAt ? { diets: profile.diets, allergies: profile.allergies } : { diets: [], allergies: [] };
  return { people: profile.people, ...sensitive, likes: profile.likes, dislikes: profile.dislikes };
}
