-- Run in the Supabase SQL editor (Project > SQL Editor > New query) for the
-- "ware-assets" project. Safe to re-run — every statement is idempotent.
--
-- Standing instructions for the Ask AI bot, managed from the "Improve AI"
-- panel in the chat drawer. Only what the team types there ends up here.
-- The ask-faq function reads the enabled rows into its prompt on every
-- question, so a switched-off rule stops applying immediately.

create table if not exists public.ai_guidelines (
  id uuid primary key default gen_random_uuid(),
  -- The tidied rule the AI actually follows.
  rule text not null,
  -- What was originally typed, kept for reference.
  original text,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_guidelines enable row level security;

-- Same access model as the faqs table: the site uses the public anon key.
drop policy if exists "guidelines are readable" on public.ai_guidelines;
create policy "guidelines are readable"
  on public.ai_guidelines for select
  to anon
  using (true);

drop policy if exists "anyone can add a guideline" on public.ai_guidelines;
create policy "anyone can add a guideline"
  on public.ai_guidelines for insert
  to anon
  with check (true);

drop policy if exists "anyone can edit a guideline" on public.ai_guidelines;
create policy "anyone can edit a guideline"
  on public.ai_guidelines for update
  to anon
  using (true)
  with check (true);

drop policy if exists "anyone can delete a guideline" on public.ai_guidelines;
create policy "anyone can delete a guideline"
  on public.ai_guidelines for delete
  to anon
  using (true);
