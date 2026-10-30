"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  NotebookPen,
  Receipt,
  ScanBarcode,
  Search,
  type LucideIcon,
} from "lucide-react";
import { Button, PageHeader } from "@/components/ui";
import { toast } from "@/components/toast";
import { useLarder } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";
import { draftKey, type BarcodeResponse, type ParseResponse, type ReviewDraft } from "@/lib/drafts";
import { DEFAULT_SOURCE, isMethod, pendingSessions, useAddSession, type AddMethod } from "./session";
import { ReviewList, type MergePlan } from "./review-list";
import { useAiConfigured } from "./ai-status";
import { PhotoCapture } from "./photo-capture";
import { PasteInput } from "./paste-input";
import { BarcodeScanner } from "./barcode-scanner";
import { ManualAdd } from "./manual-add";
import { InfoNotice } from "./notices";

const META: Record<AddMethod, { title: string; blurb: string; Icon: LucideIcon; pageTitle: string; pageSub: string }> = {
  receipt: {
    title: "Scan a receipt",
    blurb: "Snap your supermarket receipt and we’ll sort every line into fridge, freezer and pantry.",
    Icon: Receipt,
    pageTitle: "Scan a receipt",
    pageSub: "Take a photo and we’ll read each line.",
  },
  list: {
    title: "Snap a shopping list",
    blurb: "Handwritten or printed. Handy after a market run.",
    Icon: NotebookPen,
    pageTitle: "Snap a list",
    pageSub: "A photo of your shopping list, ticked off or not.",
  },
  paste: {
    title: "Paste a list or order email",
    blurb: "A typed list, or your Woolworths or Coles order confirmation.",
    Icon: ClipboardPaste,
    pageTitle: "Paste a list",
    pageSub: "Type it, or paste an online order email.",
  },
  barcode: {
    title: "Scan barcodes",
    blurb: "One packet after another, straight from the shopping bags.",
    Icon: ScanBarcode,
    pageTitle: "Scan barcodes",
    pageSub: "Each scan adds a line below.",
  },
  manual: {
    title: "Add by hand",
    blurb: "Search our food list, or type anything.",
    Icon: Search,
    pageTitle: "Add by hand",
    pageSub: "Search, tap, done.",
  },
};

export function AddFlow() {
  const hydrated = useHydrated();
  const params = useSearchParams();
  const m = params.get("method");
  const method = isMethod(m) ? m : null;
  const review = params.get("step") === "review";

  if (!hydrated) return <AddSkeleton />;
  if (!method) return <Hub />;
  return <MethodView key={method} method={method} review={review} />;
}

export function AddSkeleton() {
  return (
    <div aria-busy className="px-5 pt-[calc(1.25rem+env(safe-area-inset-top))] lg:px-0 lg:pt-10">
      <div className="h-10 w-48 rounded-xl bg-surface-2" />
      <div className="mt-3 h-5 w-64 rounded-lg bg-surface-2" />
      <div className="mt-8 h-40 rounded-[var(--radius-card)] bg-surface-2" />
      <div className="mt-4 h-64 rounded-[var(--radius-card)] bg-surface-2" />
    </div>
  );
}

/* ---------- Hub ---------- */

const PENDING_LABEL: Record<AddMethod, string> = {
  receipt: "from a receipt",
  list: "from a list photo",
  paste: "from a pasted list",
  barcode: "from barcode scans",
  manual: "added by hand",
};

const PHOTO_METHODS: AddMethod[] = ["receipt", "list"];

