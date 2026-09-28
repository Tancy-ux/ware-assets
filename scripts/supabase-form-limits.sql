-- Run in the Supabase SQL editor (Project > SQL Editor > New query) for the
-- "ware-assets" project, after supabase-security.sql. Safe to re-run.
--
-- A general-purpose limiter on the same counters table (ai_usage), for
-- things that aren't AI replies: Chats login attempts, and the chat's name /
-- phone forms (so a script can't fill the Chats page with fake leads).
-- Unlike ai_rate_check, it never touches the site-wide AI reply count.

-- Counts one attempt for p_key; true while it's within both limits.
create or replace function public.rate_limit(
  p_key text,
  p_per_10m integer,
  p_per_day integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  t10 timestamptz := date_bin('10 minutes', now(), timestamptz '2000-01-01');
  tday timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata')
    at time zone 'Asia/Kolkata';
  n10 integer;
  nday integer;
begin
  insert into ai_usage as u (key, window_kind, window_start, count)
    values (p_key, '10m', t10, 1)
    on conflict (key, window_kind, window_start)
    do update set count = u.count + 1
    returning count into n10;

  insert into ai_usage as u (key, window_kind, window_start, count)
    values (p_key, 'day', tday, 1)
    on conflict (key, window_kind, window_start)
    do update set count = u.count + 1
    returning count into nday;

  return n10 <= p_per_10m and nday <= p_per_day;
end;
$$;

revoke all on function public.rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.rate_limit(text, integer, integer)
  to service_role;
