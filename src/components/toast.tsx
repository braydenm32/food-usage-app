"use client";

import { create } from "zustand";
import { useEffect } from "react";
import { X } from "lucide-react";
import { useLarder } from "@/lib/store";

interface Toast {
  id: number;
  message: string;
  /** Show an Undo button that reverts the store's last undoable action. */
  undoable?: boolean;
  tone?: "default" | "error";
}

const useToasts = create<{ toast: Toast | null; show: (t: Omit<Toast, "id">) => void; hide: () => void }>((set) => ({
  toast: null,
  show: (t) => set({ toast: { ...t, id: Date.now() } }),
  hide: () => set({ toast: null }),
}));

/** Show a short message. Pass undoable to offer Undo for the last store action. */
export function toast(message: string, opts: { undoable?: boolean; tone?: Toast["tone"] } = {}) {
  useToasts.getState().show({ message, ...opts });
}

export function Toaster() {
  const t = useToasts((s) => s.toast);
  const hide = useToasts((s) => s.hide);
  const performUndo = useLarder((s) => s.performUndo);

  useEffect(() => {
    if (!t) return;
    const timer = setTimeout(hide, t.undoable ? 6000 : 3500);
    return () => clearTimeout(timer);
  }, [t, hide]);

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] lg:bottom-8"
    >
      {t && (
        <div
          key={t.id}
          role="status"
          className={`animate-toast-in pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl px-4 py-3 text-sm shadow-card ${
            t.tone === "error" ? "bg-spoiled text-white" : "bg-ink text-paper"
          }`}
        >
          <span className="flex-1">{t.message}</span>
          {t.undoable && (
            <button
              type="button"
              onClick={() => {
                performUndo();
                hide();
              }}
              className="rounded-lg px-2 py-1 font-semibold underline-offset-2 hover:underline"
            >
              Undo
            </button>
          )}
          <button type="button" onClick={hide} aria-label="Dismiss" className="rounded-lg p-1 opacity-70 hover:opacity-100">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
