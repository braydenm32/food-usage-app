"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Crown, LogOut, RefreshCw, Share2, UserPlus, Users } from "lucide-react";
import { useLarder } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";
import { getSupabase, supabaseConfigured } from "@/lib/supabase/client";
import { getSyncEngine } from "@/lib/sync/engine";
import { hasLocalData } from "@/lib/sync/apply";
import {
  INVITE_DAYS,
  createHousehold,
  createInvite,
  explain,
  inviteUrl,
  leaveHousehold,
  listMembers,
  listMemberships,
  nameFromEmail,
  parseInviteInput,
  setDisplayName,
  type Member,
  type Membership,
} from "@/lib/sync/household";
import { describeFailed, describeSync, timeAgo, useSyncStatus } from "@/lib/sync/status";
import { useNow } from "@/lib/use-now";
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
import { SyncIcon } from "@/components/sync-indicator";
import { Button, Card, Field, Input, PageHeader } from "@/components/ui";
import { toast } from "@/components/toast";

export default function AccountPage() {
  const hydrated = useHydrated();
  const status = useSyncStatus();
  const returnError = useAuthReturn();

  let body: React.ReactNode;
  if (!hydrated || (supabaseConfigured && !status.ready)) body = <SkeletonCards />;
  else if (!supabaseConfigured || status.state === "off") body = <NotConfigured />;
  else if (status.state === "signed-out") body = <SignedOut error={returnError} />;
  else if (status.householdId) body = <HouseholdView />;
  else body = <NoHousehold />;

  return (
    <div className="lg:pb-8">
      <PageHeader title="Sync and share" subtitle="Keep your larder in step across phones, and share it with your household." />
      <div className="flex flex-col gap-6 px-5 lg:px-0">
        {status.notice && hydrated && (
          <div className="flex flex-col gap-2">
            <Notice tone="warn">{status.notice}</Notice>
            <Button variant="ghost" size="sm" className="self-start" onClick={() => getSyncEngine()?.clearNotice()}>
              OK
            </Button>
          </div>
        )}
        {body}
      </div>
    </div>
  );
}

/* ---------- Signed out ---------- */

function SignedOut({ error }: { error: string | null }) {
  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      <AuthPanel
        returnPath="/account"
        intro="Sign in to sync between your devices and share one larder with the people you live with. Without an account, everything stays on this device, and that's fine too."
      />
      <p className="px-1 text-sm text-ink-3">
        Your food is stored on this device first. Signing in doesn&apos;t change what&apos;s here until you choose to start or join a
        household.
      </p>
    </>
  );
}

/* ---------- Signed in, not syncing ---------- */

function useMemberships(userId: string | null) {
  const [state, setState] = useState<{ loading: boolean; error: string | null; list: Membership[] }>({
    loading: true,
    error: null,
    list: [],
  });
  const load = useCallback(async () => {
    const client = getSupabase();
    if (!client || !userId) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      setState({ loading: false, error: null, list: await listMemberships(client) });
    } catch (e) {
      setState({ loading: false, error: explain(e, "Couldn't load your households."), list: [] });
    }
  }, [userId]);
  useEffect(() => {
    let live = true;
    const client = getSupabase();
    if (!client || !userId) return;
    listMemberships(client)
      .then((list) => live && setState({ loading: false, error: null, list }))
      .catch((e) => live && setState({ loading: false, error: explain(e, "Couldn't load your households."), list: [] }));
    return () => {
      live = false;
    };
  }, [userId]);
  return { ...state, reload: load };
}

function NoHousehold() {
  const { userId, email } = useSyncStatus();
  const memberships = useMemberships(userId);

  if (memberships.loading) return <SkeletonCards />;
  return (
    <>
      {memberships.error && (
        <div className="flex flex-col gap-2">
          <Notice tone="error">{memberships.error}</Notice>
          <Button variant="secondary" size="sm" className="self-start" onClick={() => void memberships.reload()}>
            <RefreshCw size={14} aria-hidden />
            Try again
          </Button>
        </div>
      )}
      {memberships.list[0] ? <ConnectExisting membership={memberships.list[0]} /> : !memberships.error && <StartOrJoin email={email} />}
      <AccountCard />
    </>
  );
}

