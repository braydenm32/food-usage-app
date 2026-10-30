"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Camera, CameraOff, Check, Flashlight, FlashlightOff } from "lucide-react";
import { Button, IconButton, Input, cx } from "@/components/ui";

type CamState = "starting" | "scanning" | "denied" | "unavailable" | "error" | "stopped";

interface DetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
interface DetectorCtor {
  new (opts?: { formats?: string[] }): DetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];
const REPEAT_MS = 2500;

/**
 * Live barcode scanner with the rear camera. Uses the native BarcodeDetector when present,
 * otherwise ZXing. Calls onCode once per distinct scan (the same code again after a pause counts).
 */
export function BarcodeScanner({ onCode }: { onCode: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stopLoopRef = useRef<(() => void) | null>(null);
  const lastRef = useRef<{ code: string; at: number } | null>(null);
  const onCodeRef = useRef(onCode);
  const [state, setState] = useState<CamState>("starting");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [manual, setManual] = useState("");
  const [ok, setOk] = useState(false);
  const okTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualId = useId();

  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  const emit = useCallback((raw: string) => {
    const code = raw.trim();
    if (!/^\d{6,14}$/.test(code)) return;
    const now = Date.now();
    const last = lastRef.current;
    if (last && last.code === code && now - last.at < REPEAT_MS) {
      last.at = now; // still pointing at it: keep suppressing
      return;
    }
    lastRef.current = { code, at: now };
    navigator.vibrate?.(40);
    setOk(true);
    if (okTimer.current) clearTimeout(okTimer.current);
    okTimer.current = setTimeout(() => setOk(false), 700);
    onCodeRef.current(code);
  }, []);

  const stop = useCallback(() => {
    stopLoopRef.current?.();
    stopLoopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setTorchOn(false);
  }, []);

  const start = useCallback(async () => {
    stop();
    setState("starting");
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("unavailable");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (e) {
      const name = (e as DOMException).name;
      setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" || name === "OverconstrainedError" ? "unavailable" : "error");
      return;
    }
    streamRef.current = stream;
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    await video.play().catch(() => {});

    const track = stream.getVideoTracks()[0];
    const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
    setTorchSupported(!!caps.torch);

    const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
    let usedNative = false;
    if (Native) {
      try {
        const supported = (await Native.getSupportedFormats?.()) ?? FORMATS;
        const formats = FORMATS.filter((f) => supported.includes(f));
        if (formats.length) {
          const detector = new Native({ formats });
          let active = true;
          let timer: ReturnType<typeof setTimeout>;
          const tick = async () => {
            if (!active) return;
            if (video.readyState >= 2) {
              try {
                const found = await detector.detect(video);
                if (found[0]?.rawValue) emit(found[0].rawValue);
              } catch {
                // a frame can fail to decode; keep going
              }
            }
            timer = setTimeout(tick, 200);
          };
          void tick();
          stopLoopRef.current = () => {
            active = false;
            clearTimeout(timer);
          };
          usedNative = true;
        }
      } catch {
        usedNative = false;
      }
    }

    if (!usedNative) {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 150 });
        const controls = await reader.decodeFromStream(stream, video, (result) => {
          if (result) emit(result.getText());
        });
        stopLoopRef.current = () => controls.stop();
      } catch {
        stop();
        setState("error");
        return;
      }
    }
    setState("scanning");
  }, [emit, stop]);

  useEffect(() => {
    // Starting the camera is an external side effect; state updates happen after awaits.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void start();
    return stop;
  }, [start, stop]);

  // Pause the camera when the tab is hidden, resume when back.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        stop();
        setState("stopped");
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [stop]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] });
      setTorchOn(!torchOn);
    } catch {
      setTorchSupported(false);
    }
  }

  const live = state === "scanning" || state === "starting";

  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[var(--radius-card)] bg-ink lg:aspect-video">
        <video ref={videoRef} muted playsInline className={cx("h-full w-full object-cover", !live && "hidden")} aria-hidden />

        {live && (
          <>
            {/* Viewfinder: a clear window over a dimmed frame */}
            <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className={cx(
                  "relative h-[38%] w-[78%] max-w-md rounded-2xl shadow-[0_0_0_9999px_rgb(0_0_0/0.45)] transition-colors",
                  ok && "bg-fresh/25",
                )}
              >
                {(["left-0 top-0 border-l-4 border-t-4 rounded-tl-2xl", "right-0 top-0 border-r-4 border-t-4 rounded-tr-2xl", "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-2xl", "bottom-0 right-0 border-b-4 border-r-4 rounded-br-2xl"] as const).map(
                  (pos) => (
                    <span key={pos} className={cx("absolute h-7 w-7 transition-colors", ok ? "border-fresh" : "border-white", pos)} />
                  ),
                )}
                {ok ? (
                  <Check size={40} strokeWidth={3} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white" />
                ) : (
                  <span className="absolute inset-x-4 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-today/80 motion-safe:animate-pulse" />
                )}
              </div>
            </div>
            <p className="absolute inset-x-0 bottom-3 text-center text-sm font-medium text-white" aria-live="polite">
              {state === "starting" ? "Starting camera…" : "Point at a barcode. Keep scanning, we’ll add each one."}
            </p>
            {torchSupported && (
              <IconButton
                label={torchOn ? "Turn torch off" : "Turn torch on"}
                onClick={() => void toggleTorch()}
                aria-pressed={torchOn}
                className="absolute right-3 top-3 bg-black/40 text-white hover:bg-black/60 hover:text-white"
              >
                {torchOn ? <FlashlightOff size={20} /> : <Flashlight size={20} />}
              </IconButton>
            )}
          </>
        )}

        {!live && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-2 p-6 text-center">
            <CameraOff size={32} aria-hidden className="text-ink-3" />
            <p className="max-w-xs text-[15px] text-ink-2" role="status">
              {state === "denied"
                ? "Camera access is blocked. Allow the camera for this site in your browser settings, or type the barcode number below."
                : state === "unavailable"
                  ? "No camera found on this device. Type the barcode number below instead."
                  : state === "stopped"
                    ? "Camera paused."
                    : "Couldn’t start the camera. Try again, or type the barcode number below."}
            </p>
            {state !== "unavailable" && (
              <Button variant="secondary" size="sm" onClick={() => void start()}>
                <Camera size={16} aria-hidden />
                {state === "stopped" ? "Resume camera" : "Try the camera again"}
              </Button>
            )}
          </div>
        )}
      </div>

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const code = manual.replace(/\D/g, "");
          if (code.length >= 6) {
            lastRef.current = null;
            emit(code);
            setManual("");
          }
        }}
      >
        <div className="flex flex-1 flex-col gap-1.5">
          <label htmlFor={manualId} className="text-sm font-medium text-ink-2">
            Or type the number under the barcode
          </label>
          <Input
            id={manualId}
            inputMode="numeric"
            autoComplete="off"
            pattern="[0-9 ]*"
            placeholder="9300633603294"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
        </div>
        <Button type="submit" variant="secondary" className="h-12" disabled={manual.replace(/\D/g, "").length < 6}>
          Look up
        </Button>
      </form>
    </div>
  );
}
