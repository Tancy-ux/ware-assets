-- Run in the Supabase SQL editor (Project > SQL Editor > New query) for the
-- "ware-assets" project. Safe to re-run.
--
-- What the Chats page's "Lead" card keeps for each chat, for creating a
-- lead in Zoho CRM:
--   visitor_email   typed in the chat (the phone is visitor_phone already)
--   requirement     short summary of what they want (drafted or typed)
--   lead_products   the pieces they asked about
--   client_type     Zoho's "Type of Client" (Retail, HoReCa...), picked by hand
--   zoho_lead_id    the Zoho lead made from this chat (so it isn't made twice)
--   zoho_lead_at    when

alter table public.chat_conversations
  add column if not exists visitor_email text,
  add column if not exists requirement text,
  add column if not exists lead_products text,
  add column if not exists client_type text,
  add column if not exists zoho_lead_id text,
  add column if not exists zoho_lead_at timestamptz;

-- Let the API see the new columns straight away.
notify pgrst, 'reload schema';
