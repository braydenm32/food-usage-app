-- Hardening after a security review of the sync schema.
-- Column-level update grants, no ownerless or orphaned households, limits on what one account can
-- create, a commit-safe pull cursor, and seq assigned once by a definer trigger.

-- Updates touch only the columns the app edits ------------------------------------
-- Without these, a member could change their own role or household_id, or rewrite an invite token.

revoke update on public.household_members from authenticated, anon;
grant update (display_name) on public.household_members to authenticated;

revoke update on public.household_invites from authenticated, anon;
grant update (revoked) on public.household_invites to authenticated;

drop policy "Members can revoke invites" on public.household_invites;
create policy "Members can revoke invites"
  on public.household_invites for update to authenticated
  using (private.is_household_member(household_id))
  with check (private.is_household_member(household_id) and revoked);

revoke update on public.households from authenticated, anon;
grant update (name) on public.households to authenticated;

-- Deleting an account no longer deletes the household it created ----------------

alter table public.households alter column created_by drop not null;
alter table public.households drop constraint households_created_by_fkey;
alter table public.households
  add constraint households_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

alter table public.household_invites alter column created_by drop not null;
alter table public.household_invites drop constraint household_invites_created_by_fkey;
alter table public.household_invites
  add constraint household_invites_created_by_fkey foreign key (created_by) references auth.users (id) on delete set null;

-- When someone leaves or is removed ---------------------------------------------
-- Last member out deletes the household; a household that loses its only owner promotes the
-- longest-standing member; when an owner removes someone, every open invite is revoked so the
-- removed person can't walk back in with a link they still hold.

create or replace function private.after_member_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.household_members where household_id = old.household_id) then
    delete from public.households where id = old.household_id;
    return null;
  end if;

  if not exists (select 1 from public.household_members where household_id = old.household_id and role = 'owner') then
    update public.household_members set role = 'owner'
    where (household_id, user_id) = (
      select household_id, user_id from public.household_members
      where household_id = old.household_id
      order by joined_at, user_id
      limit 1
    );
  end if;

  if (select auth.uid()) is distinct from old.user_id then
    update public.household_invites set revoked = true
    where household_id = old.household_id and not revoked;
  end if;
  return null;
end;
$$;

create trigger household_members_after_delete
after delete on public.household_members
for each row execute function private.after_member_removed();

-- Records: seq assigned once, by a trigger that owns the sequence -----------------

alter table public.household_records alter column seq drop default;
revoke usage on sequence public.household_records_seq from authenticated;

create or replace function public.household_records_touch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.seq := nextval('public.household_records_seq');
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  if new.deleted then
    new.data := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.household_records_touch() from public, anon, authenticated;

-- A household holds at most 25,000 records (tombstones included). Checked once per statement.
create or replace function private.check_household_record_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from (select distinct household_id from inserted) h
    where (select count(*) from public.household_records r where r.household_id = h.household_id) > 25000
  ) then
    raise exception 'This household has reached its storage limit' using errcode = '54000';
  end if;
  return null;
end;
$$;

create trigger household_records_cap
after insert on public.household_records
referencing new table as inserted
for each statement execute function private.check_household_record_cap();

-- Commit-safe pull ---------------------------------------------------------------
-- seq is taken when a write starts, so a slow write can commit after a later one. A row is only
-- "settled" once its transaction started more than a minute ago (API statements time out long
-- before that), so the returned cursor never moves past a row that might still appear.

create or replace function public.pull_household_records(hid uuid, after_seq bigint, max_rows int default 500)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  page jsonb;
  n int;
  settled bigint;
  last_seq bigint;
