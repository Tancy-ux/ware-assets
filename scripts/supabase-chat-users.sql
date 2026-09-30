-- Team logins for the Chats page, each with its own permissions (managed
-- from the Chats page's Team section by the owner or anyone allowed to).
-- The owner login stays the CHATS_USERNAME / CHATS_PASSWORD secrets.
-- Only the chat-admin function (service role) reads or writes this table:
-- row level security is on with no policies, so the public key can't.
-- Safe to run more than once.
create table if not exists public.chat_users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  name text,
  -- "pbkdf2$<iterations>$<salt>$<hash>", never the password itself
  password_hash text not null,
  -- { "contacts": true, "reply": true, "edit": true, "zoho": false, ... }
  permissions jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create unique index if not exists chat_users_username_key
  on public.chat_users (lower(username));

alter table public.chat_users enable row level security;

-- Who sent each team reply ("Tani"), shown to the shopper and in the
-- Chats page. Empty for the owner login and for replies before this.
alter table public.chat_messages
  add column if not exists agent_name text;

-- Sign in with Google: each team member is their @wareinnovations.com
-- email (no passwords any more). Older password logins keep their row but
-- need an email added in the Team section before they can sign in.
alter table public.chat_users
  add column if not exists email text;
alter table public.chat_users
  alter column password_hash drop not null;
create unique index if not exists chat_users_email_key
  on public.chat_users (lower(email));
