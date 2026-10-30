-- Larder: households, membership, invites and synced records.
-- The app is local-first; every collection in the client store (items, events, list, ...)
-- syncs as rows in household_records, one row per record, last write wins.

create extension if not exists pgcrypto with schema extensions;

-- Households -----------------------------------------------------------------

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My household' check (char_length(name) between 1 and 80),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  display_name text check (char_length(display_name) <= 60),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_idx on public.household_members (user_id);

create table public.household_invites (
  token text primary key default encode(extensions.gen_random_bytes(12), 'hex'),
  household_id uuid not null references public.households (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  revoked boolean not null default false
);
create index household_invites_household_idx on public.household_invites (household_id);

-- Synced records -------------------------------------------------------------

create sequence public.household_records_seq;

create table public.household_records (
  household_id uuid not null references public.households (id) on delete cascade,
  collection text not null check (collection in (
    'items', 'events', 'locations', 'overrides', 'profile', 'savedRecipes', 'shoppingList', 'mealPlan'
  )),
  id text not null check (char_length(id) <= 100),
  data jsonb,
  deleted boolean not null default false,
  -- Monotonic change counter, set by trigger; clients pull "everything after seq N".
  seq bigint not null default nextval('public.household_records_seq'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  primary key (household_id, collection, id),
  check (pg_column_size(data) <= 65536)
);
create index household_records_pull_idx on public.household_records (household_id, seq);
grant usage on sequence public.household_records_seq to authenticated;

create or replace function public.household_records_touch()
returns trigger
language plpgsql
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

create trigger household_records_touch
before insert or update on public.household_records
for each row execute function public.household_records_touch();

-- Membership helper (security definer so policies don't recurse) ---------------

create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_household_owner(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hid and m.user_id = (select auth.uid()) and m.role = 'owner'
  );
$$;

-- Row-level security -----------------------------------------------------------

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;
alter table public.household_records enable row level security;

create policy "Members can see their household"
  on public.households for select to authenticated
  using (public.is_household_member(id));

create policy "Owners can rename their household"
  on public.households for update to authenticated
  using (public.is_household_owner(id))
  with check (public.is_household_owner(id));

create policy "Members can see fellow members"
  on public.household_members for select to authenticated
  using (public.is_household_member(household_id));

create policy "Members can update their own display name"
  on public.household_members for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Members can leave; owners can remove members"
  on public.household_members for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_household_owner(household_id));

create policy "Members can see their household's invites"
  on public.household_invites for select to authenticated
  using (public.is_household_member(household_id));

create policy "Members can revoke invites"
  on public.household_invites for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy "Members read household records"
  on public.household_records for select to authenticated
  using (public.is_household_member(household_id));

create policy "Members add household records"
  on public.household_records for insert to authenticated
  with check (public.is_household_member(household_id));

create policy "Members change household records"
  on public.household_records for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- Rows are soft-deleted (deleted = true) so other devices learn about removals; no hard delete policy.

-- RPCs ---------------------------------------------------------------------------

-- Create a household and make the caller its owner.
create or replace function public.create_household(household_name text default 'My household', member_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  hid uuid;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  insert into public.households (name, created_by)
  values (coalesce(nullif(trim(household_name), ''), 'My household'), uid)
  returning id into hid;
  insert into public.household_members (household_id, user_id, role, display_name)
  values (hid, uid, 'owner', nullif(trim(member_name), ''));
  return hid;
end;
$$;

-- Create an invite link token for a household the caller belongs to.
create or replace function public.create_household_invite(hid uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t text;
begin
  if not public.is_household_member(hid) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  insert into public.household_invites (household_id, created_by)
  values (hid, (select auth.uid()))
  returning token into t;
  return t;
end;
$$;

-- Look up an invite before joining (household name only), without exposing other data.
create or replace function public.peek_household_invite(invite_token text)
returns table (household_id uuid, household_name text, expired boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select h.id, h.name, (i.revoked or i.expires_at < now())
  from public.household_invites i
  join public.households h on h.id = i.household_id
  where i.token = invite_token;
$$;

-- Join a household with a valid invite token. Returns the household id.
create or replace function public.join_household(invite_token text, member_name text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  inv public.household_invites;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  select * into inv from public.household_invites where token = invite_token;
  if not found or inv.revoked or inv.expires_at < now() then
    raise exception 'This invite link has expired or is not valid' using errcode = 'P0002';
  end if;
  insert into public.household_members (household_id, user_id, role, display_name)
  values (inv.household_id, uid, 'member', nullif(trim(member_name), ''))
  on conflict (household_id, user_id) do nothing;
  return inv.household_id;
end;
$$;

revoke execute on function public.create_household(text, text) from public, anon;
revoke execute on function public.create_household_invite(uuid) from public, anon;
revoke execute on function public.peek_household_invite(text) from public, anon;
revoke execute on function public.join_household(text, text) from public, anon;
revoke execute on function public.is_household_member(uuid) from public, anon;
revoke execute on function public.is_household_owner(uuid) from public, anon;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.create_household_invite(uuid) to authenticated;
grant execute on function public.peek_household_invite(text) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.is_household_owner(uuid) to authenticated;

-- Live updates between devices.
alter publication supabase_realtime add table public.household_records;