begin
  if not private.is_household_member(hid) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  max_rows := least(greatest(coalesce(max_rows, 500), 1), 1000);

  with page_rows as (
    select r.collection, r.id, r.data, r.deleted, r.seq, r.updated_at
    from public.household_records r
    where r.household_id = hid and r.seq > coalesce(after_seq, 0)
    order by r.seq
    limit max_rows
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'collection', p.collection, 'id', p.id, 'data', p.data, 'deleted', p.deleted, 'seq', p.seq
    ) order by p.seq), '[]'::jsonb),
    count(*),
    max(p.seq) filter (where p.updated_at < now() - interval '1 minute'),
    max(p.seq)
  into page, n, settled, last_seq
  from page_rows p;

  return jsonb_build_object(
    'rows', page,
    -- Next call's after_seq. Unsettled rows come back again next time; applying them twice is harmless.
    'cursor', greatest(coalesce(settled, 0), coalesce(after_seq, 0)),
    -- True when a full page came back and more settled rows may follow.
    'more', coalesce(n = max_rows and settled = last_seq, false),
    'server_time', now()
  );
end;
$$;

revoke execute on function public.pull_household_records(uuid, bigint, int) from public, anon;
grant execute on function public.pull_household_records(uuid, bigint, int) to authenticated;

-- RPCs with limits ----------------------------------------------------------------

create or replace function private.require_full_account()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) then
    raise exception 'Sign in with an email to share a household' using errcode = '42501';
  end if;
  return uid;
end;
$$;

create or replace function public.create_household(household_name text default 'My household', member_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_full_account();
  hid uuid;
begin
  if (select count(*) from public.household_members where user_id = uid) >= 5 then
    raise exception 'You can belong to at most 5 households' using errcode = '54000';
  end if;
  insert into public.households (name, created_by)
  values (coalesce(nullif(trim(household_name), ''), 'My household'), uid)
  returning id into hid;
  insert into public.household_members (household_id, user_id, role, display_name)
  values (hid, uid, 'owner', nullif(trim(member_name), ''));
  return hid;
end;
$$;

create or replace function public.create_household_invite(hid uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_full_account();
  t text;
begin
  if not private.is_household_member(hid) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if (
    select count(*) from public.household_invites
    where household_id = hid and not revoked and expires_at > now()
  ) >= 20 then
    raise exception 'This household has too many open invites. Revoke some first' using errcode = '54000';
  end if;
  insert into public.household_invites (household_id, created_by)
  values (hid, uid)
  returning token into t;
  return t;
end;
$$;

-- The household id is only revealed for a usable invite.
drop function public.peek_household_invite(text);
create function public.peek_household_invite(invite_token text)
returns table (household_id uuid, household_name text, expired boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when i.revoked or i.expires_at < now() then null else h.id end,
    h.name,
    (i.revoked or i.expires_at < now())
  from public.household_invites i
  join public.households h on h.id = i.household_id
  where i.token = invite_token;
$$;
revoke execute on function public.peek_household_invite(text) from public, anon;
grant execute on function public.peek_household_invite(text) to authenticated;

create or replace function public.join_household(invite_token text, member_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_full_account();
  inv public.household_invites;
begin
  select * into inv from public.household_invites where token = invite_token for update;
  if not found or inv.revoked or inv.expires_at < now() then
    raise exception 'This invite link has expired or is not valid' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.household_members where household_id = inv.household_id and user_id = uid) then
    return inv.household_id;
  end if;
  if (select count(*) from public.household_members where user_id = uid) >= 5 then
    raise exception 'You can belong to at most 5 households' using errcode = '54000';
  end if;
  if (select count(*) from public.household_members where household_id = inv.household_id) >= 20 then
    raise exception 'This household is full (20 people)' using errcode = '54000';
  end if;
  insert into public.household_members (household_id, user_id, role, display_name)
  values (inv.household_id, uid, 'member', nullif(trim(member_name), ''));
  return inv.household_id;
end;
$$;

revoke execute on function private.require_full_account() from public, anon;
grant execute on function private.require_full_account() to authenticated;
revoke execute on function private.after_member_removed() from public, anon, authenticated;
revoke execute on function private.check_household_record_cap() from public, anon, authenticated;
