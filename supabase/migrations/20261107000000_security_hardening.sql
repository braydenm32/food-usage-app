-- Security hardening, second round.
-- Least-privilege grants, records that can't be moved between households, a storage limit that
-- ignores tombstones but caps bytes, race-free limits, single-use short-lived invites, realtime
-- without DELETE events, retention for stale invites and unconfirmed sign-ups, and what account
-- deletion needs. Written to be safe to run again.

-- 1. Grants ----------------------------------------------------------------------------------
-- Every policy is `to authenticated`, so anon never needed table rights. Take away Supabase's
-- default grants (and the defaults for tables made later), and the table rights no client uses.

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;

revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from authenticated;

-- 2. A record stays where it was written -------------------------------------------------------
-- Upserts write every column, so the key columns keep their update grant; this trigger refuses
-- any change to them. (Someone in two households could otherwise move rows from one to the
-- other, leaving the first household's devices holding records the server no longer has.)

create or replace function private.household_records_keys_fixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.household_id is distinct from old.household_id
    or new.collection is distinct from old.collection
    or new.id is distinct from old.id then
    raise exception 'A record cannot be moved to another household or collection' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.household_records_keys_fixed() from public, anon, authenticated;

drop trigger if exists household_records_keys_fixed on public.household_records;
-- Before triggers run in name order: this one runs before household_records_touch.
create trigger household_records_keys_fixed
before update on public.household_records
for each row execute function private.household_records_keys_fixed();

-- 3. Storage limits -----------------------------------------------------------------------------
-- Count only live records: deleted ones are tombstones the client makes when it trims history,
-- so counting them would stop a normal household syncing after a few years.

create index if not exists household_records_live_idx on public.household_records (household_id) where not deleted;

create or replace function private.check_household_record_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from (select distinct household_id from changed where not deleted) h
    where (
      select count(*) from public.household_records r
      where r.household_id = h.household_id and not r.deleted
    ) > 25000
  ) then
    raise exception 'This household has reached its storage limit'
      using errcode = '54000', hint = 'A household can keep up to 25,000 things. Delete some old ones to make room.';
  end if;
  return null;
end;
$$;
revoke execute on function private.check_household_record_cap() from public, anon, authenticated;

drop trigger if exists household_records_cap on public.household_records;
create trigger household_records_cap
after insert on public.household_records
referencing new table as changed
for each statement execute function private.check_household_record_cap();

-- Bringing a tombstone back to life counts too.
drop trigger if exists household_records_cap_update on public.household_records;
create trigger household_records_cap_update
after update on public.household_records
referencing new table as changed
for each statement execute function private.check_household_record_cap();

-- A byte budget per household (about 20 MB of record data, as JSON text), kept as a running total.
alter table public.households add column if not exists bytes_used bigint not null default 0;

