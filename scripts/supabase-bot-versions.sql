-- Version history for the bot's instructions (the Chats page's Bot section,
-- owner login only). Every publish saves the whole set of rules here, so
-- any earlier version can be looked at and brought back.
-- The live rules themselves stay in public.ai_guidelines.
-- Only the chat-admin function (service role) reads or writes this table:
-- row level security is on with no policies, so the public key can't.
-- Safe to run more than once.
create table if not exists public.ai_guidelines_versions (
  id uuid primary key default gen_random_uuid(),
  -- [{ "rule": "...", "enabled": true }, ...] as published
  rules jsonb not null default '[]'::jsonb,
  -- What changed, e.g. "Added 1, changed 2"
  note text,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists ai_guidelines_versions_created_at
  on public.ai_guidelines_versions (created_at desc);

alter table public.ai_guidelines_versions enable row level security;
