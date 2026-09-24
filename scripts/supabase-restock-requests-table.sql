-- Run in the Supabase SQL editor (Project > SQL Editor > New query) for the
-- "ware-assets" project. Safe to re-run — every statement is idempotent.
--
-- "Check restock" requests from the Ask AI chat: someone asked about a
-- sold-out product and left a way to reach them. The team reviews these
-- in the Supabase Table Editor and follows up.

create table if not exists public.restock_requests (
  id uuid primary key default gen_random_uuid(),
  product_title text not null,
  product_url text not null,
  name text,
  -- Phone number or email, as typed.
  contact text not null,
  message text,
  -- The team can move this along (e.g. contacted / restocked / closed).
  status text not null default 'new',
  created_at timestamptz not null default now()
);

alter table public.restock_requests enable row level security;

-- The site can only ADD requests. There is deliberately no select, update
-- or delete policy for anon: these rows hold customers' contact details,
-- so they're only visible from the Supabase dashboard.
drop policy if exists "anyone can request a restock check" on public.restock_requests;
create policy "anyone can request a restock check"
  on public.restock_requests for insert
  to anon
  with check (
    char_length(contact) between 3 and 200
    and char_length(product_title) <= 300
    and char_length(coalesce(name, '')) <= 100
    and char_length(coalesce(message, '')) <= 1000
    and status = 'new'
  );
