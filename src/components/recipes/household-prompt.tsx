"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Button, Chip, Input, Sheet, Stepper } from "@/components/ui";
import { SensitiveConsent } from "@/components/privacy-notices";
import { DEFAULT_PROFILE, useLarder } from "@/lib/store";
import type { Diet, HouseholdProfile } from "@/lib/types";

const DIETS: Array<{ value: Diet; label: string }> = [
  { value: "vegetarian", label: "Vegetarian" },
  { value: "vegan", label: "Vegan" },
  { value: "pescatarian", label: "Pescatarian" },
  { value: "gluten-free", label: "Gluten free" },
  { value: "dairy-free", label: "Dairy free" },
  { value: "low-carb", label: "Low carb" },
  { value: "halal", label: "Halal" },
  { value: "kosher", label: "Kosher" },
];

/** True when nobody has told us about the household yet (first visit to Recipes). */
export function needsHouseholdPrompt(profile: HouseholdProfile): boolean {
  if (profile.confirmed) return false;
  // Households that set anything (in onboarding or Settings) before this prompt existed count as set.
  return (
    profile.people === DEFAULT_PROFILE.people &&
    profile.diets.length === 0 &&
    profile.allergies.length === 0 &&
    profile.likes.length === 0 &&
    profile.dislikes.length === 0
  );
}

/** One-time "Cooking for how many?" sheet: sizes recipes and filters for diets and allergies. */
export function HouseholdPrompt({ open, onDone }: { open: boolean; onDone: () => void }) {
  const profile = useLarder((s) => s.profile);
  const setProfile = useLarder((s) => s.setProfile);
  const [people, setPeople] = useState(profile.people);
  const [diets, setDiets] = useState<Diet[]>(profile.diets);
  const [allergies, setAllergies] = useState<string[]>(profile.allergies);
  const [draft, setDraft] = useState("");
  const [consent, setConsent] = useState(false);
  // Diets and allergies can reveal health or beliefs, so ask once before keeping any.
  const hasSensitive = diets.length > 0 || allergies.length > 0 || draft.trim().length > 0;
  const needsConsent = hasSensitive && !profile.sensitiveConsentAt;
  const canSave = !needsConsent || consent;

  const addAllergy = () => {
    const v = draft.trim().replace(/,$/, "");
    if (v && !allergies.some((a) => a.toLowerCase() === v.toLowerCase())) setAllergies((a) => [...a, v]);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addAllergy();
    }
  };

  const save = () => {
    const pending = draft.trim();
    const all = pending && !allergies.some((a) => a.toLowerCase() === pending.toLowerCase()) ? [...allergies, pending] : allergies;
    if (!canSave) return;
    setProfile({
      people,
      diets,
      allergies: all,
      confirmed: true,
      ...(hasSensitive && !profile.sensitiveConsentAt ? { sensitiveConsentAt: new Date().toISOString() } : {}),
    });
    onDone();
  };
  const skip = () => {
    setProfile({ confirmed: true });
    onDone();
  };

  return (
    <Sheet
      open={open}
      onClose={skip}
      title="Cooking for how many?"
      footer={
        <div className="flex gap-2">
          <Button variant="secondary" size="lg" onClick={skip}>
            Skip
          </Button>
          <Button size="lg" className="flex-1" onClick={save} disabled={!canSave}>
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-6 py-1">
        <p className="text-[15px] text-ink-2">This sizes recipes and keeps out anything your household can&apos;t eat. You can change it any time in Settings.</p>
        <div className="flex items-center justify-between gap-4 rounded-2xl bg-surface-2 p-4">
          <div>
            <p className="text-[15px] font-medium text-ink">People eating</p>
            <p className="text-sm text-ink-2">Including little ones.</p>
          </div>
          <Stepper value={people} onChange={(v) => setPeople(Math.max(1, Math.round(v)))} min={1} label="people" />
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-ink-2">Ways of eating, if any</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Ways of eating">
            {DIETS.map((d) => {
              const on = diets.includes(d.value);
              return (
                <Chip key={d.value} selected={on} onClick={() => setDiets((x) => (on ? x.filter((v) => v !== d.value) : [...x, d.value]))}>
                  {d.label}
                </Chip>
              );
            })}
          </div>
        </div>
        <div>
          <label htmlFor="hp-allergy" className="mb-2 block text-sm font-medium text-ink-2">
            Allergies, if any
          </label>
          {allergies.length > 0 && (
            <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Allergies added">
              {allergies.map((a) => (
                <li key={a} className="inline-flex h-8 items-center gap-1 rounded-full bg-surface-2 pl-3 pr-1 text-sm font-medium text-ink">
                  {a}
                  <button
                    type="button"
                    aria-label={`Remove ${a}`}
                    onClick={() => setAllergies((x) => x.filter((v) => v !== a))}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-ink-3 hover:bg-line hover:text-ink"
                  >
                    <X size={13} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Input id="hp-allergy" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} placeholder="Peanuts, shellfish, egg…" autoComplete="off" />
            <Button variant="secondary" onClick={addAllergy} disabled={!draft.trim()} className="shrink-0">
              Add
            </Button>
          </div>
        </div>
        {needsConsent && <SensitiveConsent checked={consent} onChange={setConsent} />}
      </div>
    </Sheet>
  );
}
