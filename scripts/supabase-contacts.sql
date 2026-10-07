-- Run in the Supabase SQL editor (Project > SQL Editor > New query) for the
-- "ware-assets" project. Safe to re-run.
--
-- What the Chats page's Contacts list keeps for each person, set on all of
-- their chats:
--   zoho_skip_at      "Don't send now": when (they come back to "Not in
--                     Zoho" if they chat again)
--   zoho_skip_by      who (the team member's name)
--   zoho_skip_until   snoozed until this time (empty: until they chat again)
--   zoho_lead_by      who sent them to Zoho
--   contact_note      the team's note on the person ("called, wants a quote")
--   contact_note_by   who wrote it
--   contact_note_at   when

alter table public.chat_conversations
  add column if not exists zoho_skip_at timestamptz,
  add column if not exists zoho_skip_by text,
  add column if not exists zoho_skip_until timestamptz,
  add column if not exists zoho_lead_by text,
  add column if not exists contact_note text,
  add column if not exists contact_note_by text,
  add column if not exists contact_note_at timestamptz;

-- Let the API see the new columns straight away.
notify pgrst, 'reload schema';
