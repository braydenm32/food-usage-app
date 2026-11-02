"use client";

import { useMemo, useState } from "react";
import { ClipboardCheck, Snowflake } from "lucide-react";
import { useLarder, type ReconcileAnswer } from "@/lib/store";
import { isHighRiskFood, type ItemView } from "@/lib/selectors";
import { describeDaysLeft } from "@/lib/shelf-life/engine";
import { Button, Card, Chip, cx } from "@/components/ui";
import { toast } from "@/components/toast";
import { STATUS_META } from "@/components/freshness";
import { canFreeze, capitalise, freezeItem, freezeMany } from "@/components/pantry/actions";

const DAY = 86_400_000;

/* Per-device conveniences: a snoozed card or a dismissed prompt. Never needed for correctness. */
function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode: it lasts for this visit */
  }
}

/* ---------- Fridge check ---------- */

/** Items the weekly check asks about: past their date or due in the next 3 days, outside the freezer. */
export function fridgeCheckItems(views: ItemView[]): ItemView[] {
  return views.filter((v) => v.location?.kind !== "freezer" && v.expiry.daysLeft <= 3);
}

/**
 * Whether the weekly check is due: about a week since the last one (or, for a new household,
 * once the oldest food has been in for a few days), with something to ask about.
 */
export function fridgeCheckDue(views: ItemView[], lastAt: string | undefined, now: number): boolean {
  if (fridgeCheckItems(views).length === 0) return false;
  if (lastAt) return now - new Date(lastAt).getTime() >= 6 * DAY;
  const oldest = Math.min(...views.map((v) => new Date(v.item.addedAt).getTime()));
  return now - oldest >= 4 * DAY;
}

const SNOOZE_KEY = "larder-fridge-check-snoozed";

const ANSWERS: { value: ReconcileAnswer; label: string }[] = [
  { value: "used", label: "Ate it" },
  { value: "binned", label: "Binned" },
  { value: "keep", label: "Still have it" },
  { value: "half", label: "About half" },
];

/**
 * The weekly "Fridge check" on Today: everything past or near its date, each with
 * Ate it / Binned / Still have it / About half, and one Done that applies them as one Undo.
 */