function StartOrJoin({ email }: { email: string | null }) {
  const router = useRouter();
  const profile = useLarder((s) => s.profile);
  const itemCount = useLarder((s) => s.items.length);
  const setProfile = useLarder((s) => s.setProfile);
  const [householdName, setHouseholdName] = useState(profile.householdName);
  const [myName, setMyName] = useState(() => nameFromEmail(email));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);

  const start = async () => {
    const client = getSupabase();
    const engine = getSyncEngine();
    if (!client || !engine) return;
    setBusy(true);
    setError(null);
    const name = householdName.trim() || "My household";
    try {
      if (name !== profile.householdName) setProfile({ householdName: name });
      const id = await createHousehold(client, name, myName);
      await engine.bind(id, name, "upload").catch(() => {
        // The household exists and this device is bound; the outbox retries the upload.
        toast("Household started. Your food will finish uploading when the connection allows.");
      });
      toast(`Started ${name}. Now invite someone to share it.`);
    } catch (e) {
      setError(explain(e, "Couldn't start the household."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card className="p-5">
        <h2 className="font-display text-xl text-ink">Start a household with the food on this device</h2>
        <p className="mt-1 text-[15px] text-ink-2">
          {itemCount
            ? `Your ${itemCount} item${itemCount === 1 ? "" : "s"}, list, recipes and history go up to your household, and stay in step from then on.`
            : "Your list, recipes and settings for the household go up, and stay in step from then on."}{" "}
          Then invite the people you live with.
        </p>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <Field label="Household name">
            {(id) => (
              <Input id={id} value={householdName} maxLength={80} onChange={(e) => setHouseholdName(e.target.value)} placeholder="The Nguyens, Flat 3…" />
            )}
          </Field>
          <Field label="Your name" hint="So others in the household know who's who.">
            {(id) => (
              <Input id={id} value={myName} maxLength={60} autoComplete="given-name" onChange={(e) => setMyName(e.target.value)} placeholder="Sam" />
            )}
          </Field>
          <Button type="submit" block disabled={busy}>
            <Users size={18} aria-hidden />
            {busy ? "Starting…" : "Start the household"}
          </Button>
          {error && <Notice tone="error">{error}</Notice>}
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="font-display text-xl text-ink">Join with an invite link or code</h2>
        <p className="mt-1 text-[15px] text-ink-2">Someone in the household can make one under Sync and share. Paste the whole link or just the code.</p>
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            const token = parseInviteInput(invite);
            if (!token) {
              setInviteError("That doesn't look like an invite link. It should look like larder…/join/ followed by a code.");
              return;
            }
            router.push(`/join/${token}`);
          }}
        >
          <Input
            aria-label="Invite link or code"
            value={invite}
            onChange={(e) => {
              setInvite(e.target.value);
              setInviteError(null);
            }}
            placeholder="Paste the invite link"
            autoCapitalize="none"
            spellCheck={false}
          />
          <Button type="submit" variant="secondary" className="shrink-0" disabled={!invite.trim()}>
            Continue
          </Button>
        </form>
        {inviteError && (
          <div className="mt-3">
            <Notice tone="error">{inviteError}</Notice>
          </div>
        )}
      </Card>
    </>
  );
}

