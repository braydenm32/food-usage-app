"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CalendarDays, ChartColumn, ChevronRight, Download, Plus, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { z } from "zod";
import { DEFAULT_LOCATIONS, normalisePersisted, useLarder } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";
import { getFoodType } from "@/lib/shelf-life/foods";
import { notificationSupport, type NotificationSupport } from "@/lib/reminders";
import type { Diet, Settings, StorageLocation } from "@/lib/types";
import { Button, Card, Chip, Field, IconButton, Input, PageHeader, Segmented, Stepper, Switch, cx } from "@/components/ui";
import { toast } from "@/components/toast";

const APP_VERSION = "0.1.0";

const DIETS: Array<{ value: Diet; label: string }> = [
  { value: "vegetarian", label: "Vegetarian" },
  { value: "vegan", label: "Vegan" },
  { value: "pescatarian", label: "Pescatarian" },
  { value: "gluten-free", label: "Gluten-free" },
  { value: "dairy-free", label: "Dairy-free" },
  { value: "low-carb", label: "Low-carb" },
  { value: "halal", label: "Halal" },
  { value: "kosher", label: "Kosher" },
];

const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: h,
  label: h === 0 ? "12 midnight" : h === 12 ? "12 noon" : h < 12 ? `${h} am` : `${h - 12} pm`,
}));

/* ---------- Layout bits ---------- */

