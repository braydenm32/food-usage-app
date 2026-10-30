"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { useLarder } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";
import { getSupabase, supabaseConfigured } from "@/lib/supabase/client";
import { getSyncEngine } from "@/lib/sync/engine";
import { hasLocalData } from "@/lib/sync/apply";
import { explain, joinHousehold, nameFromEmail, peekInvite, type InvitePeek } from "@/lib/sync/household";
import { useSyncStatus } from "@/lib/sync/status";
import { AuthPanel } from "@/components/account/auth-panel";
import {
  JoinModeChoice,
  NotConfigured,
  Notice,
  SkeletonCards,
  unsyncedWarning,
  useAuthReturn,
  type JoinMode,
} from "@/components/account/shared";
import { Button, Card, Field, Input, PageHeader, buttonClass } from "@/components/ui";
import { toast } from "@/components/toast";

export function JoinSkeleton() {
  return (
    <div>
      <PageHeader title="Join a household" />
      <div className="px-5 lg:px-0">
        <SkeletonCards count={1} />
      </div>
    </div>
  );
}

type Peek = { status: "loading" } | { status: "error"; message: string } | { status: "done"; invite: InvitePeek | null };

export function JoinScreen({ token }: { token: string }) {
  const hydrated = useHydrated();
  const status = useSyncStatus();
  const returnError = useAuthReturn();

  let body: React.ReactNode;
  if (!hydrated || (supabaseConfigured && !status.ready)) body = <SkeletonCards count={1} />;
  else if (!supabaseConfigured || status.state === "off") body = <NotConfigured />;
  else if (status.state === "signed-out")
    body = (
      <>
        {returnError && <Notice tone="error">{returnError}</Notice>}
        <AuthPanel
          returnPath={`/join/${encodeURIComponent(token)}`}
          intro="Someone has invited you to share their larder. Sign in to see the invite; if you're new, this makes your account."
        />
      </>
    );
  else body = <InviteDetails token={token} />;

  return (
    <div className="lg:pb-8">
      <PageHeader title="Join a household" />
      <div className="flex flex-col gap-6 px-5 lg:px-0">{body}</div>
    </div>
  );
}

function InviteDetails({ token }: { token: string }) {
  const router = useRouter();
  const status = useSyncStatus();
  const local = useLarder((s) => hasLocalData(s));
  const itemCount = useLarder((s) => s.items.length);
  const [peek, setPeek] = useState<Peek>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<JoinMode>("merge");
  const [name, setName] = useState(() => nameFromEmail(status.email));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Unsent changes for the current household; joining again means accepting they're lost. */
  const [unsynced, setUnsynced] = useState(0);

  useEffect(() => {
    let live = true;
    const client = getSupabase();
    if (!client) return;
    peekInvite(client, token)
      .then((invite) => live && setPeek({ status: "done", invite }))
      .catch((e) => live && setPeek({ status: "error", message: explain(e, "Couldn't check the invite.") }));
    return () => {
      live = false;
    };
  }, [token, attempt]);

  if (peek.status === "loading") return <SkeletonCards count={1} />;
  if (peek.status === "error") {
    return (
      <Card className="p-5">
        <Notice tone="error">{peek.message}</Notice>
        <Button
          variant="secondary"
          className="mt-4"
          onClick={() => {
            setPeek({ status: "loading" });
            setAttempt((a) => a + 1);
          }}
        >
          Try again
        </Button>
      </Card>
    );
  }
  const invite = peek.invite;
  if (!invite || invite.expired) {
    return (
      <Card className="p-5">
        <p className="font-display text-xl text-ink">{invite ? "This invite has expired" : "This invite link isn't valid"}</p>
        <p className="mt-2 text-[15px] text-ink-2">
          {invite
            ? `Invite links last 7 days. Ask someone in ${invite.householdName} to make a new one under Sync and share.`
            : "It may have been copied only partly, or it was cancelled. Ask for a new link and open it on this device."}
        </p>
        <Link href="/account" className={buttonClass("secondary", "md") + " mt-4"}>
          Go to Sync and share
        </Link>
      </Card>
    );
  }

  const householdName = invite.householdName;
  if (status.householdId === invite.householdId) {
    return (
      <Card className="p-5">
        <p className="font-display text-xl text-ink">You&apos;re already in {householdName}</p>
        <p className="mt-2 text-[15px] text-ink-2">This device is syncing with it. Nothing more to do.</p>
        <Link href="/" className={buttonClass("primary", "md") + " mt-4"}>
          Go to Today
        </Link>
      </Card>
    );
  }

  const join = async () => {
    const client = getSupabase();
    const engine = getSyncEngine();
    if (!client || !engine) return;
    setBusy(true);
    setError(null);
    try {
      // Switching household drops anything still queued for the current one: send it first.
      if (status.householdId && !unsynced) {
        const left = await engine.flushPending();
        if (left > 0) {
          setUnsynced(left);
          setBusy(false);
          return;
        }
      }
      const hid = await joinHousehold(client, token, name);
      try {
        await engine.bind(hid, householdName, local ? mode : "replace");
        toast(`You've joined ${householdName}`);
      } catch {
        toast(`You've joined ${householdName}. The first sync will finish when the connection allows.`);
      }
      router.push("/account");
    } catch (e) {
      setError(explain(e, "Couldn't join the household."));
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Users size={24} />
      </span>
      <h2 className="mt-3 font-display text-2xl leading-tight text-ink">Join {householdName}?</h2>
      <p className="mt-1 text-[15px] text-ink-2">
        You&apos;ll share one larder: the same food, shopping list, saved recipes and meal plan, kept in step on every device.
      </p>
      <form
        className="mt-5 flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void join();
        }}
      >
        {status.householdId && (
          <Notice tone="warn">
            This device syncs with {status.householdName ?? "another household"} at the moment. Joining {householdName} switches this
            device over; you&apos;ll still be a member of {status.householdName ?? "the other household"} until you leave it.
          </Notice>
        )}
        <Field label="Your name" hint={`So others in ${householdName} know who's who.`}>
          {(id) => (
            <Input id={id} value={name} maxLength={60} autoComplete="given-name" onChange={(e) => setName(e.target.value)} placeholder="Sam" />
          )}
        </Field>
        {local && <JoinModeChoice householdName={householdName} value={mode} onChange={setMode} itemCount={itemCount} />}
        {unsynced > 0 && (
          <div role="alert">
            <Notice tone="warn">
              {unsyncedWarning(unsynced, status.householdName ?? undefined)}
            </Notice>
          </div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
          <Button type="submit" disabled={busy}>
            {busy ? "Joining…" : unsynced > 0 ? `Join ${householdName} anyway` : `Join ${householdName}`}
          </Button>
          <Link href="/" className={buttonClass("ghost", "md")}>
            Not now
          </Link>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
      </form>
    </Card>
  );
}