/** Signed in on a new device (or after signing out): this account is already in a household. */
function ConnectExisting({ membership }: { membership: Membership }) {
  const local = useLarder((s) => hasLocalData(s));
  const itemCount = useLarder((s) => s.items.length);
  const [mode, setMode] = useState<JoinMode>("merge");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    const engine = getSyncEngine();
    if (!engine) return;
    setBusy(true);
    setError(null);
    try {
      await engine.bind(membership.householdId, membership.householdName, local ? mode : "replace");
      toast(`This device now syncs with ${membership.householdName}`);
    } catch (e) {
      setError(explain(e, "Couldn't finish the first sync. It'll keep trying in the background."));
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="font-display text-xl text-ink">You&apos;re in {membership.householdName}</h2>
      <p className="mt-1 text-[15px] text-ink-2">This device isn&apos;t syncing with it yet.</p>
      <div className="mt-4 flex flex-col gap-4">
        {local && <JoinModeChoice householdName={membership.householdName} value={mode} onChange={setMode} itemCount={itemCount} />}
        <Button block onClick={() => void connect()} disabled={busy}>
          {busy ? "Syncing…" : "Sync this device"}
        </Button>
        {error && <Notice tone="error">{error}</Notice>}
      </div>
    </Card>
  );
}

/* ---------- Syncing with a household ---------- */

