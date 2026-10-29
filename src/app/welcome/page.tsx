"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, PencilLine, Receipt, Sparkles, X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { useLarder } from "@/lib/store";
import type { Diet } from "@/lib/types";
import { Button, Chip, Input, Stepper, cx } from "@/components/ui";

const DIETS: Array<{ value: Diet; label: string }> = [
  { value: "vegetarian", label: "Vegetarian" },
  { value: "vegan", label: "Vegan" },
  { value: "pescatarian", label: "Pescatarian" },
  { value: "gluten-free", label: "Gluten-free" },
  { value: "dairy-free", label: "Dairy-free" },
  { value: "low-carb", label: "Low-carb" },
  { value: "halal", label: "Halal" },
  { value: "kosher", label: "Kosher" },
];

const STEPS = ["What Larder does", "Your household", "How to start"];

export default function WelcomePage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const profile = useLarder((s) => s.profile);
  const setProfile = useLarder((s) => s.setProfile);
  const setSettings = useLarder((s) => s.setSettings);
  const loadDemoData = useLarder((s) => s.loadDemoData);
  const [allergyDraft, setAllergyDraft] = useState("");

  const finish = (to: string) => {
    setSettings({ onboarded: true });
    router.push(to);
  };

  const addAllergy = () => {
    const v = allergyDraft.trim();
    if (!v) return;
    if (!profile.allergies.some((a) => a.toLowerCase() === v.toLowerCase())) {
      setProfile({ allergies: [...profile.allergies, v] });
    }
    setAllergyDraft("");
  };
  const onAllergyKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addAllergy();
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      {/* Top bar: progress + skip */}
      <div className="flex items-center justify-between gap-4 px-5 pt-[calc(1rem+env(safe-area-inset-top))] lg:mx-auto lg:w-full lg:max-w-xl lg:px-0 lg:pt-10">
        <div className="flex items-center gap-3">
          {step > 0 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              aria-label="Back"
              className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-ink-2 hover:bg-surface-2"
            >
              <ArrowLeft size={20} />
            </button>
          ) : (
            <span className="font-display text-xl text-ink">Larder</span>
          )}
          <ol className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
            {STEPS.map((label, i) => (
              <li
                key={label}
                aria-current={i === step ? "step" : undefined}
                className={cx(
                  "h-1.5 rounded-full transition-all",
                  i === step ? "w-6 bg-primary" : i < step ? "w-2.5 bg-primary/50" : "w-2.5 bg-line",
                )}
              >
                <span className="sr-only">{label}</span>
              </li>
            ))}
          </ol>
          <span className="text-xs text-ink-3">
            {step + 1} of {STEPS.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => finish("/")}
          className="flex h-11 items-center gap-1 rounded-full px-3 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
        >
          Skip
          <X size={16} aria-hidden />
        </button>
      </div>

      <main className="flex flex-1 flex-col px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:mx-auto lg:w-full lg:max-w-xl lg:px-0">
        {step === 0 && (
          <section aria-labelledby="w-step-1" className="flex flex-1 flex-col justify-center py-10">
            <h1 id="w-step-1" className="font-display text-[2.6rem] leading-[1.05] text-ink sm:text-[3.4rem] lg:text-[4rem]">
              Know what&apos;s in your kitchen, <span className="text-primary">what to eat first</span>, and what to cook
              with it.
            </h1>
            <p className="mt-6 max-w-md text-[17px] leading-relaxed text-ink-2">
              Larder keeps a quiet eye on your fridge, freezer and pantry. It estimates when things will turn, nudges you
              before they do, and turns what&apos;s left into dinner.
            </p>
            <ul className="mt-8 grid gap-3 text-[15px] text-ink-2 sm:grid-cols-3">
              {[
                { emoji: "🧾", text: "Add a whole shop from a receipt in seconds" },
                { emoji: "🥬", text: "See what to use today, honestly estimated" },
                { emoji: "🍳", text: "Get recipes for what's about to turn" },
              ].map((f) => (
                <li key={f.text} className="flex items-start gap-3 rounded-2xl bg-surface p-3">
                  <span aria-hidden className="text-2xl leading-none">
                    {f.emoji}
                  </span>
                  <span>{f.text}</span>
                </li>
              ))}
            </ul>
            <div className="mt-10">
              <Button size="lg" block onClick={() => setStep(1)}>
                Let&apos;s set it up
              </Button>
              <p className="mt-3 text-center text-xs text-ink-3">Nothing leaves your device. No account needed.</p>
            </div>
          </section>
        )}

        {step === 1 && (
          <section aria-labelledby="w-step-2" className="flex flex-1 flex-col py-8">
            <h1 id="w-step-2" className="font-display text-[2rem] leading-tight text-ink lg:text-[2.5rem]">
              Who&apos;s eating?
            </h1>
            <p className="mt-2 text-[15px] text-ink-2">
              This sizes recipes and keeps suggestions sensible. You can change it any time in Settings.
            </p>

            <div className="mt-8 flex items-center justify-between gap-4 rounded-2xl bg-surface p-4">
              <div>
                <p className="text-[15px] font-medium text-ink">People in the household</p>
                <p className="text-sm text-ink-2">Including little ones.</p>
              </div>
              <Stepper value={profile.people} onChange={(v) => setProfile({ people: v })} min={1} label="people" />
            </div>

            <div className="mt-6">
              <p className="mb-2 text-sm font-medium text-ink-2">Ways of eating, if any</p>
              <div className="flex flex-wrap gap-2">
                {DIETS.map((d) => {
                  const on = profile.diets.includes(d.value);
                  return (
                    <Chip
                      key={d.value}
                      selected={on}
                      onClick={() =>
                        setProfile({ diets: on ? profile.diets.filter((x) => x !== d.value) : [...profile.diets, d.value] })
                      }
                    >
                      {d.label}
                    </Chip>
                  );
                })}
              </div>
            </div>

            <div className="mt-6">
              <label htmlFor="w-allergy" className="mb-2 block text-sm font-medium text-ink-2">
                Allergies, if any
              </label>
              {profile.allergies.length > 0 && (
                <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Allergies added">
                  {profile.allergies.map((a) => (
                    <li
                      key={a}
                      className="inline-flex h-8 items-center gap-1 rounded-full bg-surface-2 pl-3 pr-1 text-sm font-medium text-ink"
                    >
                      {a}
                      <button
                        type="button"
                        aria-label={`Remove ${a}`}
                        onClick={() => setProfile({ allergies: profile.allergies.filter((x) => x !== a) })}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-ink-3 hover:bg-line hover:text-ink"
                      >
                        <X size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex gap-2">
                <Input
                  id="w-allergy"
                  value={allergyDraft}
                  onChange={(e) => setAllergyDraft(e.target.value)}
                  onKeyDown={onAllergyKey}
                  onBlur={addAllergy}
                  placeholder="Peanuts, shellfish, egg…"
                  autoComplete="off"
                />
                <Button variant="secondary" onClick={addAllergy} disabled={!allergyDraft.trim()} className="shrink-0">
                  Add
                </Button>
              </div>
            </div>

            <div className="mt-auto pt-10">
              <Button size="lg" block onClick={() => setStep(2)}>
                Next
              </Button>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="mt-2 flex h-11 w-full items-center justify-center rounded-full text-sm font-medium text-ink-2 hover:bg-surface-2"
              >
                Skip this for now
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <section aria-labelledby="w-step-3" className="flex flex-1 flex-col py-8">
            <h1 id="w-step-3" className="font-display text-[2rem] leading-tight text-ink lg:text-[2.5rem]">
              How do you want to start?
            </h1>
            <p className="mt-2 text-[15px] text-ink-2">Pick one. The others are always a tap away from the Add button.</p>

            <div className="mt-8 flex flex-col gap-3">
              <StartOption
                href="/add?method=receipt"
                onClick={() => setSettings({ onboarded: true })}
                Icon={Receipt}
                title="Scan your last receipt"
                body="Snap a photo and Larder reads the lines, matches the food and estimates the dates."
                primary
              />
              <StartOption
                href="/add?method=manual"
                onClick={() => setSettings({ onboarded: true })}
                Icon={PencilLine}
                title="Add by hand"
                body="Type what's in the fridge. Quick, and good for a few things at a time."
              />
              <button
                type="button"
                onClick={() => {
                  loadDemoData();
                  finish("/");
                }}
                className="flex w-full items-start gap-4 rounded-[var(--radius-card)] border border-line bg-surface p-4 text-left transition-colors hover:border-primary"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                  <Sparkles size={22} aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-[17px] font-semibold text-ink">Look around with sample food</span>
                  <span className="mt-0.5 block text-sm text-ink-2">
                    A pretend week-old shop, so you can see how things look. Easy to erase later.
                  </span>
                </span>
              </button>
            </div>

            <p className="mt-auto pt-10 text-center text-xs text-ink-3">
              Dates are estimates from Australian food-safety guidance. Printed use-by dates and your own senses always win.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}

function StartOption({
  href,
  onClick,
  Icon,
  title,
  body,
  primary,
}: {
  href: string;
  onClick: () => void;
  Icon: typeof Receipt;
  title: string;
  body: string;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cx(
        "flex items-start gap-4 rounded-[var(--radius-card)] border p-4 transition-colors",
        primary ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface text-ink hover:border-primary",
      )}
    >
      <span
        className={cx(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
          primary ? "bg-primary-ink/15" : "bg-primary-soft text-primary",
        )}
      >
        <Icon size={22} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block text-[17px] font-semibold">{title}</span>
        <span className={cx("mt-0.5 block text-sm", primary ? "text-primary-ink/85" : "text-ink-2")}>{body}</span>
      </span>
    </Link>
  );
}
