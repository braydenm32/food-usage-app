"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PantryItem } from "@/lib/types";
import type { ReviewDraft } from "@/lib/drafts";

export type AddMethod = "receipt" | "list" | "paste" | "barcode" | "manual";

export const METHODS: AddMethod[] = ["receipt", "list", "paste", "barcode", "manual"];

export function isMethod(v: string | null | undefined): v is AddMethod {
  return !!v && (METHODS as string[]).includes(v);
}

/** Drafts in progress for one add method. Kept in sessionStorage so a refresh mid-review keeps the work. */
export interface AddSession {
  drafts: ReviewDraft[];
  source: PantryItem["source"];
  storeName?: string | null;
  note?: string;
  updatedAt: number;
}

const KEY = (m: AddMethod) => `larder-add:${m}`;

export const DEFAULT_SOURCE: Record<AddMethod, PantryItem["source"]> = {
  receipt: "receipt",
  list: "list",
  paste: "list",
  barcode: "barcode",
  manual: "manual",
};

export function readSession(method: AddMethod): AddSession | null {
  try {
    const raw = sessionStorage.getItem(KEY(method));
    if (!raw) return null;
    const s = JSON.parse(raw) as AddSession;
    return Array.isArray(s.drafts) ? s : null;
  } catch {
    return null;
  }
}

function writeSession(method: AddMethod, s: AddSession | null) {
  try {
    if (!s || s.drafts.length === 0) sessionStorage.removeItem(KEY(method));
    else sessionStorage.setItem(KEY(method), JSON.stringify(s));
  } catch {
    // Storage full or blocked: the review still works, it just won't survive a refresh.
  }
}

/** Methods with unfinished drafts, for the "pick up where you left off" banner. */
export function pendingSessions(): { method: AddMethod; count: number }[] {
  return METHODS.map((m) => ({ method: m, count: readSession(m)?.drafts.length ?? 0 })).filter((x) => x.count > 0);
}

/**
 * Session state for one method. Must only be used after hydration (reads sessionStorage in the initialiser).
 */
export function useAddSession(method: AddMethod) {
  const [session, setSessionState] = useState<AddSession>(
    () => readSession(method) ?? { drafts: [], source: DEFAULT_SOURCE[method], updatedAt: Date.now() },
  );
  const methodRef = useRef(method);

  // Different method in the same mounted component: load its own session.
  useEffect(() => {
    if (methodRef.current === method) return;
    methodRef.current = method;
    setSessionState(readSession(method) ?? { drafts: [], source: DEFAULT_SOURCE[method], updatedAt: Date.now() });
  }, [method]);

  useEffect(() => {
    writeSession(methodRef.current, session);
  }, [session]);

  const setSession = useCallback((update: (s: AddSession) => AddSession) => {
    setSessionState((s) => ({ ...update(s), updatedAt: Date.now() }));
  }, []);

  const setDrafts = useCallback(
    (update: (d: ReviewDraft[]) => ReviewDraft[]) => setSession((s) => ({ ...s, drafts: update(s.drafts) })),
    [setSession],
  );

  const clear = useCallback(() => {
    writeSession(methodRef.current, null);
    setSessionState({ drafts: [], source: DEFAULT_SOURCE[methodRef.current], updatedAt: Date.now() });
  }, []);

  return { session, setSession, setDrafts, clear };
}