function Hub() {
  const [pending] = useState(pendingSessions);
  const ai = useAiConfigured();
  // Without AI, photo reading can't work, so the paste flow leads and the photo options say they need setup.
  const hero: AddMethod = ai === false ? "paste" : "receipt";
  const secondary: AddMethod[] =
    ai === false ? ["barcode", "manual", "receipt", "list"] : ["paste", "list", "barcode", "manual"];
  const { Icon: HeroIcon } = META[hero];

  return (
    <>
      <PageHeader title="Add food" subtitle="Get your shopping into the larder. Pick whatever’s quickest." />
      <div className="flex flex-col gap-6 px-5 lg:px-0">
        {pending.length > 0 && (
          <div className="flex flex-col gap-2">
            {pending.map((p) => (
              <Link
                key={p.method}
                href={`/add?method=${p.method}${["receipt", "list", "paste"].includes(p.method) ? "&step=review" : ""}`}
                className="flex min-h-14 items-center gap-3 rounded-2xl bg-soon-soft px-4 py-3 text-[15px] text-ink"
              >
                <span className="flex-1">
                  <span className="font-semibold">
                    {p.count} {p.count === 1 ? "item" : "items"} waiting
                  </span>{" "}
                  <span className="text-ink-2">{PENDING_LABEL[p.method]}</span>
                </span>
                <span className="font-semibold text-soon">Continue</span>
              </Link>
            ))}
          </div>
        )}

        <Link
          href={`/add?method=${hero}`}
          className="group relative flex flex-col gap-4 overflow-hidden rounded-[var(--radius-card)] bg-primary p-6 text-primary-ink shadow-card sm:flex-row sm:items-center"
        >
          <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary-ink/15">
            <HeroIcon size={28} strokeWidth={2} />
          </span>
          <span className="flex-1">
            <span className="block font-display text-2xl leading-tight">{META[hero].title}</span>
            <span className="mt-1 block text-[15px] opacity-85">{META[hero].blurb}</span>
          </span>
          <span aria-hidden className="absolute right-5 top-6 opacity-70 transition-transform group-hover:translate-x-0.5 sm:static">
            <ChevronRight size={22} />
          </span>
        </Link>

        <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
          {secondary.map((m) => {
            const { Icon, title, blurb } = META[m];
            const needsSetup = ai === false && PHOTO_METHODS.includes(m);
            return (
              <li key={m}>
                <Link href={`/add?method=${m}`} className="flex min-h-[4.5rem] items-center gap-4 px-4 py-3.5 hover:bg-surface-2">
                  <span
                    aria-hidden
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${needsSetup ? "bg-surface-2 text-ink-3" : "bg-primary-soft text-primary"}`}
                  >
                    <Icon size={21} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 text-[16px] font-semibold text-ink">
                      {title}
                      {needsSetup && (
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-ink-2">Needs setup</span>
                      )}
                    </span>
                    <span className="block text-sm text-ink-2">
                      {needsSetup ? "Photo reading isn’t switched on here yet." : blurb}
                    </span>
                  </span>
                  <ChevronRight size={18} aria-hidden className="shrink-0 text-ink-3" />
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="text-sm text-ink-3">
          Everything is checked before it’s added, and shelf life is estimated for each food. You can always change it later.
        </p>
      </div>
    </>
  );
}

/* ---------- One method ---------- */

function MethodView({ method, review }: { method: AddMethod; review: boolean }) {
  const router = useRouter();
  const addItems = useLarder((s) => s.addItems);
  const { session, setSession, setDrafts, clear } = useAddSession(method);
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [lastScan, setLastScan] = useState<{ text: string; emoji: string; ok: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const meta = META[method];
  const drafts = session.drafts;
  const inReview = review && drafts.length > 0 && (method === "receipt" || method === "list" || method === "paste");

  const onParsed = useCallback(
    (r: ParseResponse) => {
      setSession(() => ({
        drafts: r.drafts,
        source: method === "paste" ? (r.orderEmail ? "order" : "list") : DEFAULT_SOURCE[method],
        storeName: r.storeName,
        note: r.note,
        updatedAt: Date.now(),
      }));
      router.push(`/add?method=${method}&step=review`);
    },
    [method, router, setSession],
  );

  const onCode = useCallback(
    async (code: string) => {
      const key = draftKey();
      const placeholder: ReviewDraft = {
        key,
        name: `Barcode ${code}`,
        rawText: "Looking up…",
        foodTypeId: null,
        emoji: "🔎",
        locationId: "pantry",
        quantity: 1,
        unit: "item",
        dateKind: "best-before",
        include: true,
        confidence: "low",
        isFood: true,
      };
      setDrafts((ds) => [placeholder, ...ds]);
      setPending((p) => new Set(p).add(key));
      setLastScan({ text: `Scanned ${code}. Looking it up…`, emoji: "🔎", ok: true });
      let next: ReviewDraft;
      try {
        const res = await fetch(`/api/barcode/${code}`);
        const json = (await res.json().catch(() => null)) as BarcodeResponse | null;
        if (json?.found && json.draft) {
          next = { ...json.draft, key };
          setLastScan({ text: `Added ${json.brand ? `${json.brand} ` : ""}${json.name}`, emoji: json.draft.emoji, ok: true });
        } else if (res.status === 404) {
          next = { ...placeholder, emoji: "🛒", rawText: `${code} · not in the product database. Tap to choose the food.` };
          setLastScan({ text: `Couldn’t find ${code}. Tap the line below to say what it is.`, emoji: "🛒", ok: false });
        } else {
          throw new Error("lookup failed");
        }
      } catch {
        next = { ...placeholder, emoji: "🛒", rawText: `${code} · couldn’t look it up. Tap to choose the food.` };
        setLastScan({ text: "Couldn’t reach the product database. Tap the line below to choose the food.", emoji: "🛒", ok: false });
      }
      setDrafts((ds) => ds.map((d) => (d.key === key ? next : d)));
      setPending((p) => {
        const n = new Set(p);
        n.delete(key);
        return n;
      });
    },
    [setDrafts],
  );

  function submit(fresh: ReviewDraft[], merges: MergePlan[]) {
    if (fresh.length + merges.length === 0) return;
    setSubmitting(true);
    const created = addItems(fresh, session.source, merges.length ? { merge: merges } : undefined);
    const n = created.length;
    const m = merges.length;
    const message =
      n === 0
        ? `Topped up ${m} ${m === 1 ? "item" : "items"} in your larder`
        : m === 0
          ? `Added ${n} ${n === 1 ? "item" : "items"} to your larder`
          : `Added ${n} ${n === 1 ? "item" : "items"}, topped up ${m}`;
    toast(message, { undoable: true });
    clear();
    router.push("/pantry");
  }

  function startOver() {
    clear();
    router.replace(`/add?method=${method}`);
  }

  const backHref = inReview ? `/add?method=${method}` : "/add";
  const reviewTitle = method === "receipt" ? "Check your receipt" : method === "list" ? "Check your list" : "Check these items";
  const foodCount = drafts.filter((d) => d.isFood).length;
  const showPrices =
    session.source === "receipt" || session.source === "order" || drafts.some((d) => d.price !== undefined);

  return (
    <>
      <div className="px-5 pt-[calc(0.75rem+env(safe-area-inset-top))] lg:px-0 lg:pt-8">
        <Link
          href={backHref}
          className="-ml-2 inline-flex h-11 items-center gap-1 rounded-full pl-1 pr-3 text-[15px] font-medium text-ink-2 hover:bg-surface-2 hover:text-ink"
        >
          <ChevronLeft size={20} aria-hidden />
          {inReview ? "Back" : "All ways to add"}
        </Link>
      </div>
      <div className="-mt-3 lg:-mt-6">
        <PageHeader
          title={inReview ? reviewTitle : meta.pageTitle}
          subtitle={
            inReview
              ? `${session.storeName ? `${session.storeName} · ` : ""}${foodCount} ${foodCount === 1 ? "food" : "foods"} found. Untick anything you didn’t buy.`
              : meta.pageSub
          }
        />
      </div>

      {inReview ? (
        <>
          {session.note && <InfoNotice className="mx-5 mb-4 lg:mx-0">{session.note}</InfoNotice>}
          <ReviewList drafts={drafts} setDrafts={setDrafts} onSubmit={submit} submitting={submitting} showPrices={showPrices} />
          <div className="mt-2 flex justify-center">
            <Button variant="ghost" onClick={startOver}>
              Discard and start over
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-8">
          <div className="px-5 lg:px-0">
            {drafts.length > 0 && (method === "receipt" || method === "list" || method === "paste") && (
              <Link
                href={`/add?method=${method}&step=review`}
                className="mb-5 flex min-h-14 items-center gap-3 rounded-2xl bg-soon-soft px-4 py-3 text-[15px] text-ink"
              >
                <span className="flex-1">
                  <span className="font-semibold">
                    {drafts.length} {drafts.length === 1 ? "line" : "lines"} still to check
                  </span>{" "}
                  <span className="text-ink-2">from last time</span>
                </span>
                <span className="font-semibold text-soon">Continue</span>
              </Link>
            )}
            {method === "receipt" && <PhotoCapture kind="receipt" onResult={onParsed} />}
            {method === "list" && <PhotoCapture kind="list" onResult={onParsed} />}
            {method === "paste" && <PasteInput onResult={onParsed} />}
            {method === "barcode" && (
              <>
                <BarcodeScanner onCode={(c) => void onCode(c)} />
                {lastScan && (
                  <p
                    role="status"
                    className={`mt-3 flex items-center gap-2 rounded-2xl px-4 py-2.5 text-[15px] text-ink ${lastScan.ok ? "bg-fresh-soft" : "bg-soon-soft"}`}
                  >
                    <span aria-hidden>{lastScan.emoji}</span>
                    {lastScan.text}
                  </p>
                )}
              </>
            )}
            {method === "manual" && <ManualAdd onAdd={(d) => setDrafts((ds) => [d, ...ds])} />}
          </div>

          {(method === "barcode" || method === "manual") && (
            <section aria-label="Items to add">
              {drafts.length > 0 ? (
                <>
                  <div className="mb-3 flex items-baseline justify-between px-5 lg:px-0">
                    <h2 className="font-display text-xl text-ink">To add</h2>
                    <Button variant="ghost" size="sm" onClick={() => clear()}>
                      Clear
                    </Button>
                  </div>
                  <ReviewList
                    drafts={drafts}
                    setDrafts={setDrafts}
                    onSubmit={submit}
                    pendingKeys={pending}
                    allowRemove
                    submitting={submitting}
                    showPrices={showPrices}
                  />
                </>
              ) : (
                <p className="px-5 text-[15px] text-ink-3 lg:px-0">
                  {method === "barcode"
                    ? "Scanned items will appear here so you can check them before adding."
                    : "Foods you pick will appear here so you can set where they go and how much."}
                </p>
              )}
            </section>
          )}
        </div>
      )}
    </>
  );
}
