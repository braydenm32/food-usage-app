"use client";

import { create } from "zustand";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { STORAGE_FULL_EVENT, undoChain, useLarder } from "@/lib/store";
import { useCookTimers } from "@/lib/cook-timers";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /**
   * Offer Undo for the store action that just happened. The toast remembers that action's
   * undo id when shown, so Undo never reverts a later, different action.
   */
  undoable?: boolean;
  tone?: "default" | "error";
  /** A second button, e.g. { label: "Add to list", onClick }. The toast closes after it runs. */
  action?: ToastAction;
  /** Override how long it stays, in ms. */
  duration?: number;
}

interface Toast extends ToastOptions {
  id: number;
  message: string;
  /** The store's undo id at the moment the toast was shown. */
  undoId?: string;
  /** Where it renders: the open modal dialog (so it stays usable above it) or the body. */
  host: HTMLElement;
}

/** How many toasts show at once; older ones (and their Undo) go first. */
export const MAX_TOASTS = 3;

let seq = 0;

const useToasts = create<{
  toasts: Toast[];
  show: (t: Toast) => void;
  hide: (id: number) => void;
  /** Drop toasts whose Undo has already been used (e.g. undone along with an older action). */
  prune: () => void;
  rehost: (id: number, host: HTMLElement) => void;
}>((set, get) => ({
  toasts: [],
  show: (t) => {
    // A second toast for the same undo step replaces the first.
    let list = get().toasts.filter((x) => !(t.undoId && x.undoId === t.undoId));
    list = [...list, t];
    while (list.length > MAX_TOASTS) {
      const old = list.shift()!;
      if (old.undoId) useLarder.getState().clearUndo(old.undoId);
    }
    set({ toasts: list });
  },
  hide: (id) => {
    const t = get().toasts.find((x) => x.id === id);
    if (!t) return;
    if (t.undoId) useLarder.getState().clearUndo(t.undoId);
    set({ toasts: get().toasts.filter((x) => x.id !== id) });
  },
  prune: () => {
    const live = new Set(undoChain(useLarder.getState().undo).map((u) => u.id));
    set({ toasts: get().toasts.filter((t) => !t.undoId || live.has(t.undoId)) });
  },
  rehost: (id, host) => set({ toasts: get().toasts.map((t) => (t.id === id && t.host !== host ? { ...t, host } : t)) }),
}));

/** The top-most open modal <dialog>, if any. */
function openModal(): HTMLElement | undefined {
  const open = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]"));
  return open
    .filter((d) => {
      try {
        return d.matches(":modal");
      } catch {
        return true;
      }
    })
    .at(-1);
}

/* ---------- Announcements ---------- */

const LIVE_ATTR = "data-larder-live";

/**
 * A live region that stays in the page (or inside the open dialog, since the rest of the page
 * is inert then). Regions inserted already filled are often not read out, so these are kept
 * empty and only their text changes.
 */
function liveRegion(host: HTMLElement, politeness: "polite" | "assertive"): { el: HTMLElement; fresh: boolean } {
  const existing = host.querySelector<HTMLElement>(`:scope > [${LIVE_ATTR}="${politeness}"]`);
  if (existing) return { el: existing, fresh: false };
  const el = document.createElement("div");
  el.setAttribute(LIVE_ATTR, politeness);
  el.setAttribute("aria-live", politeness);
  el.setAttribute("aria-atomic", "true");
  if (politeness === "assertive") el.setAttribute("role", "alert");
  el.className = "sr-only";
  host.appendChild(el);
  return { el, fresh: true };
}

/** Read a message out to screen readers. */
export function announce(message: string, politeness: "polite" | "assertive" = "polite") {
  if (typeof document === "undefined") return;
  const host = openModal() ?? document.body;
  const { el, fresh } = liveRegion(host, politeness);
  el.textContent = "";
  // Give a just-made region time to register before it gets text.
  setTimeout(() => {
    el.textContent = message;
  }, fresh ? 150 : 50);
}

/**
 * Show a short message. `{ undoable: true }` offers Undo for the store action that just ran
 * (call it right after the action). `{ action: { label, onClick } }` adds a button.
 * Up to three stack, and each keeps its own Undo for its own time.
 */
export function toast(message: string, opts: ToastOptions = {}) {
  if (typeof document === "undefined") return;
  const undoId = opts.undoable ? useLarder.getState().undo?.id : undefined;
  const t: Toast = {
    ...opts,
    message,
    undoable: !!undoId,
    undoId,
    id: ++seq,
    host: openModal() ?? document.body,
  };
  useToasts.getState().show(t);
  const extra = [undoId && "Undo available", opts.action?.label].filter(Boolean).join(". ");
  announce(extra ? `${message}. ${extra}.` : message, opts.tone === "error" ? "assertive" : "polite");
}

function durationFor(t: Toast): number {
  if (t.duration) return t.duration;
  if (t.undoId) return 12_000;
  if (t.action || t.tone === "error") return 8000;
  return 4000;
}

/** Default distance from the bottom of the screen, in px (above the tab bar on phones). */
function baseBottom(timerPill: boolean): number {
  const desktop = window.matchMedia("(min-width: 1024px)").matches;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  if (desktop) return (timerPill ? 6 : 2) * rem;
  return (timerPill ? 9.5 : 7.5) * rem;
}

/**
 * Bottom offset that keeps toasts clear of sticky action bars ("Add 12 items", "Put 3 in the
 * larder"). Bars can opt in with `data-toast-avoid`; sticky elements near the bottom count too.
 */