-- Kept by statement-level triggers that sum the net change per household from the transition
-- tables, so a batch that adds some records and removes others is judged on what it leaves
-- behind, not on which row came first. Postgres doesn't allow transition tables on a trigger
-- with more than one event, hence one trigger for inserts and one for updates. An upsert fires
-- both: AFTER UPDATE statement triggers run before AFTER INSERT ones, and inserts only ever add
-- bytes, so the insert trigger sees the statement's whole net change. Transition tables hold
-- rows as stored (household_records_touch has already cleared a tombstone's data), and only the
-- insert or the update that really happened appears in each.

-- Add a household's net change in bytes; refuse growth that would go past the budget. Shrinking
-- (or no change) is always allowed, even for a household already over it.
create or replace function private.add_household_bytes(hid uuid, delta bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  budget constant bigint := 20 * 1024 * 1024;
begin
  if delta > 0 then
    update public.households set bytes_used = bytes_used + delta
    where id = hid and bytes_used + delta <= budget;
    if not found and exists (select 1 from public.households where id = hid) then
      raise exception 'This household has reached its storage limit'
        using errcode = '54000', hint = 'A household can keep about 20 MB. Delete some old recipes or notes to make room.';
    end if;
  elsif delta < 0 then
    update public.households set bytes_used = greatest(bytes_used + delta, 0) where id = hid;
  end if;
end;
$$;
revoke execute on function private.add_household_bytes(uuid, bigint) from public, anon, authenticated;

create or replace function private.household_records_usage_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
begin
  -- Household order, so two statements touching the same households lock them the same way.
  for d in
    select n.household_id, sum(coalesce(octet_length(n.data::text), 0))::bigint as delta
    from inserted n
    group by n.household_id
    order by n.household_id
  loop
    perform private.add_household_bytes(d.household_id, d.delta);
  end loop;
  return null;
end;
$$;
revoke execute on function private.household_records_usage_insert() from public, anon, authenticated;

create or replace function private.household_records_usage_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d record;
begin
  -- Keys can't change (household_records_keys_fixed), so old and new rows pair up by key.
  for d in
    select n.household_id,
      sum(coalesce(octet_length(n.data::text), 0) - coalesce(octet_length(o.data::text), 0))::bigint as delta
    from updated_new n
    join updated_old o on o.household_id = n.household_id and o.collection = n.collection and o.id = n.id
    group by n.household_id
    order by n.household_id
  loop
    perform private.add_household_bytes(d.household_id, d.delta);
  end loop;
  return null;
end;
$$;
revoke execute on function private.household_records_usage_update() from public, anon, authenticated;

-- The per-row version (from an earlier draft of this file) judged each row on its own.
drop trigger if exists household_records_usage on public.household_records;
drop function if exists private.household_records_usage();

drop trigger if exists household_records_usage_insert on public.household_records;
create trigger household_records_usage_insert
after insert on public.household_records
referencing new table as inserted
for each statement execute function private.household_records_usage_insert();

drop trigger if exists household_records_usage_update on public.household_records;
create trigger household_records_usage_update
after update on public.household_records
referencing old table as updated_old new table as updated_new
for each statement execute function private.household_records_usage_update();

update public.households h
set bytes_used = coalesce((
  select sum(octet_length(r.data::text)) from public.household_records r where r.household_id = h.id
), 0);

-- 5 (schema). Single-use invites that last 48 hours ---------------------------------------------

alter table public.household_invites alter column expires_at set default now() + interval '48 hours';
alter table public.household_invites add column if not exists used_by uuid references auth.users (id) on delete set null;
alter table public.household_invites add column if not exists used_at timestamptz;
create index if not exists household_invites_used_by_idx on public.household_invites (used_by);

-- 4 and 5. Household RPCs without races --------------------------------------------------------
-- Two requests at once could each pass a count and both insert. A per-account advisory lock
-- serialises create/join for one person; the household row lock serialises joins to one household.

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
  perform pg_advisory_xact_lock(hashtextextended('larder-account:' || uid::text, 0));
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

-- Holding the caller's membership row (FOR SHARE) means an owner removing them waits until the
-- invite exists, and their removal then revokes it; a removal that lands first makes this fail.
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
  perform 1 from public.household_members where household_id = hid and user_id = uid for share;
  if not found then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if (
    select count(*) from public.household_invites
    where household_id = hid and not revoked and used_at is null and expires_at > now()
  ) >= 20 then
    raise exception 'This household has too many open invites. Revoke some first' using errcode = '54000';
  end if;
  insert into public.household_invites (household_id, created_by)
  values (hid, uid)
  returning token into t;
  return t;
end;
$$;

-- The household id is only revealed for an invite that can still be used.
create or replace function public.peek_household_invite(invite_token text)
returns table (household_id uuid, household_name text, expired boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when usable then h.id else null end,
    h.name,
    not usable
  from (
    select i.household_id, (not i.revoked and i.used_at is null and i.expires_at >= now()) as usable
    from public.household_invites i
    where i.token = invite_token
  ) i
  join public.households h on h.id = i.household_id;
$$;

-- Joining uses up the invite. Someone already in the household gets the id back without using it.
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
  perform pg_advisory_xact_lock(hashtextextended('larder-account:' || uid::text, 0));
  select * into inv from public.household_invites where token = invite_token for update;
  if not found then
    raise exception 'This invite link has expired or is not valid' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.household_members where household_id = inv.household_id and user_id = uid) then
    return inv.household_id;
  end if;
  if inv.revoked or inv.used_at is not null or inv.expires_at < now() then
    raise exception 'This invite link has expired or is not valid' using errcode = 'P0002';
  end if;
  if (select count(*) from public.household_members where user_id = uid) >= 5 then
    raise exception 'You can belong to at most 5 households' using errcode = '54000';
  end if;
  perform 1 from public.households where id = inv.household_id for update;
  if (select count(*) from public.household_members where household_id = inv.household_id) >= 20 then
    raise exception 'This household is full (20 people)' using errcode = '54000';
  end if;
  insert into public.household_members (household_id, user_id, role, display_name)
  values (inv.household_id, uid, 'member', nullif(trim(member_name), ''));
  update public.household_invites
  set used_by = uid, used_at = now(), revoked = true
  where token = invite_token;
  return inv.household_id;
end;
$$;

revoke execute on function public.create_household(text, text) from public, anon;
revoke execute on function public.create_household_invite(uuid) from public, anon;
revoke execute on function public.peek_household_invite(text) from public, anon;
revoke execute on function public.join_household(text, text) from public, anon;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.create_household_invite(uuid) to authenticated;
grant execute on function public.peek_household_invite(text) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;

-- When someone leaves or is removed: as before, plus someone leaving by choice takes the open
-- invites they made with them. Removal by an owner (or account deletion) still revokes them all.
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
  else
    update public.household_invites set revoked = true
    where household_id = old.household_id and created_by = old.user_id and not revoked;
  end if;
  return null;
end;
$$;
revoke execute on function private.after_member_removed() from public, anon, authenticated;

-- 6. Realtime: inserts and updates only ----------------------------------------------------------
-- Realtime doesn't check row-level security for DELETE events, and rows are only ever hard
-- deleted when a whole household goes, so DELETEs would tell any subscriber the ids. The client
-- never needs them: removals are tombstones (updates).

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime set (publish = 'insert, update');
  end if;
end;
$$;

-- 7. Retention ------------------------------------------------------------------------------------
-- Invites are kept 30 days after they expire or are used (for "who joined with what"), then
-- deleted. Sign-ups never confirmed (a code requested, never entered) go after 7 days.

create or replace function private.purge_stale_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.household_invites
  where expires_at < now() - interval '30 days'
     or used_at < now() - interval '30 days';

  delete from auth.users
  where email_confirmed_at is null
    and phone_confirmed_at is null
    and last_sign_in_at is null
    and created_at < now() - interval '7 days';
end;
$$;
revoke execute on function private.purge_stale_data() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Scheduling under an existing name replaces that job.
    perform cron.schedule('larder-retention', '23 3 * * *', 'select private.purge_stale_data()');
  end if;
end;
$$;

-- 8. Account deletion -------------------------------------------------------------------------------
-- Deleting an auth.users row must: delete memberships and push subscriptions (cascade), keep the
-- household's records and invites but forget who wrote them (set null), and let the last member
-- out delete the household (after_member_removed). Re-assert the set-null keys in case the
-- earlier hardening migration didn't run here.

do $$
declare
  fk record;
begin
  for fk in
    select * from (values
      ('households', 'created_by', 'households_created_by_fkey'),
      ('household_invites', 'created_by', 'household_invites_created_by_fkey'),
      ('household_records', 'updated_by', 'household_records_updated_by_fkey')
    ) as t (tbl, col, conname)
  loop
    if not exists (
      select 1 from pg_constraint c
      where c.conname = fk.conname and c.conrelid = ('public.' || fk.tbl)::regclass and c.confdeltype = 'n'
    ) then
      execute format('alter table public.%I alter column %I drop not null', fk.tbl, fk.col);
      execute format('alter table public.%I drop constraint if exists %I', fk.tbl, fk.conname);
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references auth.users (id) on delete set null',
        fk.tbl, fk.conname, fk.col
      );
    end if;
  end loop;

  for fk in
    select * from (values
      ('household_members', 'user_id', 'household_members_user_id_fkey'),
      ('push_subscriptions', 'user_id', 'push_subscriptions_user_id_fkey')
    ) as t (tbl, col, conname)
  loop
    if not exists (
      select 1 from pg_constraint c
      where c.conname = fk.conname and c.conrelid = ('public.' || fk.tbl)::regclass and c.confdeltype = 'c'
    ) then
      execute format('alter table public.%I drop constraint if exists %I', fk.tbl, fk.conname);
      execute format(
        'alter table public.%I add constraint %I foreign key (%I) references auth.users (id) on delete cascade',
        fk.tbl, fk.conname, fk.col
      );
    end if;
  end loop;
end;
$$;
