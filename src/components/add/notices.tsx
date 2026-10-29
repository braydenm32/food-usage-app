"use client";

import Link from "next/link";
import { AlertCircle, Sparkles } from "lucide-react";
import { buttonClass, cx } from "@/components/ui";

/** Shown when a photo can't be read because AI isn't configured on the server. */
export function AiUnavailable({ what }: { what: "receipt" | "list" }) {
  return (
    <div role="status" className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
          <Sparkles size={18} />
        </span>
        <div>
          <p className="font-semibold text-ink">Photo reading isn’t switched on here yet</p>
          <p className="mt-1 text-[15px] text-ink-2">
            Reading {what === "receipt" ? "receipts" : "photos of lists"} needs an AI key on the server. You can still get
            everything in quickly another way.
          </p>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Link href="/add?method=paste" className={buttonClass("primary", "md")}>
          Paste or type the list instead
        </Link>
        <Link href="/add?method=manual" className={buttonClass("secondary", "md")}>
          Add by hand
        </Link>
      </div>
    </div>
  );
}

export function ErrorNotice({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="alert" className={cx("flex items-start gap-2.5 rounded-2xl bg-spoiled-soft px-4 py-3 text-[15px] text-spoiled", className)}>
      <AlertCircle size={18} aria-hidden className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

export function InfoNotice({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div role="status" className={cx("flex items-start gap-2.5 rounded-2xl bg-soon-soft px-4 py-3 text-[15px] text-ink", className)}>
      <AlertCircle size={18} aria-hidden className="mt-0.5 shrink-0 text-soon" />
      <div>{children}</div>
    </div>
  );
}