function avoidBottom(): number {
  const vh = window.innerHeight;
  let top = vh;
  const els = document.querySelectorAll<HTMLElement>("[data-toast-avoid], .sticky");
  els.forEach((el) => {
    if (el.closest("nav, dialog, [popover]")) return;
    if (!el.hasAttribute("data-toast-avoid") && getComputedStyle(el).position !== "sticky") return;
    const r = el.getBoundingClientRect();
    if (r.height === 0 || r.height > vh * 0.4 || r.top < vh * 0.5 || r.top >= vh) return;
    top = Math.min(top, r.top);
  });
  return top < vh ? vh - top + 8 : 0;
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const prune = useToasts((s) => s.prune);
  const undo = useLarder((s) => s.undo);
  const router = useRouter();

  // When an Undo also reverted other actions, their toasts go too.
  useEffect(() => {
    prune();
  }, [undo, prune]);

  // Permanent, empty live regions so the first message is read out too.
  useEffect(() => {
    liveRegion(document.body, "polite");
    liveRegion(document.body, "assertive");
  }, []);

  // A full browser storage gets one clear message.
  useEffect(() => {
    const onFull = () =>
      toast("Storage is full, so recent changes may not be saved. Export a backup in Settings.", {
        tone: "error",
        duration: 15_000,
        action: { label: "Settings", onClick: () => router.push("/settings") },
      });
    window.addEventListener(STORAGE_FULL_EVENT, onFull);
    return () => window.removeEventListener(STORAGE_FULL_EVENT, onFull);
  }, [router]);

  if (toasts.length === 0) return null;
  const hosts = [...new Set(toasts.map((t) => t.host))];
  return (
    <>
      {hosts.map((host, i) =>
        createPortal(
          <ToastStack key={i} host={host} toasts={toasts.filter((t) => t.host === host)} />,
          host,
          host === document.body ? "body" : `dialog-${i}`,
        ),
      )}
    </>
  );
}

function ToastStack({ host, toasts }: { host: HTMLElement; toasts: Toast[] }) {
  const ref = useRef<HTMLDivElement>(null);
  // Sit above the cooking timer pill when one is showing.
  const timerPill = useCookTimers((s) => s.timers.length > 0);
  const [bottom, setBottom] = useState<number | null>(null);
  const onBody = host === document.body;

  // Enter the top layer so the toasts sit above any open sheet.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.showPopover !== "function") return;
    try {
      if (el.matches(":popover-open")) el.hidePopover();
      el.showPopover();
    } catch {
      /* not supported: falls back to a fixed element */
    }
  }, []);

  // Keep clear of sticky bottom bars, as the page scrolls or resizes.
  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setBottom(Math.max(baseBottom(timerPill), onBody ? avoidBottom() : 0)));
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [timerPill, onBody, toasts.length]);

  return (
    <div
      ref={ref}
      popover="manual"
      className="pointer-events-none fixed inset-x-0 top-auto z-[60] m-0 flex h-auto w-full max-w-none flex-col items-center gap-2 overflow-visible border-0 bg-transparent p-0 px-4"
      style={{
        bottom: bottom === null ? "calc(7.5rem + env(safe-area-inset-bottom))" : `calc(${bottom}px + env(safe-area-inset-bottom))`,
      }}
    >
      {toasts.map((t) => (
        <ToastView key={t.id} t={t} />
      ))}
    </div>
  );
}

function ToastView({ t }: { t: Toast }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(durationFor(t));
  const canUndo = useLarder((s) => !!t.undoId && undoChain(s.undo).some((u) => u.id === t.undoId));
  const performUndo = useLarder((s) => s.performUndo);
  const hide = useToasts((s) => s.hide);
  const rehost = useToasts((s) => s.rehost);

  // If the sheet we live in closes or unmounts, move to the page.
  useEffect(() => {
    const host = t.host;
    if (host === document.body) return;
    const toBody = () => rehost(t.id, document.body);
    host.addEventListener("close", toBody);
    const poll = setInterval(() => {
      if (!host.isConnected || (host instanceof HTMLDialogElement && !host.open)) toBody();
    }, 250);
    return () => {
      host.removeEventListener("close", toBody);
      clearInterval(poll);
    };
  }, [t.host, t.id, rehost]);

  // Auto-close, paused while hovered or focused.
  const paused = hovered || focused;
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = setTimeout(() => hide(t.id), Math.max(1000, remaining.current));
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [paused, hide, t.id]);

  const btn =
    "relative rounded-lg px-2 py-1 font-semibold underline-offset-2 hover:underline after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-['']";

  return (
    <div
      role="group"
      aria-label="Notification"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      className={`animate-toast-in pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-sm shadow-card ${
        t.tone === "error" ? "bg-spoiled text-on-status" : "bg-ink text-paper"
      }`}
    >
      <span className="flex-1">{t.message}</span>
      {canUndo && (
        <button
          type="button"
          onClick={() => {
            const n = performUndo(t.undoId);
            hide(t.id);
            announce(n > 1 ? `Undone, with ${n - 1} later change${n === 2 ? "" : "s"} to the same food` : "Undone");
          }}
          className={btn}
        >
          Undo
        </button>
      )}
      {t.action && (
        <button
          type="button"
          onClick={() => {
            t.action?.onClick();
            hide(t.id);
          }}
          className={btn}
        >
          {t.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => hide(t.id)}
        aria-label="Dismiss"
        className="relative -mr-1 rounded-lg p-1 opacity-70 hover:opacity-100 after:absolute after:-inset-2.5 after:content-['']"
      >
        <X size={16} />
      </button>
    </div>
  );
}
