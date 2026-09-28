-- Run in the Supabase SQL editor (Project > SQL Editor > New query) for the
-- "ware-assets" project. Safe to re-run — every statement is idempotent.
--
-- 1. Team-only writes. Until now anyone holding the public anon key (it's
--    in the site's JavaScript) could add, edit or delete FAQs, AI
--    guidelines, download links and uploaded assets, and the FAQs and
--    guidelines feed straight into what the store chatbot tells customers.
--    From here on, reading stays public (the site and the ask-faq function
--    need it), but writing needs a signed-in team account (Supabase >
--    Authentication > Users). The site's Login page signs in with one.
--
-- 2. Chatbot rate limits: counters the ask-faq function checks before each
--    AI reply, so a bot can't burn through the Gemini quota (or, once
--    billing is on, the bill). Only the function (service role) can use them.

-- ---------- 1. Team-only writes ----------

-- faqs: readable by everyone, signed in or not.
drop policy if exists "faqs are publicly readable" on public.faqs;
create policy "faqs are publicly readable"
  on public.faqs for select
  to anon, authenticated
  using (true);

drop policy if exists "anyone can add a faq" on public.faqs;
drop policy if exists "anyone can edit a faq" on public.faqs;
drop policy if exists "anyone can delete a faq" on public.faqs;

drop policy if exists "team can add a faq" on public.faqs;
create policy "team can add a faq"
  on public.faqs for insert
  to authenticated
  with check (true);

drop policy if exists "team can edit a faq" on public.faqs;
create policy "team can edit a faq"
  on public.faqs for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "team can delete a faq" on public.faqs;
create policy "team can delete a faq"
  on public.faqs for delete
  to authenticated
  using (true);

-- ai_guidelines: same.
drop policy if exists "guidelines are readable" on public.ai_guidelines;
create policy "guidelines are readable"
  on public.ai_guidelines for select
  to anon, authenticated
  using (true);

drop policy if exists "anyone can add a guideline" on public.ai_guidelines;
drop policy if exists "anyone can edit a guideline" on public.ai_guidelines;
drop policy if exists "anyone can delete a guideline" on public.ai_guidelines;

drop policy if exists "team can add a guideline" on public.ai_guidelines;
create policy "team can add a guideline"
  on public.ai_guidelines for insert
  to authenticated
  with check (true);

drop policy if exists "team can edit a guideline" on public.ai_guidelines;
create policy "team can edit a guideline"
  on public.ai_guidelines for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "team can delete a guideline" on public.ai_guidelines;
create policy "team can delete a guideline"
  on public.ai_guidelines for delete
  to authenticated
  using (true);

-- download_assets: its existing read policy (anon) stays; signed-in team
-- members need their own, since they no longer count as anon.
drop policy if exists "team can read download assets" on public.download_assets;
create policy "team can read download assets"
  on public.download_assets for select
  to authenticated
  using (true);

drop policy if exists "anyone can add a download asset" on public.download_assets;
drop policy if exists "team can add a download asset" on public.download_assets;
create policy "team can add a download asset"
  on public.download_assets for insert
  to authenticated
  with check (true);

-- The "assets" storage bucket (Brand assets uploads). Its policies were
-- made in the dashboard, so their names aren't known here: drop any that
-- let signed-out visitors write to this bucket, then add team-only ones.
do $$
declare
  p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and (roles && array['anon', 'public']::name[])
      and coalesce(qual, '') || coalesce(with_check, '') like '%assets%'
  loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;

-- Reading stays open to everyone, as before (a dropped policy above may
-- have covered reads too, if it was an "all operations" one).
drop policy if exists "team can read assets" on storage.objects;
drop policy if exists "anyone can read assets" on storage.objects;
create policy "anyone can read assets"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'assets');

drop policy if exists "team can upload assets" on storage.objects;
create policy "team can upload assets"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'assets');

-- ---------- 2. Chatbot rate limits ----------

-- One row per key per time window: "v:<visitor id>", "ip:<address>" or
-- "all" (every AI reply, site-wide), each for a 10-minute or 1-day window.
create table if not exists public.ai_usage (
  key text not null,
  window_kind text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (key, window_kind, window_start)
);

-- No policies: only the service role (the ask-faq function) touches it.
alter table public.ai_usage enable row level security;

-- Counts one AI request and says whether it's allowed:
--   'ok'     go ahead
--   'person' this visitor / connection has sent too many
--   'global' the site-wide daily cap on AI replies is reached
-- The limits come from the function, so tuning them is a code change.
create or replace function public.ai_rate_check(
  p_visitor text,
  p_ip text,
  p_visitor_10m integer,
  p_visitor_day integer,
  p_ip_10m integer,
  p_ip_day integer,
  p_global_day integer
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  t10 timestamptz := date_bin('10 minutes', now(), timestamptz '2000-01-01');
  tday timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata')
    at time zone 'Asia/Kolkata';
  n integer;
  over boolean := false;
begin
  if p_visitor is not null and p_visitor <> '' then
    insert into ai_usage as u (key, window_kind, window_start, count)
      values ('v:' || p_visitor, '10m', t10, 1)
      on conflict (key, window_kind, window_start)
      do update set count = u.count + 1
      returning count into n;
    over := over or n > p_visitor_10m;

    insert into ai_usage as u (key, window_kind, window_start, count)
      values ('v:' || p_visitor, 'day', tday, 1)
      on conflict (key, window_kind, window_start)
      do update set count = u.count + 1
      returning count into n;
    over := over or n > p_visitor_day;
  end if;

  if p_ip is not null and p_ip <> '' then
    insert into ai_usage as u (key, window_kind, window_start, count)
      values ('ip:' || p_ip, '10m', t10, 1)
      on conflict (key, window_kind, window_start)
      do update set count = u.count + 1
      returning count into n;
    over := over or n > p_ip_10m;

    insert into ai_usage as u (key, window_kind, window_start, count)
      values ('ip:' || p_ip, 'day', tday, 1)
      on conflict (key, window_kind, window_start)
      do update set count = u.count + 1
      returning count into n;
    over := over or n > p_ip_day;
  end if;

  if over then
    return 'person';
  end if;

  -- Only requests that get this far count towards the site-wide cap, so a
  -- blocked bot can't use it up for everyone else.
  insert into ai_usage as u (key, window_kind, window_start, count)
    values ('all', 'day', tday, 1)
    on conflict (key, window_kind, window_start)
    do update set count = u.count + 1
    returning count into n;
  if n > p_global_day then
    return 'global';
  end if;

  -- Now and then, clear out windows that are long over.
  if random() < 0.01 then
    delete from ai_usage where window_start < now() - interval '3 days';
  end if;

  return 'ok';
end;
$$;

revoke all on function public.ai_rate_check(text, text, integer, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.ai_rate_check(text, text, integer, integer, integer, integer, integer)
  to service_role;
