"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Crown, Link2Off, LogOut, RefreshCw, Share2, Trash2, UserMinus, UserPlus, Users } from "lucide-react";
import { useLarder } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";
import { getSupabase, supabaseConfigured } from "@/lib/supabase/client";
import { getSyncEngine } from "@/lib/sync/engine";
import { hasLocalData } from "@/lib/sync/apply";
import {
  INVITE_LIFETIME,
  cancelOpenInvites,
  createHousehold,
  createInvite,
  deleteAccount,
  explain,
  inviteUrl,
  leaveHousehold,
  listMembers,
  listMemberships,
  nameFromEmail,
  parseInviteInput,
  removeMember,
  setDisplayName,
  type Member,
  type Membership,
} from "@/lib/sync/household";
import { clearAllLocalData } from "@/lib/local-data";
import { describeFailed, describeSync, timeAgo, useSyncStatus } from "@/lib/sync/status";
import { useNow } from "@/lib/use-now";
import { AuthPanel } from "@/components/account/auth-panel";
import {
  JoinModeChoice,
  NotConfigured,
  Notice,
  SkeletonCards,
  defaultJoinMode,
  previousWarning,
  unsyncedWarning,
  useAuthReturn,
  type JoinMode,
} from "@/components/account/shared";
import { SyncIcon } from "@/components/sync-indicator";
import { Button, Card, Field, Input, PageHeader } from "@/components/ui";
import { toast } from "@/components/toast";

/** Set just before the reload that follows deleting an account, so the page can say it worked. */
const DELETED_FLAG = "larder-account-deleted";

function useAccountDeleted(): boolean {
  // Read once on the client (shown only after hydration), cleared after the first render.
  const [deleted] = useState(() => {
    try {
      return typeof window !== "undefined" && sessionStorage.getItem(DELETED_FLAG) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.removeItem(DELETED_FLAG);
    } catch {
      /* storage blocked */
    }
  }, []);
  return deleted;
}

