-- What the store chat showed under each AI reply besides its text and
-- product cards: catalogue links, the map link, the WhatsApp button, the
-- name / number form, the designer-call buttons, gift packaging photos.
-- The Chats page shows the same under the reply, so the team sees what the
-- shopper saw. Empty for older messages. Safe to run more than once.
alter table public.chat_messages
  add column if not exists extras jsonb;
