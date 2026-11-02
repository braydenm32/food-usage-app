-- Background reminders: one row per device that has allowed push notifications.
-- Each row carries the reminder preferences for that device (they live in device settings,
-- not in the synced household data), so the hourly sender knows when to send in which zone.
-- Rows are written by the save_push_subscription RPC and read by the sender with the
-- service-role key (which bypasses RLS). Users can see and delete only their own rows.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) between 40 and 200),
  auth text not null check (char_length(auth) between 16 and 64),
  cadence text not null default 'daily' check (cadence in ('daily', 'weekly')),
  hour smallint not null default 17 check (hour between 0 and 23),
  weekday smallint not null default 0 check (weekday between 0 and 6),
  time_zone text not null default 'Australia/Sydney' check (char_length(time_zone) between 1 and 64),
  use_soon_days smallint not null default 2 check (use_soon_days between 0 and 14),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sent_at timestamptz,
  -- Last "Send a test reminder", for a short per-device cooldown.
  last_test_at timestamptz,
  -- Consecutive delivery failures; the sender drops a row after too many.
  failures smallint not null default 0
);
-- Only the real browser push services, so the sender never posts anywhere else (SSRF).
-- The sender checks the same list again before every send (src/lib/push/endpoint.ts).
create or replace function private.is_push_service_endpoint(endpoint text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    (
      select h = any (array['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'])
        or h ~ '^[a-z0-9.-]+\.(push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)$'
      from (select lower(substring(endpoint from '^https://([^/?#:@]+)(?:[/?#]|$)')) as h) as parsed
    ),
    false
  );
$$;
revoke execute on function private.is_push_service_endpoint(text) from public, anon, authenticated;

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
create index push_subscriptions_household_idx on public.push_subscriptions (household_id);

alter table public.push_subscriptions enable row level security;

create policy "Users see their own push subscriptions"
  on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Users remove their own push subscriptions"
  on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- No insert/update policies: writes go through the RPC below, which checks membership and
-- takes over an endpoint another account on the same browser used before.

-- Save (or update) this device's subscription and reminder preferences.
create or replace function public.save_push_subscription(
  hid uuid,
  sub_endpoint text,
  sub_p256dh text,
  sub_auth text,
  sub_cadence text,
  sub_hour int,
  sub_time_zone text,
  sub_use_soon_days int default 2,
  sub_weekday int default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  sid uuid;
begin
  if uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if not private.is_household_member(hid) then
    raise exception 'Not a member of this household' using errcode = '42501';
  end if;
  if not private.is_push_service_endpoint(sub_endpoint) then
    raise exception 'Not a browser push service' using errcode = '22023';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = sub_time_zone) then
    raise exception 'Unknown time zone' using errcode = '22023';
  end if;
  if (select count(*) from public.push_subscriptions where user_id = uid and endpoint <> sub_endpoint) >= 10 then
    raise exception 'Too many devices with reminders' using errcode = '54000';
  end if;

  insert into public.push_subscriptions as s
    (user_id, household_id, endpoint, p256dh, auth, cadence, hour, weekday, time_zone, use_soon_days)
  values
    (uid, hid, sub_endpoint, sub_p256dh, sub_auth, sub_cadence, sub_hour, sub_weekday, sub_time_zone, sub_use_soon_days)
  on conflict (endpoint) do update set
    user_id = excluded.user_id,
    household_id = excluded.household_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    cadence = excluded.cadence,
    hour = excluded.hour,
    weekday = excluded.weekday,
    time_zone = excluded.time_zone,
    use_soon_days = excluded.use_soon_days,
    failures = 0,
    updated_at = now(),
    -- A different account or household on this browser starts afresh.
    last_sent_at = case
      when s.user_id = excluded.user_id and s.household_id = excluded.household_id then s.last_sent_at
      else null
    end,
    created_at = case
      when s.user_id = excluded.user_id and s.household_id = excluded.household_id then s.created_at
      else now()
    end
  returning id into sid;
  return sid;
end;
$$;

revoke execute on function public.save_push_subscription(uuid, text, text, text, text, int, text, int, int) from public, anon;
grant execute on function public.save_push_subscription(uuid, text, text, text, text, int, text, int, int) to authenticated;

-- Leaving a household stops its reminders on that member's devices.
create or replace function private.after_member_removed_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.push_subscriptions
  where household_id = old.household_id and user_id = old.user_id;
  return old;
end;
$$;

create trigger household_members_after_delete_push
after delete on public.household_members
for each row execute function private.after_member_removed_push();

revoke execute on function private.after_member_removed_push() from public, anon, authenticated;
