"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Camera, CircleAlert, Link2, Loader2, TriangleAlert, X } from "lucide-react";
import { Button, Field, Input, Segmented, Sheet } from "@/components/ui";
import { toast } from "@/components/toast";
import { downscaleImage } from "@/components/add/image";
import { formatAmount } from "@/lib/recipes/quantity";
import { useLarder } from "@/lib/store";
import type { Recipe } from "@/lib/types";

type Mode = "link" | "photo";
type State = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "done"; recipe: Recipe; method: string };

/** Lines we probably misread, so the preview can flag them before saving. */
const looksOff = (name: string) => /^(?:[(/]|[x×]\s|\d(?!0\b))/i.test(name.trim()) || /^\d+(?:[./]\d+)?$/.test(name.trim()) || name.trim().length < 2;

/**
 * Save a recipe from a web link or a photo. Shows a preview first so nothing lands unseen.
 * `onClose(saved)` tells the page whether a recipe was saved (and navigated to).
 */
export function ImportSheet({ open, onClose, initialUrl }: { open: boolean; onClose: (saved: boolean) => void; initialUrl?: string }) {
  const [mode, setMode] = useState<Mode>("link");
  const [url, setUrl] = useState(initialUrl ?? "");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [title, setTitle] = useState("");
  const [tbsp, setTbsp] = useState<"20" | "15">("20");
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const saveRecipe = useLarder((s) => s.saveRecipe);
  const saved = useLarder((s) => s.savedRecipes);
  const router = useRouter();

  useEffect(() => {
    if (!open || aiReady !== null) return;
    fetch("/api/recipes/import")
      .then((r) => r.json())
      .then((d: { ai?: boolean }) => setAiReady(!!d.ai))
      .catch(() => setAiReady(false));
  }, [open, aiReady]);

  async function run(make: (signal: AbortSignal) => Promise<Response>) {
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setState({ kind: "loading" });
    try {
      const res = await make(ctl.signal);
      const d = (await res.json()) as { recipe?: Recipe; method?: string; message?: string };
      if (ctl.signal.aborted) return;
      if (!res.ok || !d.recipe) throw new Error(d.message || "Couldn't import that recipe.");
      setTitle(d.recipe.title);
      setTbsp(d.recipe.tbspMl === 15 ? "15" : "20");
      setState({ kind: "done", recipe: d.recipe, method: d.method ?? "" });
    } catch (e) {
      if (ctl.signal.aborted) return;
      setState({ kind: "error", message: navigator.onLine === false ? "You're offline. Connect and try again." : (e as Error).message });
    }
  }

  function importLink(link = url) {
    const u = link.trim();
    if (!u) return;
    void run((signal) => fetch("/api/recipes/import", { method: "POST", signal, headers: { "content-type": "application/json" }, body: JSON.stringify({ url: u }) }));
  }

  // A link shared to Larder from another app: switch to Link and start straight away.
  const [prevInitial, setPrevInitial] = useState<string | undefined>(undefined);
  if (open && initialUrl && prevInitial !== initialUrl) {
    setPrevInitial(initialUrl);
    setMode("link");
    setUrl(initialUrl);
  }
  const startedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!open || !initialUrl || startedFor.current === initialUrl) return;
    startedFor.current = initialUrl;
    // Deferred so the state change happens in a callback, not during the effect body.
    const id = setTimeout(() => importLink(initialUrl), 0);
    return () => clearTimeout(id);
    // Only when a new shared link arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialUrl]);

  async function importPhoto(file: File | undefined) {
    if (!file) return;
    let blob: Blob = file;
    try {
      blob = await downscaleImage(file);
    } catch {
      // Couldn't shrink it here (unusual format): send the original and let the server check it.
    }
    const form = new FormData();
    form.append("image", blob, "recipe.jpg");
    void run((signal) => fetch("/api/recipes/import", { method: "POST", signal, body: form }));
  }

  function reset() {
    abortRef.current?.abort();
    setState({ kind: "idle" });
    setTitle("");
  }

  function close(savedIt = false) {
    reset();
    onClose(savedIt);
  }

  const preview = state.kind === "done" ? state.recipe : null;
  const duplicate = preview?.sourceUrl ? saved.find((r) => r.sourceUrl === preview.sourceUrl) : undefined;
  const flagged = preview ? preview.ingredients.filter((i) => looksOff(i.name)).length : 0;

  function removeIngredient(index: number) {
    if (state.kind !== "done") return;
    setState({ ...state, recipe: { ...state.recipe, ingredients: state.recipe.ingredients.filter((_, i) => i !== index) } });
  }

  function save() {
    if (!preview) return;
    const recipe: Recipe = { ...preview, title: title.trim() || preview.title, tbspMl: tbsp === "15" ? 15 : 20 };
    saveRecipe(recipe);
    toast("Saved to your recipes");
    close(true);
    router.replace(`/recipes/${encodeURIComponent(recipe.id)}`);
  }

  return (
    <Sheet
      open={open}
      onClose={() => close()}
      title={preview ? "Check and save" : "Import a recipe"}
      wide
      footer={
        preview ? (
          <div className="flex gap-2">
            <Button variant="secondary" size="lg" onClick={reset}>
              Back
            </Button>
            <Button size="lg" className="flex-1" onClick={save}>
              {duplicate ? "Save another copy" : "Save recipe"}
            </Button>
          </div>
        ) : state.kind === "loading" ? (
          <div className="flex gap-2">
            <Button variant="secondary" size="lg" onClick={reset}>
              Cancel
            </Button>
            <Button size="lg" className="flex-1" disabled>
              <Loader2 size={20} className="animate-spin" aria-hidden /> {mode === "link" ? "Reading the page…" : "Reading the photo…"}
            </Button>
          </div>
        ) : mode === "link" ? (
          <Button block size="lg" onClick={() => importLink()} disabled={!url.trim()}>
            <Link2 size={20} aria-hidden /> Import
          </Button>
        ) : (
          aiReady === false ? (
            <Button block size="lg" variant="secondary" onClick={() => setMode("link")}>
              <Link2 size={20} aria-hidden /> Use a link instead
            </Button>
          ) : (
            <Button block size="lg" onClick={() => fileRef.current?.click()}>
              <Camera size={20} aria-hidden /> Take or choose a photo
            </Button>
          )
        )
      }
    >
      {preview ? (
        <div className="space-y-4 py-1">
          {duplicate && (
            <p className="flex flex-wrap items-center gap-x-2 rounded-2xl bg-soon-soft p-3 text-sm text-ink">
              You already saved this recipe.
              <Link href={`/recipes/${encodeURIComponent(duplicate.id)}`} onClick={() => close(true)} className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">
                Open it
              </Link>
            </p>
          )}
          <div className="flex gap-3">
            {preview.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.image} alt="" className="h-20 w-20 shrink-0 rounded-2xl bg-surface-2 object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <Field label="Title">
                {(id) => (
                  <textarea
                    id={id}
                    value={title}
                    rows={2}
                    onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
                    className="w-full resize-none rounded-2xl border border-line bg-surface px-4 py-2.5 text-base text-ink outline-none focus:border-primary focus:outline-none"
                  />
                )}
              </Field>
            </div>
          </div>
          <p className="text-sm text-ink-2">
            Serves {preview.servings}
            {preview.minutes ? ` · ${preview.minutes} min` : ""} · {preview.ingredients.length} ingredients · {preview.steps.length} steps
          </p>
          <p className="text-sm text-ink-3">Saved for your household&apos;s own cooking, with a link back to the author.</p>
          {preview.ingredients.some((i) => i.unit === "tbsp") && (
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink">Which tablespoon does it use?</p>
              <Segmented
                label="Tablespoon size"
                value={tbsp}
                onChange={setTbsp}
                options={[
                  { value: "20", label: "Australian 20 ml" },
                  { value: "15", label: "US/UK 15 ml" },
                ]}
              />
            </div>
          )}
          <div>
            <h3 className="mb-1.5 text-sm font-semibold text-ink">Ingredients</h3>
            <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-2xl bg-surface-2 px-3 text-[15px]">
              {preview.ingredients.map((ing, i) => {
                const off = looksOff(ing.name);
                return (
                  <li key={i} className="flex items-center gap-2 py-1">
                    <span className="min-w-0 flex-1">
                      {off && (
                        <span className="mr-1.5 inline-flex items-center gap-1 rounded-full bg-soon-soft px-2 py-0.5 align-middle text-xs font-semibold text-ink">
                          <TriangleAlert size={12} aria-hidden /> Check
                        </span>
                      )}
                      <span className="text-ink-2">{formatAmount(ing.quantity, ing.unit, ing.quantityMax)}</span> <span className="text-ink">{ing.name}</span>
                      {ing.note && <span className="text-ink-3">, {ing.note}</span>}
                      {ing.optional && <span className="text-ink-3"> (optional)</span>}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeIngredient(i)}
                      aria-label={`Remove ${ing.name}`}
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-surface hover:text-ink"
                    >
                      <X size={18} aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          {preview.steps.length > 0 && (
            <details className="rounded-2xl bg-surface-2 p-3 text-[15px]">
              <summary className="min-h-11 cursor-pointer content-center font-semibold text-ink">Method ({preview.steps.length} steps)</summary>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-ink-2">
                {preview.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </details>
          )}
          {(flagged > 0 || (state.kind === "done" && state.method === "ai")) && (
            <p className="flex items-start gap-2 text-sm text-ink-2">
              <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
              {flagged > 0
                ? `${flagged} ${flagged === 1 ? "line may be" : "lines may be"} misread. Remove ${flagged === 1 ? "it" : "them"} here, or save and tap Edit on the recipe to fix the wording.`
                : "Read by the AI helper, so check the amounts. You can tap Edit on the recipe after saving."}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-4 py-1">
          <Segmented
            label="Import from"
            value={mode}
            onChange={(m) => {
              setMode(m);
              reset();
            }}
            options={[
              { value: "link", label: "Link" },
              { value: "photo", label: "Photo" },
            ]}
          />
          {mode === "link" ? (
            <Field label="Recipe link" hint="Works with most recipe websites. For Instagram or TikTok, screenshot the recipe and use Photo.">
              {(id) => (
                <Input
                  id={id}
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  placeholder="https://www.taste.com.au/recipes/…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && importLink()}
                />
              )}
            </Field>
          ) : (
            <p className="text-[15px] text-ink-2">
              {aiReady === false
                ? "Reading photos needs the AI helper, which isn't set up yet. Paste a link instead."
                : "Snap a cookbook page or recipe card, or pick a screenshot. We'll copy out the ingredients and method."}
            </p>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void importPhoto(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {state.kind === "error" && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-x-3 rounded-2xl bg-spoiled-soft p-3 text-sm text-ink">
              <span>{state.message}</span>
              {mode === "link" && url.trim() && (
                <button type="button" onClick={() => importLink()} className="inline-flex min-h-11 items-center font-semibold text-primary hover:underline">
                  Try again
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
