"use client";

import { useState } from "react";
import { Button, Field, Input, Segmented, Sheet, Stepper } from "@/components/ui";
import { toast } from "@/components/toast";
import { parseIngredientLine } from "@/lib/recipes/import";
import { formatAmount } from "@/lib/recipes/quantity";
import { useLarder } from "@/lib/store";
import type { Recipe, RecipeIngredient } from "@/lib/types";

/** One ingredient back to the line a person would type, so editing round-trips. */
export function ingredientLine(i: RecipeIngredient): string {
  const amount = formatAmount(i.quantity, i.unit, i.quantityMax);
  return [amount, i.name].filter(Boolean).join(" ") + (i.note ? `, ${i.note}` : "") + (i.optional ? " (optional)" : "");
}

const textareaClass =
  "block w-full rounded-2xl border border-line bg-surface px-4 py-3 text-[16px] leading-relaxed text-ink placeholder:text-ink-3 focus:border-primary focus:outline-none";

/** Edit a saved recipe: title, servings, time, tablespoon size, ingredients and method as plain lines. */
export function EditRecipeSheet({ recipe, open, onClose }: { recipe: Recipe; open: boolean; onClose: () => void }) {
  const update = useLarder((s) => s.updateSavedRecipe);
  const [title, setTitle] = useState(recipe.title);
  const [servings, setServings] = useState(recipe.servings);
  const [minutes, setMinutes] = useState(recipe.minutes ? String(recipe.minutes) : "");
  const [tbsp, setTbsp] = useState<"15" | "20">(String(recipe.tbspMl ?? 20) as "15" | "20");
  const [ingredients, setIngredients] = useState(() => recipe.ingredients.map(ingredientLine).join("\n"));
  const [steps, setSteps] = useState(() => recipe.steps.join("\n\n"));

  function save() {
    const prevByLine = new Map(recipe.ingredients.map((i) => [ingredientLine(i), i]));
    const parsed = ingredients
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      // Unchanged lines keep their original data (e.g. a hand-picked food match).
      .map((l) => prevByLine.get(l) ?? parseIngredientLine(l));
    const method = steps
      .split(/\n\s*\n|\n(?=\d+[.)]\s)/)
      .map((s) => s.replace(/^\d+[.)]\s*/, "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (!title.trim() || parsed.length === 0) {
      toast("A recipe needs a title and at least one ingredient", { tone: "error" });
      return;
    }
    const mins = Number(minutes);
    update(recipe.id, {
      title: title.trim(),
      servings: Math.max(1, servings),
      minutes: Number.isFinite(mins) && mins > 0 ? Math.round(mins) : undefined,
      tbspMl: tbsp === "15" ? 15 : 20,
      ingredients: parsed,
      steps: method,
    });
    toast("Recipe updated");
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Edit recipe"
      wide
      footer={
        <Button block size="lg" onClick={save}>
          Save changes
        </Button>
      }
    >
      <div className="space-y-4 py-1">
        <Field label="Title">{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Serves</p>
            <Stepper label="servings" value={servings} min={1} onChange={(v) => setServings(Math.max(1, Math.round(v)))} />
          </div>
          <Field label="Total time (min)">
            {(id) => <Input id={id} inputMode="numeric" className="w-28" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ""))} />}
          </Field>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Tablespoon size</p>
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
        <Field label="Ingredients" hint="One per line, like “2 cups plain flour” or “1 onion, diced”.">
          {(id) => <textarea id={id} rows={Math.min(14, Math.max(5, recipe.ingredients.length + 1))} className={textareaClass} value={ingredients} onChange={(e) => setIngredients(e.target.value)} />}
        </Field>
        <Field label="Method" hint="Leave a blank line between steps.">
          {(id) => <textarea id={id} rows={10} className={textareaClass} value={steps} onChange={(e) => setSteps(e.target.value)} />}
        </Field>
      </div>
    </Sheet>
  );
}