/** A titled group of settings. Rows inside go in one or more `Group` cards. */
function Section({ id, title, intro, children }: { id: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="mt-10 first:mt-2">
      <h2 id={`${id}-heading`} className="font-display text-xl text-ink">
        {title}
      </h2>
      {intro && <p className="mt-1 text-sm text-ink-2">{intro}</p>}
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** A card of rows divided by hairlines. `title` adds a small heading when a section has several cards. */
function Group({ id, title, intro, children }: { id?: string; title?: string; intro?: string; children: React.ReactNode }) {
  const headingId = id && title ? `${id}-heading` : undefined;
  return (
    <div role={title ? "group" : undefined} aria-labelledby={headingId}>
      {title && (
        <h3 id={headingId} className="mb-1.5 px-1 text-sm font-semibold text-ink-2">
          {title}
        </h3>
      )}
      {intro && <p className="mb-2 px-1 text-sm text-ink-2">{intro}</p>}
      <Card className="divide-y divide-line px-4">{children}</Card>
    </div>
  );
}

function Row({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("py-4", className)}>{children}</div>;
}

/** A whole-row link, e.g. to Insights or the planner. */
function LinkRow({ href, label, description, Icon }: { href: string; label: string; description?: string; Icon: typeof Bell }) {
  return (
    <Link href={href} className="-mx-4 flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Icon size={18} aria-hidden />
      </span>
      <RowLabel label={label} description={description} />
      <ChevronRight size={18} aria-hidden className="ml-auto shrink-0 text-ink-3" />
    </Link>
  );
}

function RowLabel({ label, description }: { label: string; description?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[15px] font-medium text-ink">{label}</p>
      {description && <p className="text-sm text-ink-2">{description}</p>}
    </div>
  );
}

/* ---------- Tag input ---------- */

function TagInput({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim().replace(/,+$/, "");
    if (!v) return;
    if (!values.some((x) => x.toLowerCase() === v.toLowerCase())) onChange([...values, v]);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  };
  return (
    <Field label={label}>
      {(id) => (
        <div className="flex flex-col gap-2">
          {values.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label={`${label} added`}>
              {values.map((v) => (
                <li
                  key={v}
                  className="inline-flex h-8 items-center gap-1 rounded-full bg-surface-2 pl-3 pr-1 text-sm font-medium text-ink"
                >
                  {v}
                  <button
                    type="button"
                    aria-label={`Remove ${v}`}
                    onClick={() => onChange(values.filter((x) => x !== v))}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-ink-3 hover:bg-line hover:text-ink"
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <Input
              id={id}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              onBlur={add}
              placeholder={placeholder}
              className="h-11"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={add}
              aria-label={`Add to ${label.toLowerCase()}`}
              className={cx(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors",
                draft.trim() ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface text-ink-3",
              )}
            >
              <Plus size={18} aria-hidden />
            </button>
          </div>
        </div>
      )}
    </Field>
  );
}

/* ---------- Import validation ---------- */

/**
 * Shape check for a backup. Only `items` is required; everything else is optional and gets
 * defaults here, then `normalisePersisted` fills in profile arrays, settings and the built-in spots.
 */
const importSchema = z.object({
  items: z.array(z.object({ id: z.string(), name: z.string(), locationId: z.string(), quantity: z.number() }).loose()),
  events: z.array(z.object({ id: z.string(), type: z.string(), at: z.string() }).loose()).default([]),
  locations: z
    .array(z.object({ id: z.string(), name: z.string(), kind: z.enum(["pantry", "fridge", "freezer"]) }).loose())
    .default([]),
  overrides: z.record(z.string(), z.object({ foodTypeId: z.string() }).loose()).default({}),
  profile: z
    .object({
      householdName: z.string().optional(),
      people: z.number().optional(),
      diets: z.array(z.string()).default([]),
      allergies: z.array(z.string()).default([]),
      likes: z.array(z.string()).default([]),
      dislikes: z.array(z.string()).default([]),
    })
    .loose()
    .default({ diets: [], allergies: [], likes: [], dislikes: [] }),
  settings: z
    .object({
      theme: z.enum(["system", "light", "dark"]).optional(),
      digest: z.enum(["off", "daily", "weekly"]).optional(),
    })
    .loose()
    .default({}),
  savedRecipes: z.array(z.object({ id: z.string(), title: z.string(), ingredients: z.array(z.any()) }).loose()).default([]),
  shoppingList: z.array(z.object({ id: z.string(), name: z.string(), checked: z.boolean() }).loose()).default([]),
  mealPlan: z.array(z.object({ id: z.string(), date: z.string(), recipeId: z.string() }).loose()).default([]),
});

function exportSnapshot() {
  const s = useLarder.getState();
  return {
    app: "larder",
    version: 1,
    exportedAt: new Date().toISOString(),
    state: {
      items: s.items,
      events: s.events,
      locations: s.locations,
      overrides: s.overrides,
      profile: s.profile,
      settings: s.settings,
      savedRecipes: s.savedRecipes,
      shoppingList: s.shoppingList,
      mealPlan: s.mealPlan,
    },
  };
}

/* ---------- Page ---------- */

export default function SettingsPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const profile = useLarder((s) => s.profile);
  const settings = useLarder((s) => s.settings);
  const locations = useLarder((s) => s.locations);
  const overrides = useLarder((s) => s.overrides);
  const items = useLarder((s) => s.items);
  const setProfile = useLarder((s) => s.setProfile);
  const setSettings = useLarder((s) => s.setSettings);
  const addLocation = useLarder((s) => s.addLocation);
  const removeLocation = useLarder((s) => s.removeLocation);
  const removeOverride = useLarder((s) => s.removeOverride);
  const resetAll = useLarder((s) => s.resetAll);
  const loadDemoData = useLarder((s) => s.loadDemoData);

  const [newSpot, setNewSpot] = useState({ name: "", kind: "fridge" as StorageLocation["kind"], emoji: "" });
  const [support, setSupport] = useState<NotificationSupport>(() =>
    typeof window === "undefined" ? "default" : notificationSupport(),
  );
  const [pushNote, setPushNote] = useState<string | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const overrideRows = useMemo(
    () =>
      Object.values(overrides).map((o) => {
        const food = getFoodType(o.foodTypeId);
        const parts: string[] = [];
        if (o.pantryDays !== undefined) parts.push(`pantry ${o.pantryDays ?? "n/a"} days`);
        if (o.fridgeDays !== undefined) parts.push(`fridge ${o.fridgeDays ?? "n/a"} days`);
        if (o.freezerDays !== undefined) parts.push(`freezer ${o.freezerDays ?? "n/a"} days`);
        if (o.openedDays !== undefined) parts.push(`opened ${o.openedDays ?? "n/a"} days`);
        return { id: o.foodTypeId, name: food?.name ?? o.foodTypeId, emoji: food?.emoji, summary: parts.join(" · ") };
      }),
    [overrides],
  );

  const setPush = async (on: boolean) => {
    if (!on) {
      setSettings({ pushEnabled: false });
      setPushNote(null);
      return;
    }
    const sup = notificationSupport();
    setSupport(sup);
    if (sup === "unsupported") {
      setPushNote("This browser can't show notifications. Try Chrome, Edge, Firefox or Safari on a Mac.");
      return;
    }
    if (sup === "needs-install") {
      setPushNote(
        "On iPhone and iPad, notifications only work once Larder is on your Home Screen: tap Share, then “Add to Home Screen”, and open it from there.",
      );
      return;
    }
    if (sup === "denied") {
      setPushNote("Notifications are blocked for this site. Allow them in your browser's site settings, then try again.");
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setSupport(result);
      if (result === "granted") {
        setSettings({ pushEnabled: true });
        setPushNote(null);
        toast("Reminders turned on");
      } else if (result === "denied") {
        setPushNote("Notifications are blocked for this site. Allow them in your browser's site settings, then try again.");
      } else {
        setPushNote("No answer yet. Tap the switch again and choose Allow.");
      }
    } catch {
      setPushNote("Couldn't ask for permission. Try again from the browser's address bar.");
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(exportSnapshot(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `larder-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Saved a copy of your larder");
  };

  const importJson = async (file: File) => {
    try {
      const raw: unknown = JSON.parse(await file.text());
      // Accept our export, or a raw zustand persist blob.
      const candidate =
        raw && typeof raw === "object" && "state" in raw ? (raw as { state: unknown }).state : raw;
      const parsed = importSchema.safeParse(candidate);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        toast(`That file isn't a Larder backup (${first ? `${first.path.join(".") || "root"}: ${first.message}` : "unknown format"}).`, {
          tone: "error",
        });
        return;
      }
      const d = parsed.data;
      // normalisePersisted keeps the built-in spots, fills missing arrays (diets, allergies…) and
      // merges settings and profile over the defaults, the same as the store's own migrate.
      useLarder.setState({
        ...normalisePersisted({ ...d, settings: { ...settings, ...(d.settings as Partial<Settings>) } }),
        undo: null,
      });
      toast(`Restored ${d.items.length} item${d.items.length === 1 ? "" : "s"} and your settings`);
    } catch {
      toast("Couldn't read that file. It should be a .json export from Larder.", { tone: "error" });
    }
  };

  if (!hydrated) {
    return (
      <div>
        <PageHeader title="Settings" />
        <div className="space-y-3 px-5 lg:px-0" aria-busy>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-surface-2" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="lg:pb-8">
      <PageHeader title="Settings" subtitle="Everything stays on this device." />
      <div className="px-5 lg:px-0">
        {/* Household */}
        <Section id="household" title="Household">
          <Group>
            <Row>
              <Field label="Household name">
                {(id) => (
                  <Input
                    id={id}
                    value={profile.householdName}
                    onChange={(e) => setProfile({ householdName: e.target.value })}
                    placeholder="The Nguyens, Flat 3…"
                  />
                )}
              </Field>
            </Row>
            <Row className="flex items-center justify-between gap-4">
              <RowLabel label="People" description="Used to size recipes and portions." />
              <Stepper value={profile.people} onChange={(v) => setProfile({ people: v })} min={1} label="people" />
            </Row>
            <Row>
              <p className="mb-2 text-sm font-medium text-ink-2">Ways of eating</p>
              <div className="flex flex-wrap gap-2">
                {DIETS.map((d) => {
                  const on = profile.diets.includes(d.value);
                  return (
                    <Chip
                      key={d.value}
                      selected={on}
                      onClick={() =>
                        setProfile({ diets: on ? profile.diets.filter((x) => x !== d.value) : [...profile.diets, d.value] })
                      }
                    >
                      {d.label}
                    </Chip>
                  );
                })}
              </div>
            </Row>
            <Row className="flex flex-col gap-5">
              <TagInput
                label="Allergies"
                values={profile.allergies}
                onChange={(v) => setProfile({ allergies: v })}
                placeholder="Peanuts, shellfish…"
              />
              <TagInput label="Likes" values={profile.likes} onChange={(v) => setProfile({ likes: v })} placeholder="Spicy, noodles…" />
              <TagInput
                label="Dislikes"
                values={profile.dislikes}
                onChange={(v) => setProfile({ dislikes: v })}
                placeholder="Coriander, olives…"
              />
            </Row>
          </Group>
        </Section>

        {/* Your kitchen: spots, overrides, planner, insights */}
        <Section id="kitchen" title="Your kitchen">
          <Group id="spots" title="Storage spots" intro="Where food lives. Each spot uses the shelf life for its kind.">
            {locations.map((l) => {
              const custom = !DEFAULT_LOCATIONS.some((d) => d.id === l.id);
              const count = items.filter((i) => i.locationId === l.id).length;
              return (
                <Row key={l.id} className="flex items-center gap-3">
                  <span aria-hidden className="w-8 text-center text-2xl">
                    {l.emoji ?? (l.kind === "fridge" ? "🧊" : l.kind === "freezer" ? "❄️" : "🥫")}
                  </span>
                  <RowLabel
                    label={l.name}
                    description={`${l.kind.charAt(0).toUpperCase() + l.kind.slice(1)} shelf life · ${count} item${count === 1 ? "" : "s"}`}
                  />
                  {custom && (
                    <IconButton
                      label={`Remove ${l.name}`}
                      className="ml-auto"
                      onClick={() => {
                        removeLocation(l.id);
                        toast(`Removed ${l.name}. Its food moved to the ${l.kind}.`);
                      }}
                    >
                      <Trash2 size={18} />
                    </IconButton>
                  )}
                </Row>
              );
            })}
            <Row>
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = newSpot.name.trim();
                  if (!name) return;
                  addLocation(name, newSpot.kind, newSpot.emoji.trim() || undefined);
                  setNewSpot({ name: "", kind: "fridge", emoji: "" });
                  toast(`Added ${name}`);
                }}
              >
                <p className="text-sm font-medium text-ink-2">Add a spot</p>
                <div className="flex gap-2">
                  <div className="w-16 shrink-0">
                    <Input
                      aria-label="Emoji for the new spot"
                      value={newSpot.emoji}
                      onChange={(e) => setNewSpot({ ...newSpot, emoji: e.target.value.slice(0, 4) })}
                      placeholder="🧺"
                      className="px-0 text-center"
                      maxLength={4}
                    />
                  </div>
                  <Input
                    aria-label="Name of the new spot"
                    value={newSpot.name}
                    onChange={(e) => setNewSpot({ ...newSpot, name: e.target.value })}
                    placeholder="Garage fridge, chest freezer…"
                  />
                </div>
                <Segmented
                  label="Kind of spot"
                  value={newSpot.kind}
                  onChange={(kind) => setNewSpot({ ...newSpot, kind })}
                  options={[
                    { value: "fridge", label: "Fridge" },
                    { value: "freezer", label: "Freezer" },
                    { value: "pantry", label: "Pantry" },
                  ]}
                />
                <Button type="submit" variant="secondary" disabled={!newSpot.name.trim()}>
                  <Plus size={16} aria-hidden />
                  Add spot
                </Button>
              </form>
            </Row>
          </Group>

          <Group
            id="overrides"
            title="Shelf-life overrides"
            intro="When you correct a date, Larder remembers it for that food. Reset to go back to the standard estimate."
          >
            {overrideRows.length === 0 ? (
              <Row>
                <p className="text-sm text-ink-2">No overrides yet.</p>
              </Row>
            ) : (
              overrideRows.map((o) => (
                <Row key={o.id} className="flex items-center gap-3">
                  {o.emoji && (
                    <span aria-hidden className="w-8 text-center text-2xl">
                      {o.emoji}
                    </span>
                  )}
                  <RowLabel label={o.name} description={o.summary || "Custom estimate"} />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto shrink-0"
                    onClick={() => {
                      removeOverride(o.id);
                      toast(`Reset ${o.name} to the standard estimate`);
                    }}
                  >
                    <RotateCcw size={14} aria-hidden />
                    Reset
                  </Button>
                </Row>
              ))
            )}
          </Group>

          <Group id="planner" title="Planning and insights">
            <Row className="py-1">
              <Switch
                checked={settings.mealPlannerEnabled}
                onChange={(on) => {
                  setSettings({ mealPlannerEnabled: on });
                  if (on) {
                    toast("Meal planner turned on", { action: { label: "Open planner", onClick: () => router.push("/plan") } });
                  } else {
                    toast("Meal planner turned off. Your plan is kept in case you turn it back on.");
                  }
                }}
                label="Plan the week's meals"
                description="Adds a Plan page to put saved recipes on days and shop for what's missing."
              />
            </Row>
            {settings.mealPlannerEnabled && (
              <LinkRow href="/plan" label="Open the meal plan" description="This week's dinners." Icon={CalendarDays} />
            )}
            <LinkRow href="/insights" label="Insights" description="What gets used, what gets binned, and what it costs." Icon={ChartColumn} />
          </Group>
        </Section>

        {/* Reminders */}
        <Section
          id="reminders"
          title="Reminders"
          intro="A short digest of what to use. Reminders arrive when Larder is open or in the background on most phones; always-on reminders need an account, which is coming later."
        >
          <Group>
            <Row>
              <p className="mb-2 text-sm font-medium text-ink-2">Digest</p>
              <Segmented
                label="How often to send a digest"
                value={settings.digest}
                onChange={(digest) => setSettings({ digest })}
                options={[
                  { value: "off", label: "Off" },
                  { value: "daily", label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                ]}
              />
              {settings.digest === "weekly" && <p className="mt-2 text-xs text-ink-3">Weekly digests go out on Sunday.</p>}
            </Row>
            <Row className="flex items-center justify-between gap-4">
              <RowLabel label="Time of day" description="Local time, when you're likely planning dinner." />
              <select
                aria-label="Time of day for the digest"
                value={settings.digestHour}
                onChange={(e) => setSettings({ digestHour: Number(e.target.value) })}
                className="h-11 shrink-0 rounded-full border border-line bg-surface px-3 text-sm font-medium text-ink"
              >
                {HOURS.map((h) => (
                  <option key={h.value} value={h.value}>
                    {h.label}
                  </option>
                ))}
              </select>
            </Row>
            <Row className="flex items-center justify-between gap-4">
              <RowLabel label="“Use soon” from" description="How many days before the date food is flagged." />
              <Stepper
                value={settings.useSoonDays}
                onChange={(v) => setSettings({ useSoonDays: v })}
                min={1}
                label="use soon days"
                suffix={settings.useSoonDays === 1 ? "day" : "days"}
              />
            </Row>
            <Row className="py-1">
              <Switch
                checked={settings.pushEnabled}
                onChange={setPush}
                label="Push notifications"
                description={
                  settings.pushEnabled
                    ? "On. Larder will show a digest when it's due."
                    : "Needs your permission the first time."
                }
              />
              {pushNote && (
                <p role="status" className="mb-3 flex gap-2 rounded-xl bg-soon-soft px-3 py-2 text-sm text-ink">
                  <Bell size={16} aria-hidden className="mt-0.5 shrink-0 text-soon" />
                  {pushNote}
                </p>
              )}
              {!pushNote && support === "needs-install" && (
                <p className="mb-3 text-xs text-ink-3">On iPhone, add Larder to your Home Screen first to get notifications.</p>
              )}
            </Row>
          </Group>
        </Section>

        {/* Appearance */}
        <Section id="appearance" title="Appearance">
          <Group>
            <Row>
              <Segmented
                label="Theme"
                value={settings.theme}
                onChange={(theme) => setSettings({ theme })}
                options={[
                  { value: "system", label: "System" },
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
              />
            </Row>
          </Group>
        </Section>

        {/* Data */}
        <Section id="data" title="Your data" intro="Larder keeps everything in this browser. Export a copy to move it or keep it safe.">
          <Group>
            <Row className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={exportJson}>
                <Download size={16} aria-hidden />
                Export a copy
              </Button>
              <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                <Upload size={16} aria-hidden />
                Import from a file
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                aria-label="Choose a Larder backup file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) importJson(f);
                  e.target.value = "";
                }}
              />
            </Row>
            <Row className="flex items-center justify-between gap-4">
              <RowLabel label="Sample food" description="Adds a week-old shop so you can see how things look." />
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  loadDemoData();
                  toast("Added sample food to the larder");
                }}
              >
                Load sample food
              </Button>
            </Row>
            <Row>
              {!confirmErase ? (
                <div className="flex items-center justify-between gap-4">
                  <RowLabel label="Erase everything" description="Food, history, list, recipes and settings. Can't be undone." />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0 border-spoiled text-spoiled hover:bg-spoiled-soft"
                    onClick={() => setConfirmErase(true)}
                  >
                    <Trash2 size={14} aria-hidden />
                    Erase…
                  </Button>
                </div>
              ) : (
                <div className="rounded-xl bg-spoiled-soft p-3" role="alertdialog" aria-labelledby="erase-heading" aria-describedby="erase-body">
                  <p id="erase-heading" className="text-sm font-medium text-ink">
                    Erase everything on this device?
                  </p>
                  <p id="erase-body" className="mt-1 text-sm text-ink-2">
                    This removes {items.length} item{items.length === 1 ? "" : "s"} and all history. Export a copy first if you might
                    want it back.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setConfirmErase(false)} autoFocus>
                      Keep my data
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        resetAll();
                        setConfirmErase(false);
                        toast("Everything's been erased");
                      }}
                    >
                      Yes, erase everything
                    </Button>
                  </div>
                </div>
              )}
            </Row>
          </Group>
        </Section>

        {/* About */}
        <Section id="about" title="About Larder">
          <Group>
            <Row>
              <p className="text-sm text-ink-2">
                Version {APP_VERSION}. Made for Australian kitchens.
              </p>
            </Row>
            <Row>
              <p className="text-[15px] font-medium text-ink">How dates are estimated</p>
              <p className="mt-1 text-sm text-ink-2">
                When there&apos;s no printed date, Larder estimates one from typical storage times in Australian food-safety
                guidance, adjusted for where it&apos;s kept and whether it&apos;s been opened, frozen or thawed. These are
                approximate: always trust a printed use-by date over an estimate, and trust your eyes and nose over both.
                Best-before dates are about quality, not safety; use-by dates are about safety.
              </p>
            </Row>
          </Group>
        </Section>
      </div>
    </div>
  );
}
