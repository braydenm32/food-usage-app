"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Link2, Loader2 } from "lucide-react";
import { Button, Field, Input, Segmented, Sheet } from "@/components/ui";
import { toast } from "@/components/toast";
import { formatAmount } from "@/lib/recipes/quantity";
import { useLarder } from "@/lib/store";
import type { Recipe } from "@/lib/types";

type Mode = "link" | "photo";
type State = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "done"; recipe: Recipe; method: string };

/** Save a recipe from a web link or a photo. Shows a preview first so nothing lands unseen. */
export function ImportSheet({ open, onClose, initialUrl }: { open: boolean; onClose: () => void; initialUrl?: string }) {
  const [mode, setMode] = useState<Mode>("link");
  const [url, setUrl] = useState(initialUrl ?? "");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [title, setTitle] = useState("");
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const saveRecipe = useLarder((s) => s.saveRecipe);
  const router = useRouter();

  useEffect(() => {
    if (!open || aiReady !== null) return;
    fetch("/api/recipes/import")
      .then((r) => r.json())
      .then((d: { ai?: boolean }) => setAiReady(!!d.ai))
      .catch(() => setAiReady(false));
  }, [open, aiReady]);

  const [prevInitial, setPrevInitial] = useState(initialUrl);
  if (prevInitial !== initialUrl) {
    setPrevInitial(initialUrl);
    if (initialUrl) setUrl(initialUrl);
  }

  function reset() {
    setState({ kind: "idle" });
    setTitle("");
  }

  async function run(request: Promise<Response>) {
    setState({ kind: "loading" });
    try {
      const res = await request;
      const d = (await res.json()) as { recipe?: Recipe; method?: string; message?: string };
      if (!res.ok || !d.recipe) throw new Error(d.message || "Couldn't import that recipe.");
      setTitle(d.recipe.title);
      setState({ kind: "done", recipe: d.recipe, method: d.method ?? "" });
    } catch (e) {
      setState({ kind: "error", message: navigator.onLine === false ? "You're offline. Connect and try again." : (e as Error).message });
    }
  }

  function importLink() {
    if (!url.trim()) return;
    void run(fetch("/api/recipes/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: url.trim() }) }));
  }

  function importPhoto(file: File | undefined) {
    if (!file) return;
    const form = new FormData();
    form.append("image", file);
    void run(fetch("/api/recipes/import", { method: "POST", body: form }));
  }

  function save() {
    if (state.kind !== "done") return;
    const recipe = { ...state.recipe, title: title.trim() || state.recipe.title };
    saveRecipe(recipe);
    toast("Saved to your recipes");
    close();
    router.push(`/recipes/${encodeURIComponent(recipe.id)}`);
  }

  function close() {
    reset();
    onClose();
  }

  const preview = state.kind === "done" ? state.recipe : null;

  return (
    <Sheet
      open={open}
      onClose={close}
      title={preview ? "Check and save" : "Import a recipe"}
      wide
      footer={
        preview ? (
          <div className="flex gap-2">
            <Button variant="secondary" size="lg" onClick={reset}>
              Back
            </Button>
            <Button size="lg" className="flex-1" onClick={save}>
              Save recipe
            </Button>
          </div>
        ) : mode === "link" ? (
          <Button block size="lg" onClick={importLink} disabled={!url.trim() || state.kind === "loading"}>
            {state.kind === "loading" ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <Link2 size={20} aria-hidden />}
            {state.kind === "loading" ? "Reading the page…" : "Import"}
          </Button>
        ) : (
          <Button block size="lg" onClick={() => fileRef.current?.click()} disabled={state.kind === "loading" || aiReady === false}>
            {state.kind === "loading" ? <Loader2 size={20} className="animate-spin" aria-hidden /> : <Camera size={20} aria-hidden />}
            {state.kind === "loading" ? "Reading the photo…" : "Take or choose a photo"}
          </Button>
        )
      }
    >
      {preview ? (
        <div className="space-y-4 py-1">
          <Field label="Title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
          <p className="text-sm text-ink-2">
            Serves {preview.servings}
            {preview.minutes ? ` · ${preview.minutes} min` : ""} · {preview.ingredients.length} ingredients · {preview.steps.length} steps
            {preview.tbspMl === 15 ? " · uses 15 ml tablespoons" : ""}
          </p>
          <div>
            <h3 className="mb-1.5 text-sm font-semibold text-ink">Ingredients</h3>
            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-2xl bg-surface-2 p-3 text-[15px]">
              {preview.ingredients.map((ing, i) => (
                <li key={i}>
                  <span className="text-ink-2">{formatAmount(ing.quantity, ing.unit, ing.quantityMax)}</span> {ing.name}
                  {ing.note && <span className="text-ink-3">, {ing.note}</span>}
                </li>
              ))}
            </ul>
          </div>
          {state.kind === "done" && state.method === "ai" && (
            <p className="text-sm text-ink-3">Read by the AI helper, so give the amounts a quick check. You can fix anything after saving.</p>
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
                : "Snap a cookbook page, a recipe card or a screenshot. We'll copy out the ingredients and method."}
            </p>
          )}
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => {
              importPhoto(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {state.kind === "error" && (
            <p role="alert" className="rounded-2xl bg-spoiled-soft p-3 text-sm text-ink">
              {state.message}
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}
