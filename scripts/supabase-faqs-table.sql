-- Run in the Supabase SQL editor (Project > SQL Editor > New query) for the
-- "ware-assets" project. Safe to re-run — every statement is idempotent.
--
-- This is the full table definition, including the columns needed for
-- in-place editing (doc_key, updated_at) and the update policy that lets
-- the site save edits. If you already ran an earlier version of this file,
-- re-running the whole thing is fine.

create table if not exists public.faqs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  category text not null default 'General',
  internal boolean not null default false,
  created_at timestamptz not null default now()
);

-- doc_key identifies a question that originated from a Word doc, so
-- re-parsing the same doc never creates a duplicate or overwrites an edit
-- you made on the site. Site-added questions leave it null.
alter table public.faqs add column if not exists doc_key text;
alter table public.faqs add column if not exists updated_at timestamptz not null default now();

-- Plain (non-partial) unique index: Postgres treats NULL as distinct from
-- NULL, so this still allows unlimited site-added rows with doc_key = null
-- while enforcing uniqueness among the non-null (doc-derived) values. A
-- partial index (`where doc_key is not null`) looks equivalent but Postgres's
-- ON CONFLICT resolution can't match it, so it has to be this form.
drop index if exists faqs_doc_key_key;
create unique index faqs_doc_key_key on public.faqs (doc_key);

alter table public.faqs enable row level security;

-- The site uses the public anon key (same as the "assets" storage bucket),
-- so read, insert, and update all need to be allowed for the anon role.
drop policy if exists "faqs are publicly readable" on public.faqs;
create policy "faqs are publicly readable"
  on public.faqs for select
  to anon
  using (true);

drop policy if exists "anyone can add a faq" on public.faqs;
create policy "anyone can add a faq"
  on public.faqs for insert
  to anon
  with check (true);

drop policy if exists "anyone can edit a faq" on public.faqs;
create policy "anyone can edit a faq"
  on public.faqs for update
  to anon
  using (true)
  with check (true);

drop policy if exists "anyone can delete a faq" on public.faqs;
create policy "anyone can delete a faq"
  on public.faqs for delete
  to anon
  using (true);
