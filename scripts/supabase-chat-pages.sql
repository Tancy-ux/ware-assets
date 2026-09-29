-- Run in the Supabase SQL editor (Project > SQL Editor > New query) for the
-- "ware-assets" project. Safe to re-run.
--
-- Which store page each chat came from, for the Chats page:
--   chat_conversations.first_page  the page they started chatting on
--   chat_conversations.last_page   the page of their latest message
--   chat_messages.page             the page each message was sent from
-- Paths only ("/products/lilo-cup"), never the full address or its query.

alter table public.chat_conversations
  add column if not exists first_page text,
  add column if not exists last_page text;

alter table public.chat_messages
  add column if not exists page text;

-- Let the API see the new columns straight away.
notify pgrst, 'reload schema';