function HouseholdView() {
  const status = useSyncStatus();
  const now = useNow();
  const hid = status.householdId!;
  const [members, setMembers] = useState<{ loading: boolean; error: string | null; list: Member[] }>({
    loading: true,
    error: null,
    list: [],
  });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let live = true;
    const client = getSupabase();
    if (!client) return;
    listMembers(client, hid)
      .then((list) => live && setMembers({ loading: false, error: null, list }))
      .catch((e) => live && setMembers((m) => ({ ...m, loading: false, error: explain(e, "Couldn't load the members.") })));
    return () => {
      live = false;
    };
  }, [hid, reloadKey]);

  const me = members.list.find((m) => m.userId === status.userId);
  const canRetry = status.state === "error" || status.state === "offline";

  return (
    <>
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft">
            <SyncIcon state={status.state} size={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl leading-tight text-ink">{status.householdName ?? "Your household"}</h2>
            <p className="mt-1 text-[15px] text-ink-2" role="status">
              {describeSync(status, now)}
            </p>
            {status.state === "error" && status.error && <p className="mt-1 text-sm text-ink-3">{status.error}</p>}
            {status.state === "synced" && status.lastSyncedAt && (
              <p className="sr-only">Last synced {timeAgo(status.lastSyncedAt, now)}</p>
            )}
          </div>
        </div>
        {canRetry && (
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => getSyncEngine()?.syncNow()}>
            <RefreshCw size={14} aria-hidden />
            Sync now
          </Button>
        )}
        <FailedChanges />
      </Card>

      <section aria-labelledby="members-heading">
        <h2 id="members-heading" className="mb-2 px-1 font-display text-xl text-ink">
          Who&apos;s in
        </h2>
        <Card className="divide-y divide-line px-4">
          {members.loading ? (
            <div className="py-4">
              <div className="h-10 animate-pulse rounded-xl bg-surface-2" aria-busy aria-label="Loading members" />
            </div>
          ) : members.error ? (
            <div className="flex flex-col gap-2 py-4">
              <p className="text-sm text-ink-2">{members.error}</p>
              <Button variant="secondary" size="sm" className="self-start" onClick={() => setReloadKey((k) => k + 1)}>
                Try again
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {members.list.map((m) => (
                <li key={m.userId} className="flex min-h-14 items-center gap-3 py-3">
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 font-semibold text-ink-2"
                  >
                    {(m.displayName ?? "?").charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-ink">
                      {m.displayName ?? (m.userId === status.userId ? "You" : "Someone without a name yet")}
                      {m.userId === status.userId && m.displayName && <span className="font-normal text-ink-2"> (you)</span>}
                    </span>
                    {m.userId === status.userId && status.email && <span className="block truncate text-sm text-ink-2">{status.email}</span>}
                  </span>
                  {m.role === "owner" && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-ink-2">
                      <Crown size={14} aria-hidden />
                      Started it
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {me && !me.displayName && <NamePrompt householdId={hid} email={status.email} onSaved={() => setReloadKey((k) => k + 1)} />}
        </Card>
      </section>

      <InviteCard householdId={hid} householdName={status.householdName ?? "your household"} />
      <LeaveCard
        householdId={hid}
        householdName={status.householdName ?? "this household"}
        lastOne={!members.loading && !members.error && members.list.length <= 1}
      />
      <AccountCard />
    </>
  );
}

/** Changes set aside because the server can't take them: say so, and offer a retry. */
function FailedChanges() {
  const failed = useSyncStatus((s) => s.failed);
  const line = describeFailed(failed);
  if (!line) return null;
  const tooLarge = failed.every((f) => f.reason === "too-large");
  return (
    <div className="mt-4 rounded-xl bg-soon-soft p-3">
      <p className="text-sm text-ink">{line}.</p>
      <p className="mt-1 text-sm text-ink-2">
        {tooLarge
          ? "They're still on this device. Shortening long notes or recipes, then trying again, usually fixes it."
          : "They're still on this device, but the household won't see them."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => getSyncEngine()?.retryFailed()}>
          <RefreshCw size={14} aria-hidden />
          Try again
        </Button>
        <Button variant="ghost" size="sm" onClick={() => getSyncEngine()?.clearFailed()}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

function NamePrompt({ householdId, email, onSaved }: { householdId: string; email: string | null; onSaved: () => void }) {
  const [name, setName] = useState(() => nameFromEmail(email));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-3 py-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const client = getSupabase();
        if (!client || !name.trim()) return;
        setBusy(true);
        setError(null);
        try {
          await setDisplayName(client, householdId, name);
          onSaved();
        } catch (err) {
          setError(explain(err, "Couldn't save your name."));
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Your name" hint="Shown to others in the household. We can't show them your email.">
        {(id) => (
          <div className="flex gap-2">
            <Input id={id} value={name} maxLength={60} autoComplete="given-name" onChange={(e) => setName(e.target.value)} placeholder="Sam" />
            <Button type="submit" variant="secondary" className="shrink-0" disabled={!name.trim() || busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
    </form>
  );
}

function InviteCard({ householdId, householdName }: { householdId: string; householdName: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  const make = async () => {
    const client = getSupabase();
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      const token = await createInvite(client, householdId);
      setLink(inviteUrl(window.location.origin, token));
      setCopied(false);
    } catch (e) {
      setError(explain(e, "Couldn't make an invite link."));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast("Invite link copied");
    } catch {
      setError("Couldn't copy automatically. Select the link and copy it instead.");
    }
  };

  const share = async () => {
    if (!link) return;
    try {
      await navigator.share({ title: `Join ${householdName} on Larder`, text: `Join ${householdName} on Larder so we can share the food list.`, url: link });
    } catch (e) {
      if ((e as Error).name !== "AbortError") void copy();
    }
  };

  return (
    <Card className="p-5">
      <h2 className="font-display text-xl text-ink">Invite someone</h2>
      <p className="mt-1 text-[15px] text-ink-2">
        They&apos;ll see the same food, list, recipes and plan, and their changes show up here as they make them.
      </p>
      {!link ? (
        <Button className="mt-4" onClick={() => void make()} disabled={busy}>
          <UserPlus size={18} aria-hidden />
          {busy ? "Making a link…" : "Make an invite link"}
        </Button>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <label className="sr-only" htmlFor="invite-link">
            Invite link
          </label>
          <input
            id="invite-link"
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className="h-12 w-full rounded-2xl border border-line bg-surface-2 px-4 text-sm text-ink"
          />
          <div className="flex flex-wrap gap-2">
            {canShare && (
              <Button onClick={() => void share()}>
                <Share2 size={16} aria-hidden />
                Share link
              </Button>
            )}
            <Button variant={canShare ? "secondary" : "primary"} onClick={() => void copy()}>
              {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
          <p className="text-sm text-ink-2">
            Works for {INVITE_DAYS} days. Anyone with the link can join {householdName}, so send it only to people you live with.
          </p>
        </div>
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </Card>
  );
}

function LeaveCard({ householdId, householdName, lastOne }: { householdId: string; householdName: string; lastOne: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Changes still unsent after trying to flush; leaving again means accepting they're lost. */
  const [unsynced, setUnsynced] = useState(0);

  const leave = async () => {
    const client = getSupabase();
    const engine = getSyncEngine();
    if (!client || !engine) return;
    setBusy(true);
    setError(null);
    try {
      if (!unsynced) {
        const left = await engine.flushPending();
        if (left > 0) {
          setUnsynced(left);
          setBusy(false);
          return;
        }
      }
      await leaveHousehold(client, householdId);
      engine.unbind();
      toast(
        lastOne
          ? `You've left ${householdName}. You were the last person in it, so the household has been deleted. Your food is still on this device.`
          : `You've left ${householdName}. Your food is still on this device.`,
      );
    } catch (e) {
      setError(explain(e, "Couldn't leave the household."));
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      {!confirm ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[15px] font-medium text-ink">Leave {householdName}</p>
            <p className="text-sm text-ink-2">This device keeps a copy of the food but stops syncing.</p>
          </div>
          <Button variant="secondary" size="sm" className="shrink-0 border-spoiled text-spoiled hover:bg-spoiled-soft" onClick={() => setConfirm(true)}>
            Leave…
          </Button>
        </div>
      ) : (
        <div role="alertdialog" aria-labelledby="leave-heading" aria-describedby="leave-body">
          <p id="leave-heading" className="text-[15px] font-medium text-ink">
            Leave {householdName}?
          </p>
          <p id="leave-body" className="mt-1 text-sm text-ink-2">
            You&apos;ll keep what&apos;s on this device, but changes will stop syncing both ways. To come back you&apos;ll need a new invite.
            {lastOne
              ? ` You're the only one in ${householdName}, so leaving deletes it for good.`
              : " If you're the last person in it, the household is deleted."}
          </p>
          {unsynced > 0 && (
            <div className="mt-3">
              <Notice tone="warn">{unsyncedWarning(unsynced)}</Notice>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setConfirm(false);
                setUnsynced(0);
              }}
              autoFocus
            >
              Stay
            </Button>
            <Button variant="danger" size="sm" onClick={() => void leave()} disabled={busy}>
              {busy ? "Leaving…" : unsynced > 0 ? "Leave anyway" : "Leave household"}
            </Button>
          </div>
          {error && (
            <div className="mt-3">
              <Notice tone="error">{error}</Notice>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function AccountCard() {
  const { email } = useSyncStatus();
  /** Changes still unsent after trying to flush; non-zero shows the confirm. */
  const [unsynced, setUnsynced] = useState(0);
  const [busy, setBusy] = useState(false);

  const signOut = async (force = false) => {
    const engine = getSyncEngine();
    if (!engine) return;
    setBusy(true);
    try {
      if (!force) {
        const left = await engine.flushPending();
        if (left > 0) {
          setUnsynced(left);
          return;
        }
      }
      await engine.signOut();
      toast("Signed out. Your food is still on this device.");
    } catch {
      toast("Signed out on this device.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-ink-2">Signed in as</p>
          <p className="truncate text-[15px] font-medium text-ink">{email ?? "your account"}</p>
        </div>
        {!unsynced && (
          <Button variant="secondary" size="sm" className="shrink-0" onClick={() => void signOut()} disabled={busy}>
            <LogOut size={14} aria-hidden />
            {busy ? "Signing out…" : "Sign out"}
          </Button>
        )}
      </div>
      {unsynced > 0 && (
        <div className="mt-3 rounded-xl bg-soon-soft p-3" role="alertdialog" aria-labelledby="signout-heading">
          <p id="signout-heading" className="text-sm text-ink">
            {unsyncedWarning(unsynced)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setUnsynced(0)} autoFocus>
              Stay signed in
            </Button>
            <Button variant="danger" size="sm" onClick={() => void signOut(true)} disabled={busy}>
              Sign out anyway
            </Button>
          </div>
        </div>
      )}
      <p className="mt-3 text-sm text-ink-3">
        Signing out keeps your food on this device and stops syncing. <Link href="/settings" className="underline">Theme and reminders</Link> are
        always per device.
      </p>
    </Card>
  );
}
