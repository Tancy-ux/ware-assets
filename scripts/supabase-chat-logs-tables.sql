-- Run in the Supabase SQL editor (Project > SQL Editor > New query) for the
-- "ware-assets" project. Safe to re-run — every statement is idempotent.
--
-- Every Ask AI conversation, for reviewing in the site's Chats page.
-- Written by the ask-faq function and read by the chat-admin function,
-- both using the service role key. There are deliberately NO policies for
-- the anon role: chats can hold names, companies and contact details, so
-- the public site key can neither read nor write these tables.

create table if not exists public.chat_conversations (
  -- Generated in the browser; a new one starts after "reset", clearing
  -- the chat, or 30 hours of inactivity.
  id uuid primary key,
  -- One per browser (kept in localStorage), so several conversations from
  -- the same person group together.
  visitor_id uuid not null,
  -- Picked up by the AI when the person mentions them in the chat.
  visitor_name text,
  company text,
  -- Set by the team in the Chats page, overrides the name in the list.
  label text,
  first_question text,
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

-- The most recent question, shown as the preview in the Chats list.
-- (Added after the table first shipped, hence the separate statement.)
alter table public.chat_conversations
  add column if not exists last_question text;

-- Phone number from the chat's "leave your details" card.
alter table public.chat_conversations
  add column if not exists visitor_phone text;

-- Human takeover: set when a team member clicks "Take over" in the Chats
-- page (the AI stops answering), cleared on "Hand back to AI". Expires by
-- itself after 24 hours.
alter table public.chat_conversations
  add column if not exists takeover_at timestamptz;

-- Who wrote each chat_messages row:
--   'ai'       — a customer question + the AI's answer (the usual pair)
--   'customer' — a customer message during a takeover (answer is empty)
--   'agent'    — a team member's reply during a takeover (question is empty)
alter table public.chat_messages
  add column if not exists sender text not null default 'ai';

create index if not exists chat_conversations_last_message_idx
  on public.chat_conversations (last_message_at desc);
create index if not exists chat_conversations_visitor_idx
  on public.chat_conversations (visitor_id);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.chat_conversations (id) on delete cascade,
  question text not null,
  answer text not null,
  -- The product cards shown under the answer: [{ title, url, available }]
  products jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_conversation_idx
  on public.chat_messages (conversation_id, created_at);

alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;
-- (No policies on purpose — see the note at the top.)
