-- Daily AI allowance per signed-in user (photo reading, smart text reading, recipe ideas and
-- recipe import). The server counts each AI call with consume_ai_call, using the service-role
-- key; nobody else can read or write these rows. Days are Sydney calendar days.

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  calls integer not null default 0 check (calls >= 0),
  primary key (user_id, day)
);

alter table public.ai_usage enable row level security;
-- No policies: anon and authenticated get nothing. The service role bypasses RLS.
revoke all on table public.ai_usage from public, anon, authenticated;

-- Count one AI call for `uid` today. True when it fits within `daily_limit` (and is counted),
-- false when today's allowance is used up (nothing is counted). Atomic: the row lock taken by
-- the upsert means two calls at once can't both squeeze past the limit.
-- Rows older than 30 days are purged now and then (about 1 call in 50).
create or replace function public.consume_ai_call(uid uuid, daily_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Australia/Sydney')::date;
  used integer;
begin
  if uid is null or daily_limit is null or daily_limit < 1 then
    return false;
  end if;

  insert into public.ai_usage as u (user_id, day, calls)
  values (uid, today, 1)
  on conflict (user_id, day) do update
    set calls = u.calls + 1
    where u.calls < daily_limit
  returning u.calls into used;

  if random() < 0.02 then
    delete from public.ai_usage where day < today - 30;
  end if;

  -- No row comes back when the conflict update's WHERE fails, i.e. the limit is reached.
  return used is not null;
end;
$$;

revoke all on function public.consume_ai_call(uuid, integer) from public, anon, authenticated;
grant execute on function public.consume_ai_call(uuid, integer) to service_role;
