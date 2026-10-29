"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Camera, ImageUp, Loader2 } from "lucide-react";
import { Button, cx } from "@/components/ui";
import type { ApiError, ParseResponse } from "@/lib/drafts";
import { downscaleImage } from "./image";
import { AiUnavailable, ErrorNotice } from "./notices";

const coarseQuery = "(pointer: coarse)";
function useIsTouch() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(coarseQuery);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(coarseQuery).matches,
    () => false,
  );
}

type State =
  | { kind: "idle" }
  | { kind: "reading"; preview: string }
  | { kind: "error"; message: string; preview?: string }
  | { kind: "no-ai" };

const COPY = {
  receipt: {
    tips: ["Lay it flat in good light", "Get the whole receipt in, top to bottom", "Long receipt? Fold it so the items fit"],
    reading: "Reading your receipt…",
    readingSub: "Matching each line to a food. This takes about 10 seconds.",
  },
  list: {
    tips: ["Handwritten or printed both work", "Get close enough that the writing is clear", "One list per photo"],
    reading: "Reading your list…",
    readingSub: "Working out each item. This takes a few seconds.",
  },
} as const;

export function PhotoCapture({ kind, onResult }: { kind: "receipt" | "list"; onResult: (r: ParseResponse) => void }) {
  const isTouch = useIsTouch();
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const copy = COPY[kind];

  useEffect(() => () => abortRef.current?.abort(), []);

  // Find out up front whether photo reading is set up, so nobody takes a photo for nothing.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/scan")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { configured?: boolean } | null) => {
        if (!cancelled && j && j.configured === false) setState({ kind: "no-ai" });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) {
      setState({ kind: "error", message: "That isn’t a photo. Choose a JPEG, PNG or HEIC image." });
      return;
    }
    let upload: Blob;
    try {
      upload = await downscaleImage(file);
    } catch {
      if (["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 8 * 1024 * 1024) {
        upload = file;
      } else {
        setState({ kind: "error", message: "Couldn’t open that photo. Try a JPEG or PNG, or take a new photo." });
        return;
      }
    }
    const preview = URL.createObjectURL(upload);
    setState({ kind: "reading", preview });

    const form = new FormData();
    form.append("kind", kind);
    form.append("image", upload, "photo.jpg");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/scan", { method: "POST", body: form, signal: ac.signal });
      if (res.status === 503) {
        setState({ kind: "no-ai" });
        return;
      }
      const json = (await res.json().catch(() => null)) as ParseResponse | ApiError | null;
      if (!res.ok || !json || !("drafts" in json)) {
        setState({
          kind: "error",
          preview,
          message: (json && "message" in json && json.message) || "Something went wrong reading that photo. Try again.",
        });
        return;
      }
      onResult(json);
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        setState({ kind: "idle" });
        return;
      }
      setState({
        kind: "error",
        preview,
        message: navigator.onLine
          ? "Couldn’t reach Larder to read the photo. Try again in a moment."
          : "You’re offline. Reading photos needs a connection. You can add by hand meanwhile.",
      });
    }
  }

  if (state.kind === "no-ai") return <AiUnavailable what={kind} />;

  if (state.kind === "reading") {
    return (
      <div className="flex flex-col items-center gap-5 py-6 text-center" aria-live="polite">
        <div className="relative h-56 w-40 overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-card">
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
          <img src={state.preview} alt="" className="h-full w-full object-cover" />
          <div aria-hidden className="absolute inset-x-0 top-0 h-1/3 animate-pulse bg-primary/15" />
        </div>
        <div>
          <p className="flex items-center justify-center gap-2 font-display text-xl text-ink">
            <Loader2 size={20} aria-hidden className="animate-spin text-primary" />
            {copy.reading}
          </p>
          <p className="mt-1 text-[15px] text-ink-2">{copy.readingSub}</p>
        </div>
        <Button variant="ghost" onClick={() => abortRef.current?.abort()}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {state.kind === "error" && (
        <ErrorNotice>
          {state.message}{" "}
          <Link href="/add?method=paste" className="font-semibold underline underline-offset-2">
            Paste or type the list instead
          </Link>
        </ErrorNotice>
      )}

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*,.heic,.heif"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {isTouch ? (
        <div className="flex flex-col gap-3">
          <Button size="lg" block onClick={() => cameraRef.current?.click()}>
            <Camera size={20} aria-hidden />
            Take a photo
          </Button>
          <Button size="lg" variant="secondary" block onClick={() => fileRef.current?.click()}>
            <ImageUp size={20} aria-hidden />
            Choose from your photos
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void handleFile(e.dataTransfer.files?.[0]);
          }}
          className={cx(
            "flex flex-col items-center gap-3 rounded-[var(--radius-card)] border-2 border-dashed px-6 py-12 text-center transition-colors",
            dragging ? "border-primary bg-primary-soft" : "border-line bg-surface hover:border-primary",
          )}
        >
          <span aria-hidden className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-primary">
            <ImageUp size={26} />
          </span>
          <span className="font-display text-xl text-ink">Choose a photo of your {kind}</span>
          <span className="text-[15px] text-ink-2">or drop it here. JPEG, PNG or HEIC.</span>
        </button>
      )}

      <ul className="flex flex-col gap-1.5 text-[15px] text-ink-2">
        {copy.tips.map((t) => (
          <li key={t} className="flex gap-2">
            <span aria-hidden className="text-primary">
              ·
            </span>
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}
