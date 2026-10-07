-- Run in the Supabase SQL editor (Project > SQL Editor > New query) for the
-- "ware-assets" project. Safe to re-run.
--
-- WhatsApp messages for the Chats page's WhatsApp section, saved by the
-- whatsapp-hook function as Meta sends them (supabase/functions/whatsapp-hook).
-- No access for the site's public key: only the functions (service role)
-- read and write these.
--
--   wa_chats      one row per customer (their WhatsApp number)
--   wa_messages   every message: theirs ("in") and ours ("out"). Replies
--                 sent from another tool on the same number (TechMonk) only
--                 reach us as "sent / delivered / read", so those rows have
--                 no text.
--   whatsapp-media (storage bucket, private): photos, voice notes and
--                 files, copied from Meta when they arrive (Meta keeps them
--                 for 30 days only).

create table if not exists public.wa_chats (
  wa_id text primary key,            -- their WhatsApp number, digits only (919876543210)
  name text,                         -- their WhatsApp profile name
  business_phone text,               -- which of our numbers they wrote to
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  last_text text,                    -- for the list
  last_from text,                    -- customer | business
  unread integer not null default 0  -- their messages since the team last opened it
);

create table if not exists public.wa_messages (
  id text primary key,               -- Meta's message id (wamid…)
  wa_id text not null references public.wa_chats (wa_id) on delete cascade,
  direction text not null,           -- in | out
  type text not null,                -- text, image, audio, document, location, reaction…
  body text,                         -- the text, or a photo's caption
  media jsonb,                       -- { id, mime, filename, path } for photos / files
  status text,                       -- ours: sent | delivered | read | failed
  context_id text,                   -- the message it replies to
  sent_at timestamptz not null,
  raw jsonb,                         -- what Meta sent, as it was
  created_at timestamptz not null default now()
);

create index if not exists wa_messages_chat_time on public.wa_messages (wa_id, sent_at);
create index if not exists wa_chats_last on public.wa_chats (last_at desc);

alter table public.wa_chats enable row level security;
alter table public.wa_messages enable row level security;

insert into storage.buckets (id, name, public)
values ('whatsapp-media', 'whatsapp-media', false)
on conflict (id) do nothing;

-- Let the API see the new tables straight away.
notify pgrst, 'reload schema';
