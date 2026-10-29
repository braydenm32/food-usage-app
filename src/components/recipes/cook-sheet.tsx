"use client";

import { useMemo, useState } from "react";
import { Button, Sheet, Stepper, cx } from "@/components/ui";
import { StatusPill } from "@/components/freshness";
import { toast } from "@/components/toast";
import { useLarder } from "@/lib/store";
import { defaultDeduction, formatAmount, stepFor } from "@/lib/recipes/quantity";
import type { RecipeUse } from "@/lib/recipes/suggest";
import type { PantryItem, Recipe } from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  recipe: Recipe;
  uses: RecipeUse[];
  /** servings scale factor applied on the detail page */
  factor: number;
}

export function CookSheet(props: Props) {
  // Re-mount on open/close so amounts re-prefill from the latest larder.
  return <CookSheetInner key={String(props.open)} {...props} />;
}

const QUICK: Array<{ label: string; fraction: number }> = [
  { label: "None", fraction: 0 },
  { label: "¼", fraction: 0.25 },
  { label: "½", fraction: 0.5 },
  { label: "All", fraction: 1 },
];

function CookSheetInner({ open, onClose, recipe, uses, factor }: Props) {
  const items = useLarder((s) => s.items);
  const cookRecipe = useLarder((s) => s.cookRecipe);

  const rows = useMemo(
    () =>
      uses
        .map((u) => {
          const item = items.find((i) => i.id === u.itemId);
          const ing = recipe.ingredients.find((i) => i.name === u.ingredient);
          return item && ing ? { use: u, item, ing } : null;
        })
        .filter((r): r is { use: RecipeUse; item: PantryItem; ing: Recipe["ingredients"][number] } => r !== null),
    [uses, items, recipe],
  );

  const [amounts, setAmounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(rows.map((r) => [r.item.id, defaultDeduction(r.ing, r.item, factor)])),
  );

  const changed = rows.filter((r) => (amounts[r.item.id] ?? 0) > 0);

  function confirm() {
    if (changed.length > 0) {
      cookRecipe(
        recipe,
        changed.map((r) => ({ itemId: r.item.id, quantity: amounts[r.item.id] })),
      );
      toast(`Nice one. Updated ${changed.length} ${changed.length === 1 ? "item" : "items"} in your larder`, { undoable: true });
    } else {
      toast("Enjoy! Nothing in your larder changed.");
    }
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="What did you use?"
      footer={
        <Button block size="lg" onClick={confirm}>
          {changed.length > 0 ? `Update ${changed.length} ${changed.length === 1 ? "item" : "items"}` : "Done, change nothing"}
        </Button>
      }
    >
      {rows.length === 0 ? (
        <p className="py-6 text-[15px] text-ink-2">
          Nothing in your larder matches this recipe, so there is nothing to take off. Enjoy your meal.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-2">
            We have guessed amounts from the recipe. Adjust anything that is off and we will update your larder.
          </p>
          <ul className="divide-y divide-line">
            {rows.map(({ use, item }) => {
              const value = amounts[item.id] ?? 0;
              const set = (v: number) => setAmounts((a) => ({ ...a, [item.id]: Math.min(item.quantity, Math.max(0, v)) }));
              return (
                <li key={item.id} className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">
                        <span aria-hidden>{item.emoji}</span> {item.name}
                      </p>
                      <p className="text-sm text-ink-2">
                        {formatAmount(item.quantity, item.unit)} {item.quantity === 1 && item.unit === "item" ? "" : "in your larder"}
                      </p>
                    </div>
                    <StatusPill status={use.status} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <div role="group" aria-label={`How much ${item.name}`} className="flex gap-1.5">
                      {QUICK.map((q) => {
                        const target = Math.round(item.quantity * q.fraction * 100) / 100;
                        const selected = Math.abs(value - target) < 0.005;
                        return (
                          <button
                            key={q.label}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => set(target)}
                            className={cx(
                              "h-11 min-w-12 rounded-full border px-3 text-sm font-semibold transition-colors",
                              selected ? "border-primary bg-primary text-primary-ink" : "border-line bg-surface text-ink-2 hover:text-ink",
                            )}
                          >
                            {q.label}
                          </button>
                        );
                      })}
                    </div>
                    <Stepper
                      label={`${item.name} used`}
                      value={Math.round(value * 100) / 100}
                      step={stepFor(item.unit)}
                      onChange={set}
                      suffix={item.unit === "item" ? undefined : item.unit}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Sheet>
  );
}
