"use client";

import { create } from "zustand";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { STORAGE_FULL_EVENT, useLarder } from "@/lib/store";

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

let seq = 0;

const useToasts = create<{
  toast: Toast | null;
  show: (t: Toast) => void;
  hide: (id?: number) => void;
  rehost: (id: number, host: HTMLElement) => void;
}>((set, get) => ({
  toast: null,
  show: (t) => {
    const prev = get().toast;
    // The previous toast's Undo is gone once it is replaced.
    if (prev?.undoId && prev.undoId !== t.undoId) useLarder.getState().clearUndo(prev.undoId);
    set({ toast: t });
  },
  hide: (id) => {
    const t = get().toast;
    if (!t || (id !== undefined && t.id !== id)) return;
    if (t.undoId) useLarder.getState().clearUndo(t.undoId);
    set({ toast: null });
  },
  rehost: (id, host) => {
    const t = get().toast;
    if (t && t.id === id && t.host !== host) set({ toast: { ...t, host } });
  },
}));

/** The top-most open modal <dialog>, if any. */
function openModal(): HTMLElement | undefined {
  const open = Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]"));
  return open.filter((d) => {
    try {
      return d.matches(":modal");
    } catch {
      return true;
    }
  }).at(-1);
}

/**
 * Show a short message. `{ undoable: true }` offers Undo for the store action that just ran
 * (call it right after the action). `{ action: { label, onClick } }` adds a button.
 */
export function toast(message: string, opts: ToastOptions = {}) {
  if (typeof document === "undefined") return;
  const undoId = opts.undoable ? useLarder.getState().undo?.id : undefined;
  useToasts.getState().show({
    ...opts,
    message,
    undoable: !!undoId,
    undoId,
    id: ++seq,
    host: openModal() ?? document.body,
  });
}

function durationFor(t: Toast): number {
  if (t.duration) return t.duration;
  if (t.undoId) return 10_000;
  if (t.action || t.tone === "error") return 8000;
  return 4000;
}

export function Toaster() {
  const t = useToasts((s) => s.toast);
  const router = useRouter();

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

  if (!t) return null;
  return createPortal(<ToastView key={`${t.id}-${t.host === document.body ? "b" : "d"}`} t={t} />, t.host);
}

function ToastView({ t }: { t: Toast }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(durationFor(t));
  const currentUndoId = useLarder((s) => s.undo?.id);
  const performUndo = useLarder((s) => s.performUndo);
  const hide = useToasts((s) => s.hide);
  const rehost = useToasts((s) => s.rehost);
  const canUndo = !!t.undoId && t.undoId === currentUndoId;

  // Enter the top layer so the toast sits above any open sheet.
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
      ref={ref}
      popover="manual"
      aria-live={t.tone === "error" ? "assertive" : "polite"}
      className="pointer-events-none fixed inset-x-0 top-auto bottom-[calc(7.5rem+env(safe-area-inset-bottom))] z-[60] m-0 flex h-auto w-full max-w-none justify-center overflow-visible border-0 bg-transparent p-0 px-4 lg:bottom-8"
    >
      <div
        role={t.tone === "error" ? "alert" : "status"}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
        }}
        className={`animate-toast-in pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-sm shadow-card ${
          t.tone === "error" ? "bg-spoiled text-on-status" : "bg-ink text-paper"
        }`}
      >
        <span className="flex-1">{t.message}</span>
        {canUndo && (
          <button
            type="button"
            onClick={() => {
              performUndo(t.undoId);
              hide(t.id);
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
    </div>
  );
}
