-- A logged-in store customer's account on their chat: the ware-chat snippet
-- passes their first name, phone and email (whatever the account has) and
-- Shopify customer ID. The chat knows their name; the phone and email are
-- for the team only (Chats side panel, lead card), never said to them.
-- Safe to run more than once.
alter table public.chat_conversations
  add column if not exists account_name text,
  add column if not exists account_phone text,
  add column if not exists account_email text,
  add column if not exists shopify_customer_id text;
