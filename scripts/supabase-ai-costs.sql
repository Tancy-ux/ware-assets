-- What each AI call cost: one row per Gemini call, written by the ask-faq
-- and chat-admin functions (service role only; nobody else can read it).
-- The Chats page's Stats → AI cost tab (owner only) adds it up, split into
-- real customers, test / internal chats and the team's own AI tools.
-- Calls from before this was run aren't counted. Safe to run more than once.
create table if not exists public.ai_costs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- "reply" (a shopper's typed question), "team-ai-reply" (AI reply on the
  -- Chats page), "lead-draft", "bot-try" (Bot page Try), "tidy" (Improve AI)
  kind text not null,
  model text,
  conversation_id uuid,
  prompt_tokens integer not null default 0,
  -- Part of the prompt Gemini had cached (charged at a lower rate).
  cached_tokens integer not null default 0,
  reply_tokens integer not null default 0,
  thinking_tokens integer not null default 0
);

create index if not exists ai_costs_created_at on public.ai_costs (created_at);

-- Row level security on with no policies: only the functions (service
-- role) can read or write it.
alter table public.ai_costs enable row level security;
