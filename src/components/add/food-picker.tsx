"use client";

import { useId, useMemo, useState } from "react";
import { Search, Type } from "lucide-react";
import { Input, Sheet } from "@/components/ui";
import { searchFoodTypes } from "@/lib/shelf-life/foods";
import type { FoodType } from "@/lib/types";

/** Bottom sheet to change which food a draft line is, or keep it as typed. */
export function FoodPicker({
  open,
  initialQuery,
  rawText,
  onClose,
  onPick,
  onKeepText,
}: {
  open: boolean;
  initialQuery: string;
  rawText?: string;
  onClose: () => void;
  onPick: (food: FoodType) => void;
  onKeepText: (text: string) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Which food is this?">
      {open && (
        <PickerBody initialQuery={initialQuery} rawText={rawText} onPick={onPick} onKeepText={onKeepText} />
      )}
    </Sheet>
  );
}

function PickerBody({
  initialQuery,
  rawText,
  onPick,
  onKeepText,
}: {
  initialQuery: string;
  rawText?: string;
  onPick: (food: FoodType) => void;
  onKeepText: (text: string) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const results = useMemo(() => searchFoodTypes(query, 12), [query]);
  const listId = useId();
  const trimmed = query.trim();

  return (
    <div className="flex flex-col gap-3">
      {rawText && (
        <p className="text-sm text-ink-3">
          Read as <span className="font-medium text-ink-2">{rawText}</span>
        </p>
      )}
      <div className="relative">
        <Search size={18} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3" />
        <Input
          autoFocus
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (results[0]) onPick(results[0]);
              else if (trimmed) onKeepText(trimmed);
            }
          }}
          placeholder="Search foods"
          aria-label="Search foods"
          aria-controls={listId}
          className="pl-11 [&::-webkit-search-cancel-button]:appearance-none"
        />
      </div>
      <ul id={listId} className="-mx-2 flex flex-col" aria-label="Matching foods">
        {results.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => onPick(f)}
              className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-surface-2"
            >
              <span aria-hidden className="text-2xl">
                {f.emoji}
              </span>
              <span className="flex-1">
                <span className="block text-[15px] font-medium text-ink">{f.name}</span>
                <span className="block text-xs capitalize text-ink-3">{f.category}</span>
              </span>
            </button>
          </li>
        ))}
        {trimmed && !results.some((f) => f.name.toLowerCase() === trimmed.toLowerCase()) && (
          <li>
            <button
              type="button"
              onClick={() => onKeepText(trimmed)}
              className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-surface-2"
            >
              <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-ink-2">
                <Type size={16} />
              </span>
              <span className="flex-1">
                <span className="block text-[15px] font-medium text-ink">Keep as “{trimmed}”</span>
                <span className="block text-xs text-ink-3">Not in our food list. We’ll use general shelf-life estimates.</span>
              </span>
            </button>
          </li>
        )}
        {!trimmed && <li className="px-2 py-4 text-sm text-ink-3">Type a food name, like “spinach” or “mince”.</li>}
      </ul>
    </div>
  );
}
