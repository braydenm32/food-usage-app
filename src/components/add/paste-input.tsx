"use client";

import { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { lineToDraft, parseLocalList, type ApiError, type ParseResponse } from "@/lib/drafts";
import { ErrorNotice } from "./notices";

const PLACEHOLDER = `milk 2L
2x tins tomatoes
500g beef mince
bananas
baby spinach`;

export function PasteInput({ onResult }: { onResult: (r: ParseResponse) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const hintId = useId();

  async function submit() {
    if (!text.trim()) {
      setError("Paste or type at least one item.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/parse-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = (await res.json().catch(() => null)) as ParseResponse | ApiError | null;
      if (res.ok && json && "drafts" in json) {
        onResult(json);
        return;
      }
      setError((json && "message" in json && json.message) || "Couldn’t read that. Try one item per line.");
    } catch {
      // Offline or server unreachable: the parser runs in the browser too.
      const local = parseLocalList(text);
      if (local.lines.length === 0) {
        setError("Couldn’t find any items in that text. Try one item per line.");
      } else {
        onResult({ drafts: local.lines.map(lineToDraft), method: "local", orderEmail: local.orderEmail });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-medium text-ink-2">
          Your list or order email
        </label>
        <textarea
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          }}
          placeholder={PLACEHOLDER}
          aria-describedby={hintId}
          rows={10}
          className="min-h-56 w-full resize-y rounded-2xl border border-line bg-surface px-4 py-3 text-base leading-relaxed text-ink placeholder:text-ink-3 focus:border-primary focus:outline-none"
        />
        <p id={hintId} className="text-sm text-ink-3">
          One item per line. Amounts like “2x”, “500g” or “1kg” are picked up.
        </p>
      </div>

      {error && <ErrorNotice>{error}</ErrorNotice>}

      <Button type="submit" size="lg" block disabled={busy}>
        {busy ? (
          <>
            <Loader2 size={18} aria-hidden className="animate-spin" />
            Reading…
          </>
        ) : (
          "Read items"
        )}
      </Button>

      <div className="rounded-[var(--radius-card)] bg-surface-2 px-4 py-3.5 text-[15px] text-ink-2">
        <p className="font-semibold text-ink">Shopped online?</p>
        <p className="mt-1">
          Open your Woolworths or Coles order confirmation email, select all, copy, and paste it here. We’ll skip the
          greetings, delivery details and totals.
        </p>
      </div>
    </form>
  );
}
