"use client";

import Link from "next/link";
import { useId } from "react";
import { cx } from "@/components/ui";

/** One line shown where photos or text are about to be sent for reading (APP 5 notice). */
export function AiCollectionNotice({ className, what = "Photos and text" }: { className?: string; what?: string }) {
  return (
    <p className={cx("text-xs leading-relaxed text-ink-3", className)}>
      {what} are sent to Anthropic (USA) to read them. Larder doesn&apos;t keep them.{" "}
      <Link href="/privacy#anthropic" className="font-medium text-primary underline underline-offset-2">
        Privacy
      </Link>
    </p>
  );
}

/** Same notice, worded for recipe ideas, which send the food list (and the household's diets, if allowed). */
export function AiIdeasNotice({ className }: { className?: string }) {
  return (
    <p className={cx("text-xs leading-relaxed text-ink-3", className)}>
      Your food list is sent to Anthropic (USA) to think up ideas. Larder doesn&apos;t keep it.{" "}
      <Link href="/privacy#anthropic" className="font-medium text-primary underline underline-offset-2">
        Privacy
      </Link>
    </p>
  );
}

/** Consent line shown before diets and allergies are saved (they can reveal health or beliefs). */
export function SensitiveConsent({
  checked,
  onChange,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cx("rounded-2xl bg-soon-soft p-3", className)}>
      <label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-sm text-ink">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--primary)]"
        />
        <span>
          These are shared with everyone in your household and sent to the AI when you ask for recipe ideas. Only add other people&apos;s details with their OK.{" "}
          <Link href="/privacy#sensitive" className="font-medium text-primary underline underline-offset-2">
            Read more
          </Link>
        </span>
      </label>
    </div>
  );
}
