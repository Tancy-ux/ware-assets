-- Auto-pause for junk: after 3 junk messages in a chat (keyboard mash,
-- bursts, gibberish the AI flagged), ask-faq stops answering it until the
-- team presses "Hand back to AI" on the Chats page. Added 18 Oct 2026.
-- Safe to run more than once. Until it's run, nothing is paused.

alter table public.chat_conversations
  -- When the AI was paused for junk (null = not paused). Unlike a manual
  -- takeover it doesn't run out after 24 hours or end on "reset".
  add column if not exists ai_paused_at timestamptz,
  -- When the team last handed back: only junk after this counts again.
  add column if not exists ai_resumed_at timestamptz;
