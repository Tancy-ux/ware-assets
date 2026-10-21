-- Which network (connection) each chat came from, so the Chats page can
-- show "same network as 3 other chats" and tell one person starting chat
-- after chat from many different people. Never the IP itself: ask-faq
-- stores a keyed hash of it (12 characters), and chat-admin clears it
-- from chats quiet for 30 days. Mobile networks share IPs between many
-- people, so it's a hint, not proof. Safe to run more than once.
alter table public.chat_conversations
  add column if not exists network_id text;

create index if not exists chat_conversations_network_idx
  on public.chat_conversations (network_id)
  where network_id is not null;

-- Where the visit came from ("Glance", "Google Display ad", "Instagram /
-- Facebook ad", "Google search", "Direct"…) and its ad campaign, from the
-- site before ours and the landing page's tags (ask-faq's cameFrom). The
-- latest visit's, so a returning shopper shows where they came from this
-- time. Chats from before this stay empty.
alter table public.chat_conversations
  add column if not exists came_from text,
  add column if not exists came_from_campaign text;

-- Let the API see the new columns straight away.
notify pgrst, 'reload schema';
