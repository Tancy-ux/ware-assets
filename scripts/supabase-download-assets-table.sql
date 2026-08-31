-- Run in the Supabase SQL editor (Project > SQL Editor > New query) for the
-- "ware-assets" project. Safe to re-run — every statement is idempotent.
--
-- Adds the insert policy the site's new "Add link" form on the Brand
-- Assets section needs. The table already exists with RLS enabled and a
-- working select policy (that's how the page already lists links); this
-- just adds the missing write permission for the anon role, same pattern
-- as the faqs table.

alter table public.download_assets enable row level security;

drop policy if exists "anyone can add a download asset" on public.download_assets;
create policy "anyone can add a download asset"
  on public.download_assets for insert
  to anon
  with check (true);
