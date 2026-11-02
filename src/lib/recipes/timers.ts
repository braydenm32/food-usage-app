// Find cooking times in recipe steps so cook mode can offer one-tap timers.

export interface StepTimer {
  /** The words matched, e.g. "25–30 minutes". */
  label: string;
  /** Timer length in seconds; for a range, the shorter end. */
  seconds: number;
}

const UNIT_SECONDS: Record<string, number> = {
  s: 1, sec: 1, secs: 1, second: 1, seconds: 1,
  m: 60, min: 60, mins: 60, minute: 60, minutes: 60,
  h: 3600, hr: 3600, hrs: 3600, hour: 3600, hours: 3600,
};

const NUM = String.raw`\d+\s+\d+\/\d+|\d+\s*[½¼¾]|\d+\/\d+|[½¼¾]|\d+(?:\.\d+)?`;
const RE = new RegExp(
  String.raw`(?<![\d/.])(${NUM}|\ban?\b|\bone\b|\bhalf an?\b)(?:\s*(?:-|–|—|to)\s*(${NUM}))?\s*(?:more\s+)?(seconds?|secs?|minutes?|mins?|hours?|hrs?|h|m)(?![a-z])(?:\s*(?:and|&)?\s*(\d+)\s*(minutes?|mins?|m)\b)?`,
  "gi",
);
const FRACTIONS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75 };

function lead(v: string): number {
  const t = v.toLowerCase().trim();
  if (t.startsWith("half")) return 0.5;
  if (t === "a" || t === "an" || t === "one") return 1;
  const m = t.match(/^(\d+)?\s*(?:(\d+)\/(\d+)|([½¼¾]))?$/);
  if (m && (m[2] || m[4])) {
    const whole = Number(m[1] ?? 0);
    return whole + (m[4] ? FRACTIONS[m[4]] : Number(m[2]) / Number(m[3]));
  }
  if (/^\d+\/\d+$/.test(t)) {
    const [a, b] = t.split("/").map(Number);
    return a / b;
  }
  return Number(t);
}

/** All distinct timers mentioned in a step, in order. Ignores anything under 10 seconds or over 12 hours. */
export function findTimers(step: string): StepTimer[] {
  const out: StepTimer[] = [];
  for (const m of step.matchAll(RE)) {
    const unit = UNIT_SECONDS[m[3].toLowerCase()];
    if (!unit) continue;
    // "h" and "m" alone only count straight after a number ("1h", "20m").
    if (/^[hm]$/i.test(m[3]) && !/\d[hm]/i.test(m[0])) continue;
    let seconds = lead(m[1]) * unit;
    if (m[4] && m[5]) seconds += Number(m[4]) * 60;
    if (!Number.isFinite(seconds) || seconds < 10 || seconds > 12 * 3600) continue;
    const label = m[0].trim();
    if (!out.some((t) => t.seconds === Math.round(seconds))) out.push({ label, seconds: Math.round(seconds) });
  }
  return out;
}

/** "1:05:00" or "4:30". */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
