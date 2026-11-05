-- "Track my order" replies with no order to show (logged out, or none on
-- the account) were saved as failures: a false "the chat couldn't reach us"
-- in Chats, counted in "not answered" and the bot's "didn't know" list.
-- They're how that reply is meant to go. Safe to run more than once.
update public.chat_messages
set extras = '["whatsapp_offer"]'::jsonb
where extras @> '["not_answered:offline"]'::jsonb
  and (
    answer like 'Log in to see your orders and their tracking.%'
    or answer like 'I can''t see any orders on your account yet.%'
  );