export default function AccountPage() {
  const hydrated = useHydrated();
  const status = useSyncStatus();
  const returnError = useAuthReturn();
  const deleted = useAccountDeleted();

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
        {hydrated && deleted && (
          <Notice>Your account has been deleted, and so has everything Larder kept on this device.</Notice>
        )}
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
  const { previous, userId } = useSyncStatus();
  const profile = useLarder((s) => s.profile);
  const itemCount = useLarder((s) => s.items.length);
  const local = useLarder((s) => hasLocalData(s));
  /** Only asked when the food here came from another household: then it starts empty by default. */
  const [mode, setMode] = useState<JoinMode>(() => defaultJoinMode(previous));
  const carried = local ? previousWarning(previous, userId) : null;
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
      await engine.bind(id, name, carried && mode === "replace" ? "replace" : "upload").catch(() => {
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
          {carried && (
            <>
              <Notice tone="warn">{carried}</Notice>
              <JoinModeChoice householdName={householdName.trim() || "the household"} value={mode} onChange={setMode} itemCount={itemCount} fresh />
            </>
          )}
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
  const { previous, userId } = useSyncStatus();
  const local = useLarder((s) => hasLocalData(s));
  const itemCount = useLarder((s) => s.items.length);
  const [mode, setMode] = useState<JoinMode>(() => defaultJoinMode(previous));
  const carried = local ? previousWarning(previous, userId) : null;
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
        {carried && <Notice tone="warn">{carried}</Notice>}
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
  const isOwner = me?.role === "owner";
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
                <li key={m.userId} className="flex min-h-14 flex-wrap items-center gap-3 py-3">
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
                  {isOwner && m.userId !== status.userId && (
                    <RemoveMember
                      householdId={hid}
                      member={m}
                      householdName={status.householdName ?? "the household"}
                      onRemoved={() => setReloadKey((k) => k + 1)}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          {me && !me.displayName && <NamePrompt householdId={hid} email={status.email} onSaved={() => setReloadKey((k) => k + 1)} />}
        </Card>
      </section>

      <InviteCard householdId={hid} householdName={status.householdName ?? "your household"} isOwner={isOwner} />
      <LeaveCard
        householdId={hid}
        householdName={status.householdName ?? "this household"}
        lastOne={!members.loading && !members.error && members.list.length <= 1}
      />
      <AccountCard />
    </>
  );
}

/** Owner only: take someone out of the household, after a confirm. */
function RemoveMember({
  householdId,
  householdName,
  member,
  onRemoved,
}: {
  householdId: string;
  householdName: string;
  member: Member;
  onRemoved: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = member.displayName ?? "this person";

  const remove = async () => {
    const client = getSupabase();
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      await removeMember(client, householdId, member.userId);
      toast(`${member.displayName ?? "They"} can no longer see ${householdName}. Open invite links were cancelled too.`);
      onRemoved();
    } catch (e) {
      setError(explain(e, "Couldn't remove them."));
      setBusy(false);
    }
  };

  if (!confirm) {
    return (
      <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setConfirm(true)} aria-label={`Remove ${who}`}>
        <UserMinus size={14} aria-hidden />
        Remove
      </Button>
    );
  }
  return (
    <div role="alertdialog" aria-label={`Remove ${who}?`} className="flex basis-full flex-col gap-2 rounded-xl bg-soon-soft p-3">
      <p className="text-sm text-ink">
        Remove {who} from {householdName}? They stop seeing the household&apos;s food straight away, and every open invite link is
        cancelled. Anything already on their devices stays there. To come back they&apos;d need a new invite.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setConfirm(false)} autoFocus>
          Keep them
        </Button>
        <Button variant="danger" size="sm" onClick={() => void remove()} disabled={busy}>
          {busy ? "Removing…" : `Remove ${who}`}
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
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

function InviteCard({ householdId, householdName, isOwner }: { householdId: string; householdName: string; isOwner: boolean }) {
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
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

  const cancelAll = async () => {
    const client = getSupabase();
    if (!client) return;
    setCancelling(true);
    setError(null);
    try {
      const n = await cancelOpenInvites(client, householdId);
      setLink(null);
      toast(n ? `Cancelled ${n} invite link${n === 1 ? "" : "s"}. They won't work any more.` : "There were no open invite links to cancel.");
    } catch (e) {
      setError(explain(e, "Couldn't cancel the invite links."));
    } finally {
      setCancelling(false);
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
            This link lets one person join {householdName} and lasts {INVITE_LIFETIME}. Whoever opens it first can use it, so send it
            only to the person you mean. Make a new link for each person.
          </p>
          <Button variant="ghost" size="sm" className="self-start" onClick={() => void make()} disabled={busy}>
            <UserPlus size={14} aria-hidden />
            {busy ? "Making a link…" : "Make another link"}
          </Button>
        </div>
      )}
      {isOwner && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="text-sm text-ink-2">Sent a link to the wrong person, or not sure where one went?</p>
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => void cancelAll()} disabled={cancelling}>
            <Link2Off size={14} aria-hidden />
            {cancelling ? "Cancelling…" : "Cancel open invite links"}
          </Button>
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
            You&apos;ll keep a copy of the food on this device, but it stops syncing both ways. Invite links you made stop working, and to
            come back you&apos;ll need a new invite.
            {lastOne
              ? ` You're the only one in ${householdName}, so leaving deletes it for good.`
              : " If you started the household, the person who's been in it longest takes over."}
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
  const { email, householdId, householdName, previous } = useSyncStatus();
  /**
   * This device syncs with a household: ask whether to keep its food here. When it only
   * came from one earlier (signed out and kept), it's not in step with the household any
   * more, so it isn't offered for removal: signing out keeps it.
   */
  const fromHousehold = Boolean(householdId);
  const fromName = householdName ?? previous?.householdName ?? null;
  /** Non-null while the sign-out choice is showing. */
  const [step, setStep] = useState<{ everywhere: boolean } | null>(null);
  const [keep, setKeep] = useState(false);
  /** Changes still unsent after trying to flush; non-zero shows the warning. */
  const [unsynced, setUnsynced] = useState(0);
  const [busy, setBusy] = useState(false);

  const signOut = async (everywhere: boolean, force = false) => {
    const engine = getSyncEngine();
    if (!engine) return;
    setBusy(true);
    try {
      if (!force) {
        const left = await engine.flushPending();
        if (left > 0) {
          // Removing would lose them: only keeping is offered from here.
          setUnsynced(left);
          setKeep(true);
          setStep({ everywhere });
          return;
        }
      }
      // Never remove changes that haven't reached the household (the engine checks too).
      const keepData = fromHousehold && unsynced === 0 ? keep : true;
      const reached = await engine.signOut({ keepData, everywhere });
      const where = !everywhere
        ? "Signed out."
        : reached
          ? "Signed out on all your devices."
          : "Signed out here, but couldn't reach your other devices. Try again from one of them.";
      toast(keepData ? `${where} Your food is still on this device.` : `${where} The household's food has been removed from this device.`);
    } catch {
      toast("Signed out on this device.");
    } finally {
      setBusy(false);
    }
  };

  const begin = (everywhere: boolean) => {
    setUnsynced(0);
    if (!fromHousehold) {
      void signOut(everywhere);
      return;
    }
    setKeep(false);
    setStep({ everywhere });
  };

  const allChoices = [
    {
      keep: false,
      title: "Remove it from this device",
      body: `The food, list, recipes and history${fromName ? ` from ${fromName}` : ""} are cleared here. They stay in the household, and come back when you sign in again. Best for a shared or borrowed device.`,
    },
    {
      keep: true,
      title: "Keep this household's food on this device",
      body: "Anyone who uses this device can still see it, but it stops syncing.",
    },
  ];
  /** With changes still unsent, removing would lose them, so only keeping is offered. */
  const choices = unsynced > 0 ? allChoices.filter((c) => c.keep) : allChoices;

  return (
    <>
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-ink-2">Signed in as</p>
            <p className="truncate text-[15px] font-medium text-ink">{email ?? "your account"}</p>
          </div>
          {!step && (
            <Button variant="secondary" size="sm" className="shrink-0" onClick={() => begin(false)} disabled={busy}>
              <LogOut size={14} aria-hidden />
              {busy ? "Signing out…" : "Sign out"}
            </Button>
          )}
        </div>
        {step && (
          <div className="mt-4 flex flex-col gap-3" role="alertdialog" aria-labelledby="signout-heading">
            <p id="signout-heading" className="text-[15px] font-medium text-ink">
              {step.everywhere ? "Sign out on all your devices?" : "Sign out?"}{" "}
              {unsynced > 0 ? "The food on this device stays here." : "What should happen to the food on this device?"}
            </p>
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">The household&apos;s food on this device</legend>
              {choices.map((c) => (
                <label
                  key={String(c.keep)}
                  className={
                    "flex cursor-pointer gap-3 rounded-2xl border p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary " +
                    (keep === c.keep ? "border-primary bg-primary-soft" : "border-line bg-surface hover:bg-surface-2")
                  }
                >
                  <input
                    type="radio"
                    name="signout-keep"
                    checked={keep === c.keep}
                    onChange={() => setKeep(c.keep)}
                    className="mt-1 h-5 w-5 shrink-0 accent-[var(--primary)]"
                  />
                  <span>
                    <span className="block text-[15px] font-medium text-ink">{c.title}</span>
                    <span className="mt-0.5 block text-sm text-ink-2">{c.body}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {unsynced > 0 && <Notice tone="warn">{unsyncedWarning(unsynced)}</Notice>}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setStep(null);
                  setUnsynced(0);
                }}
                autoFocus
              >
                Stay signed in
              </Button>
              <Button variant={unsynced > 0 ? "danger" : "primary"} size="sm" onClick={() => void signOut(step.everywhere, unsynced > 0)} disabled={busy}>
                {busy ? "Signing out…" : unsynced > 0 ? "Sign out anyway" : "Sign out"}
              </Button>
            </div>
          </div>
        )}
        <p className="mt-3 text-sm text-ink-3">
          Signing out stops syncing on this device. <Link href="/settings" className="underline">Theme and reminders</Link> are always per
          device.
        </p>
        {!step && (
          <Button variant="ghost" size="sm" className="mt-2 -ml-2" onClick={() => begin(true)} disabled={busy}>
            Sign out of all devices
          </Button>
        )}
      </Card>
      <DeleteAccountCard householdName={householdName} />
    </>
  );
}

/** Danger zone: delete the account on the server, then wipe this device. */
function DeleteAccountCard({ householdName }: { householdName: string | null }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const client = getSupabase();
    if (!client) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(client);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete your account. Try again in a minute.");
      setBusy(false);
      return;
    }
    // The account is gone: stop syncing, empty the store, wipe storage and start again.
    await getSyncEngine()?.afterAccountDeleted();
    useLarder.getState().resetAll();
    clearAllLocalData();
    try {
      sessionStorage.setItem(DELETED_FLAG, "1");
    } catch {
      /* storage blocked: the page just won't say so */
    }
    window.location.replace("/account");
  };

  return (
    <section aria-labelledby="danger-heading">
      <h2 id="danger-heading" className="mb-2 px-1 font-display text-xl text-ink">
        Danger zone
      </h2>
      <Card className="p-5">
        {!confirm ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[15px] font-medium text-ink">Delete my account</p>
              <p className="text-sm text-ink-2">Removes your account and clears this device. This can&apos;t be undone.</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="shrink-0 border-spoiled text-spoiled hover:bg-spoiled-soft"
              onClick={() => setConfirm(true)}
            >
              <Trash2 size={14} aria-hidden />
              Delete…
            </Button>
          </div>
        ) : (
          <div role="alertdialog" aria-labelledby="delete-heading" aria-describedby="delete-body">
            <p id="delete-heading" className="text-[15px] font-medium text-ink">
              Delete your account for good?
            </p>
            <div id="delete-body" className="mt-1 flex flex-col gap-2 text-sm text-ink-2">
              <p>
                Your email address, your place in {householdName ?? "any household you're in"}, and your reminders are deleted.
              </p>
              <p>
                Food you shared stays with the household for the people still in it. If you&apos;re the last one in a household, it&apos;s
                deleted too.
              </p>
              <p>Everything Larder keeps on this device is cleared as well, including your settings.</p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => setConfirm(false)} autoFocus>
                Keep my account
              </Button>
              <Button variant="danger" size="sm" onClick={() => void run()} disabled={busy}>
                {busy ? "Deleting…" : "Delete my account"}
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
    </section>
  );
}
