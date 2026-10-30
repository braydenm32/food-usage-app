"use client";

import { useEffect, useState } from "react";

const KEY = "larder-ai-configured";
let cached: boolean | undefined;

function readCache(): boolean | undefined {
  if (cached !== undefined) return cached;
  try {
    const v = sessionStorage.getItem(KEY);
    if (v === "1" || v === "0") cached = v === "1";
  } catch {
    // Storage blocked: ask the server instead.
  }
  return cached;
}

/**
 * Whether photo reading (AI) is set up on the server: `undefined` while unknown or offline.
 * Asked once per tab and remembered for the session, so the add hub doesn't reshuffle on every visit.
 */
export function useAiConfigured(): boolean | undefined {
  const [configured, setConfigured] = useState<boolean | undefined>(readCache);

  useEffect(() => {
    if (configured !== undefined) return;
    let cancelled = false;
    fetch("/api/scan")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { configured?: boolean } | null) => {
        if (cancelled || typeof j?.configured !== "boolean") return;
        cached = j.configured;
        try {
          sessionStorage.setItem(KEY, j.configured ? "1" : "0");
        } catch {
          // Fine: it's only a cache.
        }
        setConfigured(j.configured);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [configured]);

  return configured;
}
