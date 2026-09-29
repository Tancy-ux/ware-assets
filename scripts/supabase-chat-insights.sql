-- Chats page side panel: what each chat is about and what we know of the
-- visitor right now. Safe to run more than once.
--   topic     "Asking how to order" (the AI's few words, updated each reply)
--   interest  hot | warm | cold (the AI's read of how keen they are)
--   device    "Mobile · Chrome · Android" (from the browser)
--   cart      "2 items · ₹3,400" or "Empty" (the store cart when they last wrote)
alter table public.chat_conversations
  add column if not exists topic text,
  add column if not exists interest text,
  add column if not exists device text,
  add column if not exists cart text;
