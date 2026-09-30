-- Saved messages ("quick replies") for the Chats page's reply box. Each
-- login has its own list: owner_key is the team member's chat_users id, or
-- "owner" for the owner. Only the chat-admin function (service role) reads
-- or writes this table: row level security is on with no policies, so the
-- public key can't. Safe to run more than once.
create table if not exists public.chat_quick_replies (
  id uuid primary key default gen_random_uuid(),
  owner_key text not null,
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_quick_replies_owner
  on public.chat_quick_replies (owner_key, created_at);

alter table public.chat_quick_replies enable row level security;
