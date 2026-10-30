"use client";

import { Share, Smartphone, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button, Card, IconButton } from "@/components/ui";

/**
 * "Add Larder to your home screen" card for the Today screen.
 * Uses the browser's install prompt where there is one (Chrome, Edge, Android) and shows the
 * Share → Add to Home Screen hint on iOS Safari. Hidden once installed or dismissed.
 *
 * The beforeinstallprompt listener is registered when this module loads; app-shell imports it
 * so the event isn't missed before Today mounts.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "larder-install-dismissed";

type State = { prompt: InstallPromptEvent | null; dismissed: boolean; installed: boolean };
let state: State = { prompt: null, dismissed: false, installed: false };
const listeners = new Set<() => void>();
const update = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

if (typeof window !== "undefined") {
  try {
    state.dismissed = localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    /* storage blocked: show the card */
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    update({ prompt: e as InstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => update({ installed: true, prompt: null }));
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const SERVER_STATE: State = { prompt: null, dismissed: true, installed: false };

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  return ios && /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
}

function dismiss() {
  try {
    localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    /* fine: hidden for this session */
  }
  update({ dismissed: true });
}

export function InstallCard({ className }: { className?: string }) {
  const s = useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
  if (s.dismissed || s.installed || isStandalone()) return null;
  const ios = !s.prompt && isIosSafari();
  if (!s.prompt && !ios) return null;

  return (
    <Card className={`flex items-start gap-3 p-4 ${className ?? ""}`}>
      <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-ink">
        <Smartphone size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">Add Larder to your home screen</p>
        {ios ? (
          <p className="mt-1 text-sm text-ink-2">
            Tap <Share size={14} aria-label="Share" className="inline align-[-2px]" /> Share, then Add to Home Screen. It
            opens like an app and works offline.
          </p>
        ) : (
          <>
            <p className="mt-1 text-sm text-ink-2">It opens like an app and works offline.</p>
            <Button
              size="sm"
              className="mt-3"
              onClick={async () => {
                const p = s.prompt;
                if (!p) return;
                update({ prompt: null });
                await p.prompt();
                const choice = await p.userChoice.catch(() => null);
                if (choice?.outcome === "accepted") update({ installed: true });
              }}
            >
              Install Larder
            </Button>
          </>
        )}
      </div>
      <IconButton label="Not now" onClick={dismiss} className="-mr-2 -mt-2">
        <X size={18} />
      </IconButton>
    </Card>
  );
}
