-- Where each chat came from: "store" (a visitor on wareinnovations.com) or
-- "internal" (the Ask AI button on the team's own site, or a local test).
-- The Chats page shows internal ones only under "Internal", and Stats
-- leaves them out with the test chats. Chats from before this stay empty
-- (counted as store). Safe to run more than once.
alter table public.chat_conversations
  add column if not exists source text;
