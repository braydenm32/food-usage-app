"use client";

import Link from "next/link";
import { AI_QUOTA_COPY, aiSignInCopy, type AiDenial } from "@/lib/ai-client";

/**
 * The words (and the sign-in link) for an AI request that was refused for sign-in or the daily
 * limit. `feature` words the sign-in line for what was asked ("recipe ideas").
 */
export function AiDeniedMessage({ why, message, feature }: { why: AiDenial; message?: string; feature?: string }) {
  if (why === "quota") return <>{message || AI_QUOTA_COPY}</>;
  return (
    <>
      {message || aiSignInCopy(feature)}{" "}
      <Link href="/account" className="font-semibold underline underline-offset-2">
        Sign in
      </Link>
    </>
  );
}
