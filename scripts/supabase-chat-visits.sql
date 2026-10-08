-- Run in the Supabase SQL editor (Project > SQL Editor > New query) for the
-- "ware-assets" project. Safe to re-run.
--
-- Stats -> Journeys: where people go on the store after tapping the chat
-- button. Only shoppers who tapped it (for 30 days after their last tap,
-- see widget/src/track.js); nobody else is recorded. One row per event:
--   open      tapped the chat button (page = where they tapped it)
--   page      opened a store page
--   cart      added something to their cart
--   checkout  tapped a checkout / Buy it now button
-- Paths only ("/products/lilo-cup"), never the full address or its query.
-- Written by ask-faq ("visit"), read by chat-admin ("journeys"), both with
-- the service role; the public can't read or write it.

create table if not exists public.chat_visits (
  id bigint generated always as identity primary key,
  visitor_id uuid not null,
  kind text not null check (kind in ('open', 'page', 'cart', 'checkout')),
  page text,
  cart_count integer,   -- items in their cart, when known
  cart_total integer,   -- in paise, as Shopify's /cart.js gives it
  device text,
  internal boolean not null default false,  -- the team's own site / local tests
  at timestamptz not null default now()
);

create index if not exists chat_visits_at_idx on public.chat_visits (at);
create index if not exists chat_visits_visitor_idx on public.chat_visits (visitor_id, at);

alter table public.chat_visits enable row level security;
revoke all on public.chat_visits from anon, authenticated;

-- Let the API see the new table straight away.
notify pgrst, 'reload schema';