export function FridgeCheck({ views, now }: { views: ItemView[]; now: number }) {
  const lastAt = useLarder((s) => s.settings.fridgeCheckAt);
  const setSettings = useLarder((s) => s.setSettings);
  const reconcile = useLarder((s) => s.reconcileItems);
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, ReconcileAnswer>>({});
  const [snoozed, setSnoozed] = useState(() => {
    const at = readLocal(SNOOZE_KEY);
    return !!at && now - Number(at) < DAY;
  });
  const items = useMemo(() => fridgeCheckItems(views), [views]);

  if ((!open && (snoozed || !fridgeCheckDue(views, lastAt, now))) || items.length === 0) return null;

  const done = () => {
    const r = reconcile(items.map((v) => ({ id: v.item.id, answer: answers[v.item.id] ?? "keep" })));
    setSettings({ fridgeCheckAt: new Date().toISOString() });
    setOpen(false);
    setAnswers({});
    const parts = [r.used && `${r.used} eaten`, r.half && `${r.half} half used`, r.binned && `${r.binned} binned`].filter(Boolean);
    toast(parts.length ? `Fridge check done: ${parts.join(", ")}` : "Fridge check done. Everything's still there.", { undoable: parts.length > 0 });
  };

  return (
    <section aria-labelledby="fridge-check">
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <ClipboardCheck size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="fridge-check" className="font-display text-xl text-ink">
              Fridge check
            </h2>
            <p className="mt-0.5 text-sm text-ink-2">
              {items.length === 1 ? "1 thing is" : `${items.length} things are`} due around now. A quick check keeps your dates right.
            </p>
          </div>
        </div>
        {!open ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" className="h-11" onClick={() => setOpen(true)}>
              Start the check
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-11"
              onClick={() => {
                writeLocal(SNOOZE_KEY, String(Date.now()));
                setSnoozed(true);
              }}
            >
              Not now
            </Button>
          </div>
        ) : (
          <>
            <ul className="mt-3 divide-y divide-line">
              {items.map((v) => {
                const meta = STATUS_META[v.expiry.status];
                const chosen = answers[v.item.id];
                return (
                  <li key={v.item.id} className="py-3">
                    <p className="flex items-baseline justify-between gap-3">
                      <span className="truncate font-semibold text-ink">
                        <span aria-hidden>{v.item.emoji} </span>
                        {v.item.name}
                      </span>
                      <span className={cx("shrink-0 text-sm", meta.text)}>{capitalise(describeDaysLeft(v.expiry, v.item.dateKind))}</span>
                    </p>
                    <div role="radiogroup" aria-label={`What happened to ${v.item.name}?`} className="mt-2 flex flex-wrap gap-2">
                      {ANSWERS.map((a) => (
                        <Chip
                          key={a.value}
                          role="radio"
                          aria-pressed={undefined}
                          aria-checked={(chosen ?? "keep") === a.value}
                          selected={(chosen ?? "keep") === a.value}
                          onClick={() => setAnswers((s) => ({ ...s, [v.item.id]: a.value }))}
                        >
                          {a.label}
                        </Chip>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button className="h-11" onClick={done}>
                Done
              </Button>
              <Button variant="ghost" className="h-11" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <p className="basis-full text-xs text-ink-3">Anything left on “Still have it” stays as it is.</p>
            </div>
          </>
        )}
      </Card>
    </section>
  );
}

/* ---------- Freeze prompt after a shop ---------- */

const FREEZE_KEY = "larder-freeze-prompt-seen";

/** Freezable raw meat, fish and leftovers added in the last day and a half, still in the fridge or pantry. */
export function freezeCandidates(views: ItemView[], now: number, since = 0): ItemView[] {
  const from = Math.max(since, now - 1.5 * DAY);
  return views.filter(
    (v) => new Date(v.item.addedAt).getTime() > from && isHighRiskFood(v.item, v.food) && canFreeze(v),
  );
}

/** "Freeze anything you won't cook by Thursday?" with one-tap chips, after an add with proteins in it. */
export function FreezePrompt({ views, now }: { views: ItemView[]; now: number }) {
  const [seenAt, setSeenAt] = useState(() => Number(readLocal(FREEZE_KEY) ?? 0));
  const items = useMemo(() => freezeCandidates(views, now, seenAt), [views, now, seenAt]);
  if (items.length === 0) return null;

  const first = items.reduce((a, b) => (b.expiry.expiresOn < a.expiry.expiresOn ? b : a));
  const days = first.expiry.daysLeft;
  const by =
    days <= 0 ? "tonight" : days === 1 ? "tomorrow" : `${first.expiry.expiresOn.toLocaleDateString("en-AU", { weekday: "long" })}`;
  const dismiss = () => {
    const t = Date.now();
    writeLocal(FREEZE_KEY, String(t));
    setSeenAt(t);
  };

  return (
    <section aria-labelledby="freeze-prompt">
      <Card className="border-primary/40 p-4">
        <div className="flex items-start gap-3">
          <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <Snowflake size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="freeze-prompt" className="font-display text-xl text-ink">
              Freeze anything you won&apos;t cook by {by}?
            </h2>
            <p className="mt-0.5 text-sm text-ink-2">Raw meat and fish only keep a couple of days in the fridge. Frozen, they keep for months.</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {items.map((v) => (
            <Chip key={v.item.id} onClick={() => freezeItem(v.item.id)}>
              <Snowflake size={14} aria-hidden />
              Freeze {v.item.name}
            </Chip>
          ))}
          {items.length > 1 && (
            <Chip onClick={() => freezeMany(items.map((v) => v.item.id))}>Freeze all {items.length}</Chip>
          )}
          <Button size="sm" variant="ghost" onClick={dismiss}>
            I&apos;ll cook them
          </Button>
        </div>
      </Card>
    </section>
  );
}
