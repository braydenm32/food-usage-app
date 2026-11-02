"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ClipboardPaste, CookingPot, Leaf, PencilLine, Receipt, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useLarder } from "@/lib/store";
import { Button, cx } from "@/components/ui";
import { FreshnessBar, StatusPill } from "@/components/freshness";

const STEPS = ["What Larder does", "How to start"];

/** Reminders only "remind" when background push is set up on this install. */
const PUSH_ON = Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY);

export default function WelcomePage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const setSettings = useLarder((s) => s.setSettings);
  const loadDemoData = useLarder((s) => s.loadDemoData);
  // Whether photo reading is set up on this install. Until we know, assume it is.
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/scan")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { configured?: boolean } | null) => {
        if (!cancelled && j && typeof j.configured === "boolean") setAiConfigured(j.configured);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const finish = (to: string) => {
    setSettings({ onboarded: true });
    router.push(to);
  };

  const aiOn = aiConfigured !== false;
  const intro = PUSH_ON
    ? "Larder keeps a quiet eye on your fridge, freezer and pantry. It estimates when things will turn, reminds you before they do, and turns what's left into dinner."
    : "Larder keeps a quiet eye on your fridge, freezer and pantry. It estimates when things will turn, shows you what to eat first, and turns what's left into dinner.";
  const points = [
    aiOn
      ? { Icon: Receipt, tint: "bg-primary-soft text-primary", text: "Add a whole shop from a receipt in seconds" }
      : { Icon: ClipboardPaste, tint: "bg-primary-soft text-primary", text: "Paste an order or list and it sorts itself" },
    { Icon: Leaf, tint: "bg-fresh-soft text-fresh", text: "See what to use today, honestly estimated" },
    { Icon: CookingPot, tint: "bg-soon-soft text-soon", text: "Get recipes for what's about to turn" },
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      {/* Top bar: progress + skip */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-5 pt-[calc(1rem+env(safe-area-inset-top))] lg:mx-auto lg:w-full lg:max-w-xl lg:px-0 lg:pt-10">
        <div className="flex items-center justify-start">
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
        </div>
        {/* Step indicator sits on its own in the middle, away from the logo. */}
        <div className="flex items-center gap-2.5" aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`} role="group">
          <ol className="flex items-center gap-1.5" aria-hidden>
            {STEPS.map((label, i) => (
              <li
                key={label}
                className={cx(
                  "h-1.5 rounded-full transition-all",
                  i === step ? "w-6 bg-primary" : i < step ? "w-2.5 bg-primary/50" : "w-2.5 bg-control-line",
                )}
              />
            ))}
          </ol>
          <span className="text-xs tabular-nums text-ink-3" aria-hidden>
            {step + 1} of {STEPS.length}
          </span>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => finish("/")}
            className="-mr-3 flex h-11 items-center gap-1 rounded-full px-3 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            Skip
            <X size={16} aria-hidden />
          </button>
        </div>
      </div>

      {/* A div, not <main>: the app shell already provides the page's main landmark. */}
      <div className="flex flex-1 flex-col px-5 lg:mx-auto lg:w-full lg:max-w-xl lg:px-0">
        {step === 0 && (
          <section aria-labelledby="w-step-1" className="flex flex-1 flex-col pb-6 pt-8">
            <h1 id="w-step-1" className="font-display text-[2.4rem] leading-[1.05] text-ink sm:text-[3.2rem] lg:text-[3.6rem]">
              Know what&apos;s in your kitchen, <span className="text-primary">what to eat first</span>, and what to cook
              with it.
            </h1>
            <p className="mt-5 max-w-md text-[17px] leading-relaxed text-ink-2">{intro}</p>

            <FreshnessPreview />

            <ul className="mt-6 grid gap-2 text-[15px] text-ink-2 sm:grid-cols-3">
              {points.map(({ Icon, tint, text }) => (
                <li key={text} className="flex items-center gap-3 rounded-2xl p-1 sm:flex-col sm:items-start">
                  <span aria-hidden className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", tint)}>
                    <Icon size={20} />
                  </span>
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {step === 1 && (
          <section aria-labelledby="w-step-2" className="flex flex-1 flex-col pt-8">
            <h1 id="w-step-2" className="font-display text-[2rem] leading-tight text-ink lg:text-[2.5rem]">
              How do you want to start?
            </h1>
            <p className="mt-2 text-[15px] text-ink-2">Pick one. The others are always a tap away from the Add button.</p>

            <div className="mt-8 flex flex-col gap-3">
              {aiConfigured === false ? (
                // Photo reading isn't set up on this install, so pasting is the quickest honest start.
                <StartOption
                  href="/add?method=paste"
                  onClick={() => setSettings({ onboarded: true })}
                  Icon={ClipboardPaste}
                  title="Paste a list"
                  body="Paste an online order or a list of what you bought. Larder sorts it into the larder with estimated dates."
                  primary
                />
              ) : (
                <StartOption
                  href="/add?method=receipt"
                  onClick={() => setSettings({ onboarded: true })}
                  Icon={Receipt}
                  title="Scan your last receipt"
                  body="Snap a photo and Larder reads the lines, matches the food and estimates the dates."
                  primary
                />
              )}
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

            <p className="mt-auto pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-10 text-center text-xs text-ink-3">
              Dates are estimates from Australian food-safety guidance. Printed use-by dates and your own senses always win.
            </p>
          </section>
        )}
      </div>

      {step === 0 && (
        // Pinned to the safe-area bottom so the call to action is always in thumb reach.
        <div className="sticky bottom-0 bg-paper/90 px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur-md lg:mx-auto lg:w-full lg:max-w-xl lg:px-0">
          <Button size="lg" block onClick={() => setStep(1)}>
            Get started
          </Button>
          <p className="mt-3 text-center text-xs text-ink-3">Nothing leaves your device. No account needed.</p>
        </div>
      )}
    </div>
  );
}

/** A small, static freshness card built from the real components, so the first screen shows the product. */
function FreshnessPreview() {
  const rows = [
    { name: "Baby spinach", where: "Fridge", status: "use-today" as const, label: "Use today", fraction: 0.1 },
    { name: "Chicken thighs", where: "Fridge", status: "use-soon" as const, label: "2 days left", fraction: 0.35 },
    { name: "Greek yoghurt", where: "Fridge", status: "fresh" as const, label: "9 days left", fraction: 0.85 },
  ];
  return (
    <div
      role="img"
      aria-label="Example: baby spinach to use today, chicken thighs with 2 days left, Greek yoghurt with 9 days left"
      className="mt-7 rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-card"
    >
      <p aria-hidden className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">
        Eat first
      </p>
      <ul aria-hidden className="flex flex-col gap-3.5">
        {rows.map((r) => (
          <li key={r.name}>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold text-ink">{r.name}</span>
                <span className="block text-xs text-ink-3">{r.where}</span>
              </span>
              <StatusPill status={r.status}>{r.label}</StatusPill>
            </div>
            <FreshnessBar status={r.status} fraction={r.fraction} />
          </li>
        ))}
      </ul>
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
