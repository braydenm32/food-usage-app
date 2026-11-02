-- Membership helpers live in a schema the API does not expose, so they can't be called as RPCs.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

alter function public.is_household_member(uuid) set schema private;
alter function public.is_household_owner(uuid) set schema private;

create or replace function public.create_household_invite(hid uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t text;
begin
  if not private.is_household_member(hid) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  insert into public.household_invites (household_id, created_by)
  values (hid, (select auth.uid()))
  returning token into t;
  return t;
end;
$$;

create index household_invites_created_by_idx on public.household_invites (created_by);
create index household_records_updated_by_idx on public.household_records (updated_by);
create index households_created_by_idx on public.households (created_by);
