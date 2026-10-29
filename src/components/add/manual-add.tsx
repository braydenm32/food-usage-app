"use client";

import { useId, useMemo, useState } from "react";
import { Plus, Search, Type } from "lucide-react";
import { Input, cx } from "@/components/ui";
import { useLarder } from "@/lib/store";
import { FOOD_TYPES, getFoodType, searchFoodTypes } from "@/lib/shelf-life/foods";
import { foodToDraft, freeTextDraft, withLastAdded, type ReviewDraft } from "@/lib/drafts";
import type { FoodType } from "@/lib/types";

interface Quick {
  key: string;
  label: string;
  emoji: string;
  food?: FoodType;
}

/** Search box with autocomplete, recent items and free text. Each pick adds a line to the list below. */
export function ManualAdd({ onAdd }: { onAdd: (d: ReviewDraft) => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const listId = useId();
  const inputId = useId();
  const events = useLarder((s) => s.events);
  const locations = useLarder((s) => s.locations);

  const results = useMemo(() => searchFoodTypes(query, 8), [query]);
  const trimmed = query.trim();
  const showFree = trimmed.length > 0 && !results.some((f) => f.name.toLowerCase() === trimmed.toLowerCase());
  const options = results.length + (showFree ? 1 : 0);

  // Recently added foods, newest first; staples when there's no history yet.
  const quick = useMemo<Quick[]>(() => {
    const seen = new Set<string>();
    const out: Quick[] = [];
    for (let i = events.length - 1; i >= 0 && out.length < 12; i--) {
      const e = events[i];
      if (e.type !== "added") continue;
      const k = e.foodTypeId ?? e.itemName.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      const food = getFoodType(e.foodTypeId);
      out.push({ key: k, label: food?.name ?? e.itemName, emoji: food?.emoji ?? "🛒", food });
    }
    if (out.length >= 4) return out;
    for (const f of FOOD_TYPES) {
      if (out.length >= 12) break;
      if (!f.staple || seen.has(f.id)) continue;
      seen.add(f.id);
      out.push({ key: f.id, label: f.name, emoji: f.emoji, food: f });
    }
    return out;
  }, [events]);
  const hasHistory = events.some((e) => e.type === "added");

  function add(picked: ReviewDraft) {
    // Same spot and amount as last time this food was added.
    const d = withLastAdded(picked, events, locations.map((l) => l.id));
    onAdd(d);
    setLastAdded(d.name);
    setQuery("");
    setActive(0);
  }

  function choose(index: number) {
    if (index < results.length) add(foodToDraft(results[index]));
    else if (showFree) add(freeTextDraft(trimmed));
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="relative">
        <label htmlFor={inputId} className="sr-only">
          Search for a food
        </label>
        <Search size={18} aria-hidden className="pointer-events-none absolute left-4 top-6 -translate-y-1/2 text-ink-3" />
        <Input
          id={inputId}
          type="search"
          role="combobox"
          aria-expanded={options > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={options > 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          enterKeyHint="done"
          placeholder="Search or type a food, e.g. 500g mince"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(options - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (options > 0) choose(active);
            } else if (e.key === "Escape") {
              setQuery("");
            }
          }}
          className="pl-11 [&::-webkit-search-cancel-button]:appearance-none"
        />
        {options > 0 && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Foods"
            className="mt-2 overflow-hidden rounded-2xl border border-line bg-surface shadow-card"
          >
            {results.map((f, i) => (
              <li
                key={f.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
                onMouseEnter={() => setActive(i)}
                className={cx("flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2", i === active && "bg-surface-2")}
              >
                <span aria-hidden className="text-2xl">
                  {f.emoji}
                </span>
                <span className="flex-1 text-[15px] font-medium text-ink">{f.name}</span>
                <span className="text-xs capitalize text-ink-3">{f.defaultLocation}</span>
              </li>
            ))}
            {showFree && (
              <li
                id={`${listId}-${results.length}`}
                role="option"
                aria-selected={active === results.length}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(results.length)}
                onMouseEnter={() => setActive(results.length)}
                className={cx(
                  "flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2",
                  active === results.length && "bg-surface-2",
                )}
              >
                <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-ink-2">
                  <Type size={16} />
                </span>
                <span className="flex-1 text-[15px] text-ink">
                  Add “<span className="font-medium">{trimmed}</span>”
                </span>
              </li>
            )}
          </ul>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {lastAdded ? `Added ${lastAdded} to the list` : ""}
      </p>

      {!trimmed && quick.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-ink-2">{hasHistory ? "Add again" : "Common staples"}</h2>
          <div className="scrollbar-none -mx-5 flex gap-2 overflow-x-auto px-5 lg:mx-0 lg:flex-wrap lg:px-0">
            {quick.map((q) => (
              <button
                key={q.key}
                type="button"
                onClick={() => add(q.food ? foodToDraft(q.food) : freeTextDraft(q.label))}
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full border border-line bg-surface pl-3 pr-4 text-[15px] font-medium text-ink hover:border-primary"
              >
                <span aria-hidden className="text-lg">
                  {q.emoji}
                </span>
                {q.label}
                <Plus size={15} aria-hidden className="text-ink-3" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
