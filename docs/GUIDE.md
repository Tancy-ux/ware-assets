# ware-assets: the complete guide

Everything this repository does, how the pieces fit, where every setting
lives, and how to run, change and deploy it. Written for whoever maintains
it next (and as a reference for the team).

Last updated: 29 Sep 2026.

---

## 1. What this is

One repository, two products:

1. **The ware-assets site**: an internal team site for Ware Innovations.
   Brand assets (colours, fonts, logos, downloads), the FAQ knowledge base,
   and the **Chats** page where the team reads and manages customer chats.
   Live at **https://tancy-ux.github.io/ware-assets/**.
2. **The store chatbot ("Ware concierge")**: the AI chat on
   **www.wareinnovations.com** (Shopify store
   `ware-innovations-mumbai.myshopify.com`). It answers shoppers from the
   FAQs and the live product catalogue, recommends pieces, checks delivery
   by pincode, captures leads and hands off to the team on WhatsApp.

Behind both sits one **Supabase** project ("Brand Assets", ref
`lauvnmdepcdjxilglubn`, region ap-south-1): the database, file storage, team
logins, and two server functions (`ask-faq` and `chat-admin`).

```
 Shopper on wareinnovations.com                Team on tancy-ux.github.io/ware-assets
   │  ware-chat.js + ware-chat snippet            │  React site (GitHub Pages)
   │  (Shopify theme files)                       │
   ▼                                              ▼
 ┌──────────────── Supabase ("Brand Assets") ─────────────────────────────┐
 │  Edge function ask-faq ── Gemini (answers, drafts)                      │
 │    │                    ── Shopify storefront products.json (catalogue) │
 │    │                    ── Shopify Admin API (shipping zones)            │
 │    │                    ── India Post pincode API                       │
 │  Edge function chat-admin ── Shopify Admin API (orders, read-only)      │
 │    │                       ── Zoho CRM (leads, on a button click only)  │
 │    │                       ── Gemini ("Draft from chat")                │
 │  Postgres: faqs, ai_guidelines, chat_conversations, chat_messages,     │
 │            ai_usage, download_assets, (restock_requests: never created)│
 │  Storage: bucket "assets" (uploads/)   Auth: team accounts              │
 └────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Live addresses, accounts and where things are

| What | Where |
| --- | --- |
| Team site | https://tancy-ux.github.io/ware-assets/ |
| Code | https://github.com/Tancy-ux/ware-assets (branch `main`) |
| Store | https://www.wareinnovations.com (admin: `ware-innovations-mumbai`) |
| Supabase | Dashboard → project "Brand Assets" (`lauvnmdepcdjxilglubn`), free plan |
| Functions | `https://lauvnmdepcdjxilglubn.supabase.co/functions/v1/ask-faq` and `/chat-admin` |
| Gemini | Google AI Studio (billing on, Tier 1, monthly spend cap Rs 1,000) |
| Zoho CRM | India data centre: `zoho.in` / `zohoapis.in` / `crm.zoho.in` |
| WhatsApp (team) | +91 90828 20610 (handoff button, fallback, Atelier enquiries) |
| Designer call-back number shown to Atelier leads | +91 96196 20099 |
| Team hours shown in the chat | Mon–Sat, 10 am – 7 pm |
| Store address (bot + map link) | Raghuvanshi Mills Compound, Senapati Bapat Marg, Lower Parel West, Mumbai 400013 · [Google Maps](https://maps.app.goo.gl/xvfFKjgKcb9agCtc6) |

The Chats page is used only by the developer and one colleague.

---

## 3. Repository map

```
.github/workflows/deploy.yml   Builds and publishes the team site on every push to main
docs/GUIDE.md                  This guide
index.html, vite.config.js     Vite app shell; FAQ-doc watcher plugin; base "/ware-assets/" in production
public/                        Logos served as-is (navbar logo, downloadable logo files)
scripts/                       One-off and build scripts (SQL, token helpers, FAQ sync) – see §10
src/
  App.jsx, main.jsx            Routes (BrowserRouter basename "/ware-assets")
  Pages/HomePage.jsx           Home: Assets, Colors, Fonts, Logos with a jump menu
  components/                  Every page and piece of UI (see §4, §5)
  lib/                         Shared logic: chat texts, function calls, FAQ parsing, page labels
  assets/*.docx                Source FAQ documents (synced into the faqs table)
  data/faqs.json               Generated from the docs (gitignored build output)
supabase/functions/
  ask-faq/index.ts             The chatbot brain (answers, product cards, logging, pill taps, leads capture)
  ask-faq/delivery.ts          Pincode → delivery cost and days (Shopify zones + India Post)
  chat-admin/index.ts          The Chats page's server: login, list, search, takeover, stats, Zoho
  chat-admin/dev.env           Local port for chat-admin (not a secret)
  .env.local                   Local secrets (gitignored)
widget/                        The Shopify store chat (build config, snippet, test page) – see §6
```

---

## 4. The team site, page by page

Routes (all under `/ware-assets`): `/`, `/assets`, `/faq`, `/chats`,
`/login`, `/colors`, `/logos`, `/fonts`. GitHub Pages has no server
routing, so `scripts/copy-404.mjs` copies `index.html` to `404.html` after
every build; deep links then load the app, which reads the real path.

### Navbar and login

- **Login** (`/login`, `Login.jsx`): email + password for a **Supabase Auth**
  team account (Supabase → Authentication → Users). Public sign-ups are
  switched off, so accounts are only created by hand in the dashboard.
- Signing in sets a `localStorage` flag `auth` that shows the edit buttons
  and the **Chats** link. The flag is only for the UI: the database itself
  refuses writes without a real signed-in session (`supabase-security.sql`).
  `App.jsx` clears a stale flag when there's no session.
- **Logout** signs out of Supabase and clears the flag.

### Home (`/`)

A left "On this page" menu jumping to four sections:

- **Assets** (`Assets.jsx`): named links from the `download_assets` table
  (catalogues, decks…). Signed-in team members get **Add link** (title + URL).
- **Colors** (`Colors.jsx`): the brand palette; click a swatch to copy its
  hex. Light Cream `#fae3ce`, Burnt Orange `#bf5e35`, Light Green `#a8ab65`,
  Dark Green `#505e37`, Off-white `#e8e8e1`, Black `#565656`.
- **Fonts** (`Fonts.jsx`): Montserrat (Google Fonts link) and Sheila Crayon
  (dafont link; the file is also in `src/fonts/`).
- **Logos** (`Logos.jsx`): Burnt Orange, White, Atelier and Atelier white
  logos from `public/`, downloadable as PNG or JPG.

### Downloads (`/assets`, `AssetLibrary.jsx` + `Upload.jsx`)

Files in the Supabase Storage bucket **`assets`**, folder `uploads/`. Upload
adds a timestamp prefix to the file name; the list hides it and downloads
use a 60-second signed link with the original name.

### FAQs (`/faq`, `Faq.jsx`)

The team's knowledge base, and the bot's main source of answers.

- **Browse** by category (sidebar), or **search** (every word must match;
  matches are highlighted and search spans all categories).
- **Short FAQs**: categories matching "chatbot / internal / team note / tech
  note" are shown separately with a "Short FAQs:" prefix, and are left out
  of downloads.
- **Download all FAQs** builds a Word document of every public Q&A.
- Team only: **add** a question, **edit** in place, **delete** (soft delete
  for doc-derived questions: they're flagged, not removed, so a re-sync never
  brings them back), and **Upload a document**: a `.docx` is parsed in the
  browser, shown as a preview with checkboxes, then saved.
- **Ask AI** button (team only): opens the chat drawer to test the bot as a
  customer would, with **Improve answer** under each reply and the
  **Improve AI** panel (see §5.13).

Where FAQs come from:

- `scripts/build-faqs.mjs` reads every `.docx`/`.pdf` in `src/assets/`,
  extracts Q&As with `src/lib/parseFaqs.js`, writes `src/data/faqs.json` and
  syncs them into the `faqs` table (using the service role key from
  `supabase/functions/.env.local` or the environment). It runs before
  `npm run dev` and `npm run build`, and the dev server re-runs it when a doc
  in `src/assets/` changes.
- Parsing understands four layouts: numbered questions ending in "?"
  followed by answer paragraphs; "Q: … A: …" on one line; "Q:" and "A:" on
  separate lines; a short label followed by a quoted one-line reply.
  Section headers ("2. Materials, Safety & Care") become categories; files
  without headers use a fallback category (`FILE_CATEGORY_FALLBACK`).
- Skipped files (not Q&A): `Custom Gifting Process.docx`,
  `Ware Gift Studio.xlsx`, `conversation flow & faq for whatsapp chatbot.docx`.
  The last one holds the intended **gifting and HoReCa conversation flows**
  (not built into the bot yet; the gifting follow-up person is **Priyal**, not
  the name in that doc).

### Chats (`/chats`, `ChatLogs.jsx`, `ChatResults.jsx`, `ChatContacts.jsx`, `ChatInsights.jsx`, `LeadCard.jsx`, `ChatTeam.jsx`, `ChatBot.jsx`)

**Sign-in: "Continue with Google"**, separate from the site login. Only
`@wareinnovations.com` Google Workspace accounts get in: `chat-admin` checks
Google's signature (client ID in `src/lib/googleConfig.js` and the
`GOOGLE_CLIENT_ID` secret), the verified email and the Workspace domain.
The owner is `CHATS_OWNER_EMAIL` (shown as `CHATS_OWNER_NAME`, default
"Tanushree"); everyone else must be on the Team list and switched on. No
Supabase accounts are created (on this site any Supabase account counts as
a team member, so Supabase's own Google sign-in is deliberately not used).
**Owner backup login** (link under the button): `CHATS_USERNAME` /
`CHATS_PASSWORD`, owner only; team members have no passwords. A session
lasts 7 days (signed token, kept in the browser's localStorage, so closing
the tab doesn't sign you out; Log out clears it). A team member who is
turned off or removed is locked out at once regardless. Sign-in attempts: 10 per 10 minutes, 30 per day per
connection.

**Layout**: left menu (Conversations, Contacts, Stats, Team, Bot, and who's signed in
with Log out), a title bar with the search and **Refresh**, then the
section. Phones work like WhatsApp Business: icons in a slim top bar,
search + refresh, one swipeable row of filters, the list; a chat opens full
screen with ← back.

**Team** (needs "Manage team"): add a person with name, work email and
ticks: see phone numbers & emails, see the Contacts list, take over & reply, edit details, draft
the requirement with AI ("Draft from chat", off unless ticked), write
replies with AI ("AI reply", off unless ticked), send to
Zoho, Stats, see carts (the Stats **Carts** tab; off unless ticked; with
only this tick, Stats opens straight on Carts), delete chats, manage team. Checked on the server on every
action (contacts are masked server-side), so turning someone off or
changing ticks applies straight away. Nobody can give a permission they
don't have. Team replies show the sender's name ("Tani · Ware team") to the
shopper and in Chats. Each row: initial, name (with an **Off** pill when turned
off), email, last login, what they may do, then **Edit** and **Turn
off/on**. **Remove from team** is inside Edit (with a confirm), away from
the row's buttons. The owner's row says "Owner · can't be removed" (the
owner's sign-ins aren't recorded).

**Bot** (owner only, not a permission): the bot's standing instructions
(`ai_guidelines`, the same rules the FAQ page's Improve AI panel edits).
Each instruction has On/Off, Edit, Delete; saving goes live on the bot's
next answer. At least 5 words and 25 characters each, up to 60 of 400
characters. **Try it** asks the bot with the instructions as written,
including an unsaved edit (sent through `chat-admin` with the service key;
not logged); with nothing asked yet it offers sample questions to tap.
**Always on** (folded) lists the rules built into ask-faq that never need
writing (`BUILT_IN` in ChatBot.jsx; keep it in step with ask-faq's
prompt). With no instructions yet, a few **ideas** can be tapped to start
one. **History** (folded) shows "Last changed … by …" and keeps every
change in `ai_guidelines_versions`; any version can be brought back. On
computers the Instructions and Try it cards are the same height, each
scrolling inside.

**Saved messages and emojis** (reply box, needs "Take over & reply"): each
login keeps its own saved messages (`chat_quick_replies`, up to 50);
picking one puts it in the box to edit or send, with `{name}` filled in as
the visitor's first name ("there" if unknown). The smiley adds an emoji at
the cursor.

**AI reply and + Product** (the bar above the reply box, with "Take over
& reply"):
- **AI reply** (`chat-admin` "ai-reply"; needs its own tick too, "Write
  replies with AI", in the Manager preset like "Draft from chat"): asks `ask-faq` what the bot
  would say to the shopper's latest message(s), with the chat's history
  since they last started over, the live Bot instructions, and their name
  / whether their number is saved. It's told a team member sends it under
  their own name ("we", no "pop your details below"). The text goes in the
  box and its product picks show above it; **nothing is sent until you
  press Send**, so edit or remove anything first. One AI answer's cost per
  click, nothing otherwise; nothing is logged by the click itself.
- **+ Product** (`chat-admin` "product-search", no AI, free): search the
  store's products by name (every word must be in the title, in stock
  first), tap one to add it. Up to 6 per reply; ✕ removes one.
- Sent products are checked against the catalogue (unknown links are
  dropped) and saved on the team message. The shopper's chat gets them
  from `ask-faq` "updates" rebuilt from the live catalogue, so the card's
  price, stock and Add to cart are current. Needs the current
  `ware-chat.js` on the store to show the cards.

**Transcript = what the shopper saw**: taps are saved in the chat's own
words ("Show me more products like this", "Dimensions", the designer-call
offer), and each AI reply keeps what else was shown under it (catalogue
and map links, WhatsApp card, name / number form or prompt, designer-call
buttons, gift photos; `chat_messages.extras`), drawn under the reply.

**Logged-in store customers**: the snippet reads (never writes) the
customer's first name, phone, email and ID from Shopify and passes them
along. The chat knows their name (no name box; the bot uses it sparingly)
and pre-fills their number in the details form, but never mentions having
their phone or email. They're saved on the chat (`account_*`,
`shopify_customer_id`), shown as "Store account" in the side panel (link
to the customer in Shopify admin) and fill empty phone / email in the lead
card. Masked like other contacts for logins without "contacts".

**Internal chats**: chats started from this site's Ask AI (or a local test)
are saved with `source = internal`, tagged **Internal** and shown only under
the Internal filter (hidden when there are none), never in Needs reply /
Leads / All; Stats counts them with the test chats.

The page fits the screen: header, summary, search and the open chat's
header stay put; the list, the transcript and the side panel scroll inside
their own boxes. **Live**: the list re-checks every 30 s while the page is
in view (an open AI chat reloads when a new message arrives). **Refresh**
reloads the list and the stats.

**Summary cards** (top, click one to filter the list): *need reply*, *new
leads today*, *chats · <date range>*, *in Zoho*. **Conversations | Stats**
switch on the right.

**A page of its own**: /chats has no site header (App.jsx renders it on its own, tab title "WareBot") and fills the screen. **Ware assets home**, above your name in the menu (a house icon on phones), goes back to the rest of the site.

**Left menu**: titled **WareBot** (the sign-in page too) with a green
**Live** pill, then Conversations (with a red count of chats needing a
reply, hidden at 0), Stats, Team, Bot. The open section is dark green
with a thin bar on its left; on phones the menu is icons only.

**Conversations tab**: three columns (list · chat · visitor panel), with a
slim 180 px menu on the left. Below 1180 px wide the panel opens from the
chat header's panel button; on phones it's list *or* chat. The side panel
runs **Lead** (warmth) → **Right now** (page, cart in bold, device, days chatted)
→ **Contact & Zoho lead**, collapsed until the chat has contact details →
**Products seen** last (first 6, then **Show all**). Store page names show in proper case ("Kuch
Meetha Ho Jaye Dessert Set").

- **List**: newest activity first. At its top: the **search**, then "31
  conversations" with the date filter on its right (Last 7 days default /
  30 / 90 / All time / Custom dates), then the quick filters **All · Needs
  reply · Leads · Taken over · In Zoho** (Internal when there are some),
  each with its count (hidden at 0). Filters are soft filled chips, the selected
  one dark green. The title bar above holds just the section's name and
  **Refresh** on the right (on phones the Conversations title bar is
  hidden and Refresh sits beside the search). Each row is three lines: (1) the title, the day and
  browser tag for "Visitor N" chats (so two "Visitor 3"s are easy to tell
  apart), small **Needs reply / Lead / Zoho ✓ / Internal** tags, and the
  time; (2) the **topic** ("Asking how to order", regular weight so the name stands out); (3) the latest question
  (or the matched line while searching) with "AI handled · 1 msg" (or
  "Team · …") in small print.
- **Needs reply** = the chat is taken over by the team *and* its latest
  message is the customer's (the AI isn't answering it). AI-handled chats
  never need a reply.
- **Titles**: the team's label → the visitor's name → their company →
  **"Visitor N"** (with its day beside it if not today). Visitor numbers
  **restart every day** (India time): Visitor 3 = the 3rd chat started that
  day, counting the chats still there (deleting one renumbers the later
  ones that day).
- **Search** covers names, phone numbers (any formatting: "98765 43210",
  "+91-9876543210" and "9876543210" all match), emails, labels, companies,
  topics, pages, "visitor 3", "in zoho", and **every message** (searched on
  the server, 350 ms after typing stops).
- **Open a chat**: header with the title (✎ rename), Needs reply / Zoho
  tags, "Started … · On: <page> · #browser-tag" (click the tag for every
  chat from that browser), **Take over** / **Hand back to AI**, and the
  **⋯** menu (Rename, All chats from this visitor, Delete chat). The
  transcript has a date marker for each day, "AI" / "Ware team" labels,
  the product tiles the bot showed (with photos; older chats get theirs
  from the store's products.json), and "on <page>" notes when the visitor
  moved page. Under it: "Ask AI is replying…" with a Take over button, or
  the reply box during a takeover.
- **Take over**: the AI stops answering this chat; the team replies from the
  box at the bottom and the shopper sees "A member of the Ware team has
  joined the chat". The transcript refreshes every 5 s. **Hand back to AI**
  ends it (it also ends after 24 hours, or if the shopper starts a new chat).
- **Delete** removes the chat, its messages and its saved name/phone for
  good.
- **Visitor panel** (right):
  - **Lead**: Hot / Warm / Cold bar. The AI rates each reply's chat
    ("interest"), and leaving a phone or email bumps it up a step. Under it
    the topic and whether contact details were shared.
  - **Contact & Zoho lead**: the lead form (open by default): name,
    phone, email, type of client, lead source (always "Website Bot"),
    requirement, products. **Save** keeps
    them in the admin only; **Send to Zoho** is the separate push, see §8.
  - **Right now**: last page, **cart** (items and total when they last
    wrote, read by the store widget from `/cart.js`), **device** (e.g.
    "Mobile · Chrome · Android", from the browser), **days chatted** (how many
    different days they've messaged: "1 day", or "3 days (first 29 Sep)"
    for someone who keeps coming back), last active.
  - **Products seen** (below the lead card): the first product of each
    reply (the bot's top pick), with photo and price; 6 shown, then
    **Show all**. In the transcript, each reply's
    products are one scrollable row of small tiles.
- **Topic and interest** come from the same Gemini reply the shopper gets
  (two extra fields, no extra AI call). Pill taps (similar / bespoke) set
  them without AI. Chats from before 29 Sep 2026 have neither.

**Contacts** (needs the "See the Contacts list" tick, which no preset
includes; without "See phone numbers & emails" too, the numbers and emails
are left out; `chat-admin` "contacts"): one row
per person who left a phone number or email, in the chat, the Ware
Atelier form or their store account (logged-in customers). Chats with the
same phone (last 10 digits) or email are merged into one person, even
from different browsers. Shows people **last chatted** in the date
filter's range; internal and test chats are left out.

- Columns: person (name, company, where the details came from), phone
  (tap to call), email, what they asked about, number of chats, last
  chatted (hover for first), latest cart value, and status tags:
  **Ordered** (Shopify order from the same browser), **In Zoho** (opens
  the lead), **Replied** (a team reply in any of their chats), **Follow
  up**.
- Filters: All, **To follow up** (nobody replied, not in Zoho, no
  order), Not in Zoho, Has a cart, Ordered. Search by name, number, email
  or company. Sort by person, chats, last chatted (default, newest first)
  or cart. Tap a name to open their latest chat.
- **Download CSV** (owner only): what's on screen, for Excel / a mailing
  list / a Zoho import.

**Stats tab** (same date filter), with four tabs, **Overview**,
**Carts**, **Products** and **Couldn't answer** (Carts needs the carts
tick, the others the stats tick):

- **Hide test and junk chats** (on by default, remembered per browser):
  leaves out chats named or labelled "test", "testing" or "junk" (rename
  a chat to mark it), and orders from only such chats.
- **From chat to order**: Chatted → Had a real conversation (2+ messages)
  → Left their number, with arrows, each as a % of chats. **Ordered**
  (browsers that ordered) sits apart, as "% of chats, at any step":
  people can order without ever leaving a number. When nobody has left a
  number, a hint links to the FAQ page.
- **Orders from people who chatted** (value, count, **See orders**: order
  number opening Shopify admin, date, total, amount added from the chat,
  link to the chat, and the visitor's browser tag like `#04174e`, shown even
  when that chat is gone) and **Orders from items added in chat**.
- **Carts tab** (needs the carts tick): a headline "₹X in N carts, no
  order since", then everyone who had something in their cart when they
  last chatted, **newest first** (tap the **Cart** or **Last chatted**
  heading to sort by it; tap again to flip the order): the chat (with its browser tag for
  "Visitor N", and a **Lead** tag if they left a phone or email), the cart
  *as it was when they last chatted*, last chatted, and **Since then**:
  **Ordered** when Shopify has an order from the same browser after the
  chat, blank otherwise. The chat only reads the cart while they're
  chatting, so it can't tell if they emptied it later.
- **Products tab** (`chat-admin` "products"): every product the bot
  showed in the range, with its photo and price: **Bot showed it** (in how
  many chats), **Chatted on its page** (chats while on its product page),
  **Ordered from chat** (pieces and ₹ added with the chat card's + button
  and then ordered; matched by the order line's product title). Sort by
  any column; most shown first.
- **Couldn't answer tab** (`chat-admin` "gaps"): AI replies that said it
  didn't know / couldn't find / wasn't sure, or that sent them to WhatsApp
  when they hadn't asked for a person. Replies to gibberish ("didn't
  understand that") are left out. The same question asked again is one
  row (count and number of chats), newest first, with **Open chat**. Owner:
  **Teach the bot** opens the Bot page with a new instruction started:
  `When someone asks "…", ` to finish and save.
- **Where chats start**: chats per store page they started on, with the
  product's or collection's real name and photo (from the store's public
  products.json / collections.json, cached 1 h), a bar, filters (All,
  Products, Collections, Pages, Home), top 6 then **Show all**.
- **What people ask about**: chats grouped by keyword rules over each
  chat's topic and questions (Bulk or restaurant orders, Ware Atelier,
  Gifting, Similar products, Delivery and shipping, Returns and care, How
  to order, Just saying hi, Product / Other questions). No AI.
- If Shopify's orders can't load, everything else still shows, with a note.
- How orders are linked: see §7.

---

## 5. The store chatbot: what shoppers see

The chat is the same React component as the team's Ask AI drawer
(`src/components/AskAi.jsx` with `customer` on), built into a standalone
script for Shopify. All its wording lives in `src/lib/chatTexts.js`
(defaults) and can be overridden in the Shopify snippet without a rebuild.

### 5.1 The pill (closed chat)

Bottom right, 120 px up (clear of the WhatsApp button), frosted, with a
twinkling sparkle. Always starts closed. Its text depends on the page:

| Page | Pill text | Tapping it |
| --- | --- | --- |
| Any other page | "Need help choosing?" (store copy) | Opens the chat |
| A product page | "Show me more products like this" | Opens the chat and sends that message; answered instantly with similar pieces (no AI, free) |
| A product tagged `ware atelier` | "Love this piece? Let's talk" | Opens the chat with the bespoke designer-call offer (no AI, free) |

The product is detected from the URL (`/products/<handle>`), then
`/products/<handle>.js` gives its title and tags.

### 5.2 Opening the chat

Header: the Ware mark (white wordmark on a terracotta circle, built into
`ware-chat.js` from `public/ware-white-transparent.png`, see
`src/components/wareMark.js`), "Ware concierge" with "Online · usually
replies in minutes" under it (`status` in the snippet's texts; the bot
answers any time, so there's no away state), and on the right a ⋯ menu
(**Start a new chat**; full screen on desktop only) and ✕ to close.

Text colours (snippet's EASY EDITS): `--ware-ink` #565656 for everything
dark, `--ware-reply-ink` #3d3d3d for the concierge's and team's replies.

Two sets of hours: the **team** (chat, WhatsApp, calls) is Mon–Sat 10 am –
7 pm; the **store** in Lower Parel (visits, pickup) is Mon–Sat 10:30 am –
7 pm, as the FAQs say. The bot's prompt keeps them apart. Welcome message and four suggestion chips:
"Gift ideas below ₹2,500", "Gifts below ₹5,000", "Bulk or corporate
gifting", "How long does delivery take?". The conversation is kept in the
browser, so it's still there on the next page.

### 5.3 Replies and product cards

- Replies are short and warm (no filler like "Happy to help"), plain text,
  and never invent products, prices, discounts or promises.
- Product cards: photo, short name ("Set of 4" on its own line), ₹ price,
  and a round **+**. On the store, + adds to the cart without leaving the
  page, turns into a ✓, and shows **"✓ Added to your cart · View cart"**
  for 4.5 s. Products with options (size/colour) link to their page.
- Recommendations show 4 cards and **Show more** (6 at a time, up to 16),
  all in budget, in stock, from the same range, max 2 colours per design.
- Sold-out cards say "Sold out" and offer **similar pieces in stock**.
- **Ware Atelier** pieces show "Price on request" and **Enquire** (WhatsApp).
- Arrows ‹ › scroll card rows on desktop; swipe on phones.

### 5.4 Similar products ("more like this", sold-out alternatives)

Computed in code, never by the AI. Never crosses ranges (Atelier bespoke /
Collectibles / marble tableware / ceramics). Ranked by: same collection and
name (rare words count most) > **size** (ml from the product name: close
sizes rank first, under half or over double the size is pushed down) >
type > price > distinctive tags > colour. For product-page taps: at most one
other colour of the same design and at most two more from the same range
before other ranges get a turn.

### 5.4a Product details on product pages (no AI)

On a product page whose product has any of these metafields, the pill reads
**"Questions about this piece?"** and opens the chat with "Anything you'd
like to know about the {product}?" and one button per detail it has:

| Button | Metafield |
|---|---|
| What's in the set? | `custom.this_set_includes` |
| Dimensions | `my_fields.set_dimensions` |
| Volume | `my_fields.set_volumes` |
| Weight | `my_fields.set_weight` |

plus **Show me more like this** (§5.4). Empty metafields get no button. The
answer is the metafield's own text, instantly and for free; used buttons
drop off the next "Anything else about…". Each answer is logged to the
Chats page (ask-faq mode `info`) and the AI sees it for follow-up
questions. The snippet reads the metafields with Liquid (its own
`<script>` block setting `WareChatConfig.productInfo`); a product with none
keeps the old pill, which asks for more like it straight away. The local
test page takes `&includes=…&dimensions=…&volume=…&weight=…`.

### 5.5 Ware Atelier (bespoke) pieces

Any question about specific Atelier pieces (typed, or the pill) gets the
same offer instead of an AI answer, because too little is known about each
piece: *"The Cosmic Temple is one of our bespoke pieces, and we're so glad
it caught your eye! … Shall we give you a call?"* with the piece's card,
**Browse our bespoke catalogue ↗** (the Atelier PDF), and **Yes, call me** /
**Not now**.

Once that offer has been made in the chat, a later question about the
piece isn't answered with the same text again: the reply thanks them,
answers in general terms (price / availability depend on what they have in
mind, as it's made to order) and gives the designers' number, e.g. *"Thank
you for your interest in the Cosmic Temple! Each piece is made to order and
customised for you, so its price and availability depend on what you have
in mind. One of our designers will share the details with you. You can
reach them on +91 96196 20099, or tap "Yes, call me" below…"*. The
catalogue link and Yes / Not now still show; the piece's card doesn't
(it was shown with the offer). (`followUp` on the bot's
`bespoke` reply; the chat shows the bot's text for it.) Names starting with
"The" aren't doubled ("the Cosmic Temple", in the WhatsApp texts too).

- **Yes, call me** → name + number form (and "Prefer WhatsApp?") → *"One of
  our designers will call you shortly from +91 96196 20099 (Mon–Sat, 10 am –
  7 pm). Do save the number…"*
- **Not now** → *"Of course, no rush at all…"*
- General bespoke questions get a short AI reply plus the catalogue link.
- Each step is logged to the Chats page (interest, call request with number,
  or decline).

### 5.6 Delivery and shipping (pincode lookup, `delivery.ts`)

The bot asks for a pincode and then quotes exactly what code works out:

- **Price**: from the store's own Shopify shipping zones (Admin API, one zone
  per state; cached 1 hour). **Free shipping from ₹5,000** anywhere in India
  (the Re 1 difference in Shopify's "5,001+" is ignored on purpose; prices
  within ₹1 of a round hundred are rounded down).
- **Place**: India Post pincode API (town, district, state; state spelling
  differences like Orissa/Odisha are handled).
- **Days**: Mumbai and Navi Mumbai 2–3 business days, plus *same-day delivery
  for ₹350 extra*; these states 3–5: Bihar, Chandigarh, Chhattisgarh, Delhi,
  Goa, Gujarat, Haryana, Jharkhand, Karnataka, Kerala, Madhya Pradesh,
  Maharashtra, Punjab, Rajasthan, Tamil Nadu, Telangana, Uttar Pradesh;
  everywhere else 5–8. *All orders are dispatched within 24 hours.*
- **Outside India**: prices differ (products are roughly +95%), so the team
  quotes them (WhatsApp); the bot may share times after dispatch: Dubai
  12–15, UK 15–20, USA 20–45 business days.

Change the days in the `CITY_RULES` / `FAST_STATES` / `DEFAULT_TRANSIT`
block at the top of `delivery.ts`.

### 5.7 Asking for name and number (never pushy)

- **"What should we call you?"** box under the first 4 AI replies, until the
  name is known or closed (×).
- **"Want our team to follow up with you?" → Enter your details** (name +
  phone) from the shopper's 6th typed message, or straight away for bulk /
  corporate / custom / Atelier enquiries. **Not now** hides it. It shows
  under **every other reply at most** (never two replies in a row), unless
  the reply itself asks for a call. In the Chats transcript it's a one-line
  "Details asked" note.
- When the bot asks "could our team give you a quick call?" the form opens
  right under that reply. It never says the team will call unless a number
  is on file.
- Never two asks at once (not next to the WhatsApp button, not with the
  name box). Emails and mobile numbers typed into the chat are saved too
  (a 6-digit pincode is never mistaken for a phone).
- The bot uses the shopper's name sparingly (about once every 6 replies).

### 5.8 Gifting and bulk behaviour

- Budgets: "under/below/within ₹X" and "above/over ₹X" (also "5k");
  "around ₹1,500" means roughly ₹1,200–1,900.
- Bulk flow: first a warm line ("We'd love to help you with your corporate
  gifting! Could you share a few details?") and a short numbered list of
  whatever they haven't said yet: 1. Budget per gift, 2. How many gifts,
  3. When they need them by. Then suggest 3–4 different pieces near the
  per-piece budget, then offer a call with the form. (A numbered list the
  AI writes on one line is put one item per line before it's shown.)
- **Quantities over 20** are never confirmed (stock, dates): the team
  confirms.
- **Gift packaging** is only discussed when asked; per piece, from the
  Shopify tag `gift-wrap` (with real packaging photos when they exist).
- Colour families: tea green = green, steel = blue, moon/pepper = grey,
  etc.; marble stone names don't matter as colours.
- Synonyms: spoon/fork → cutlery and similar; the latest message counts most.
- Can't find it → says so honestly and offers the WhatsApp button.

### 5.9 Links the chat adds by itself

- **Browse our bespoke catalogue ↗** under Atelier / bespoke replies
  (`atelierCatalogUrl`).
- **Get directions on Google Maps ↗** under any reply giving the store
  address, or when asked for directions / the showroom (`storeMapUrl`).
- **Chat with the Ware team** WhatsApp card when the shopper wants a person,
  pre-filled with a summary of what they need.

### 5.10 When the AI can't answer

Gemini down, out of quota or too slow (25 s deadline) → a warm message and
the WhatsApp button. The same happens for too many messages (limits in §9).
The WhatsApp message is pre-filled with who they are (if known) and their
last few questions:

    Hi! I'm Priya. I was chatting with the assistant on your website and
    would love some help.

    What I asked:
    - Bulk or corporate gifting
    - 100 gifts, around 1500 each by 20th Oct

(Without a name it starts "Hi! I was chatting…"; one question reads "I
asked: …".) Written in two places that must match: `fallbackWhatsAppUrl` in
AskAi.jsx (the chat can't reach the bot) and `handoffText` in ask-faq. A
message over 500 characters gets its own text sent as it is.

### 5.11 Team takeover (seen from the shopper's side)

While the team has taken a chat over, the shopper's messages go to the team
("Sent to the Ware team") and team replies appear in the chat (checked every
4 s while the team is active, every 20 s otherwise, and not at all after 10
minutes of quiet or in a background tab).
Team replies look like the bot's (no box), with the team member's name
above and their initial beside them, and can carry product cards (from AI
reply or + Product in Chats) with Add to cart. The look is in
`widget/ware-chat.liquid` (upload it to the store after changing it).

### 5.12 Starting over

⋯ → **Start a new chat** (or typing "reset") clears the AI's memory; the
Chats page keeps it as the same conversation with a "Visitor reset the
chat" marker.

### 5.13 Teaching the bot (team, from the FAQ page's Ask AI)

- **Improve answer** under a reply saves a corrected answer as a new FAQ in
  the "WhatsApp Bot FAQ" category, so the bot uses it from then on.
- **Improve AI** panel: write a rough note; the AI tidies it into short
  rules for review; approved rules are saved in `ai_guidelines` and added to
  every prompt. Rules can be switched off (instant), edited or deleted.

---

## 6. The Shopify side

### 6.1 The two theme files

| File | Contents | Who changes it |
| --- | --- | --- |
| `snippets/ware-chat.liquid` | **WORDS** (every text, `window.WareChatConfig.texts`) and **STYLES** (`<template id="ware-chat-styles">`, with "EASY EDITS" colour/font/size/position variables at the top) | The team, in Shopify's code editor |
| `assets/ware-chat.js` | The engine (built from this repo) | Re-uploaded when the chat's behaviour changes |

The store's copy of the snippet is tracked at **`widget/ware-chat.liquid`**
(builds never overwrite it). It's rendered from `layout/theme.liquid`
(`{% render 'ware-chat' %}`), currently on **all pages**.

The chat runs inside a shadow DOM, so the theme's CSS and the chat's CSS
never affect each other. Without the snippet's style template the script
stays hidden and logs why.

### 6.2 Easy edits in the snippet

- Colours: `--faq-accent` (burnt orange `#bf5e35`), `--ware-cream`,
  `--ware-peach`, `--ware-ink`, `--ware-pill-text`…
- Sizes: `--ware-reply-size`, `--ware-message-size`, `--ware-title-size`,
  `--ware-pill-size`, chat width `--askai-w`, position `--ware-chat-bottom`.
- Any text: pill texts (`pill`, `pillProduct`, `pillBespoke`), welcome,
  chips (`suggestions`), team hours, WhatsApp card, form texts, bespoke
  messages, catalogue and maps links, "Added to your cart"…
  A text missing from the snippet falls back to the default in
  `chatTexts.js`; unknown keys are ignored, so a typo can't break the chat.

Turn off format-on-save for `.liquid` files: formatters have broken the
CSS inside before (`0%,` in keyframes became `0,`, `@supports` lost its
`not(`).

### 6.3 What the chat writes to Shopify (the shopper's own cart only)

- Cart attribute **`_ware_chat`** = the chat's random visitor ID, set once
  they've used the chat (orders then show it under "Additional details").
- Line-item property **`_via: Ware chat`** on items added with the chat's +.
  The underscore hides both from the cart and checkout. Because of the
  property, the same product added from the chat and from its page shows as
  two cart lines.
- After adding, the chat fires **`cart:build`** (what the Motion theme's
  drawer listens for) and `cart:refresh` (other themes/apps), so the cart
  drawer and header count update without a reload. It doesn't open the
  drawer.

How often the chat reads the cart: `/cart.js` once per message it logs
(the cart summary on the Chats page) and `/cart/update.js` once per page
view (the `_ware_chat` tag). The `/cart.js` call every 5 seconds seen on
the store is the theme's free-shipping bar script (`updateShippingMessage`
with `setInterval(…, 5000)`), not the chat.

The chat never writes anything else to the store. (The claude.ai Shopify
connector, if used for maintenance, is read-only by rule.)

### 6.4 Shopify API access and the shpca_ tokens

**Since the start of 2026 Shopify only issues `shpca_` Admin API tokens,
not `shpat_`.** Don't look for a "custom app with an shpat_ token" anymore.

How this project gets its token (`scripts/shopify-token.mjs`):

- It uses the existing Dev Dashboard app **py-analytics** and the
  **authorization-code grant** (a browser approval round-trip on
  `localhost:3456`), which returns an offline `shpca_` token.
- The client-credentials grant does **not** work here: the app belongs to a
  different Dev Dashboard organisation from the store, so Shopify answers
  `shop_not_permitted`.
- Scopes requested (the app's full list, so approving doesn't shrink it):
  `read_all_orders, read_analytics, read_orders, read_products,
  read_reports, read_shipping`. The bot needs `read_shipping`; the Stats tab
  needs `read_orders`.
- The token is saved straight into Supabase as **`SHOPIFY_ADMIN_TOKEN`**,
  never printed.

```powershell
$env:SHOPIFY_CLIENT_ID="..."; $env:SHOPIFY_CLIENT_SECRET="..."
node scripts/shopify-token.mjs      # approve in the browser window
```

Admin API version used: `2026-07` (GraphQL; query cost limit 1000, so
shipping zones are read 25 at a time).

The product catalogue itself needs no token: it comes from the public
`https://www.wareinnovations.com/products.json` (products published to the
Online Store only), cached 10 minutes. `ware atelier`, `collectibles`,
`marble` tags / titles decide a product's range; `gift-wrap` means it comes
gift-packed.

### 6.5 Installing or updating on the store

1. `npm run build:widget` → `widget/dist/ware-chat.js`.
2. Shopify → Online Store → Themes → (a draft copy first) → ⋯ → Edit code.
3. **Assets** → replace `ware-chat.js` with the new file.
4. **Snippets** → `ware-chat`: replace with `widget/ware-chat.liquid`, or,
   if it was edited in Shopify since, paste only the new WORDS lines / style
   blocks the change added.
5. `layout/theme.liquid`: `{% render 'ware-chat' %}` just above `</body>`.
6. Preview, test (including + on a card), then publish. Hard-refresh
   (Ctrl+Shift+R) to see a new script.

Test locally without Shopify: serve `widget/dist/` (e.g.
`npx http-server -p 5050 widget/dist`) and open `test.html`. Add
`?product=<handle>&title=<name>` to pretend to be a product page, plus
`&bespoke=1` for an Atelier piece. It uses the deployed `ask-faq`.

---

## 7. Tracking: orders, pages, visitor numbers

- **Orders** (Stats tab): `chat-admin` reads the date range's orders from
  the Shopify Admin API (read-only, 80 at a time, up to 2,000) and keeps
  those with `_ware_chat` ("orders after chatting", linked back to the chat)
  or `_via` lines ("added from chat"). Only orders from the same browser
  (same cart) count; calls and WhatsApp orders don't. Counting starts 29 Sep
  2026. Test and cancelled orders don't count toward totals. Shopify orders
  are cached 5 minutes; Refresh skips the cache.
- **Pages**: every chat call sends the page path (never the query string).
  Saved as `first_page` / `last_page` on the chat and `page` on each
  message.
- **Visitor numbers**: computed daily by `chat-admin` (see §4). The old
  running number column `visitor_number` still exists but isn't shown.

---

## 8. Zoho CRM leads (Chats → Lead card)

Nothing goes to Zoho automatically. In an open chat, the **Lead** bar shows
"Needs …", "Ready for Zoho" or "In Zoho ✓" (links to the lead). Open it to
see:

- **Name, Phone, Email** (filled from the chat), **Type of client**
  (dropdown loaded from Zoho), **Lead source** (fixed:
  "Website Bot"; the card warns if Zoho's Lead Source list doesn't have
  it), **Requirement** (type it, or **Draft from chat**: one AI
  call writes a WhatsApp-style summary, even for small interests),
  **Products enquired for**.
- **Save** keeps the details on the chat. **Send to Zoho** needs a name, a
  phone or email, and a requirement.

What **Send to Zoho** does:

1. Looks for an existing **Lead** with the same phone (last 10 digits,
   Phone and Mobile fields) or email.
2. **Found** → changes nothing that's filled in; fills only its **empty**
   fields (Phone, Email, Company, Requirement, Products enquired for, Type
   of client, Lead Source), **appends** the tag `ware-ai-chat` (`over_write: false`),
   and links the chat to it.
3. **Not found** → creates a lead: First/Last name (a one-word name becomes
   Last name "."), Phone/Email, **Lead Source "Website Bot"**, Requirement
   (Zoho field `Additional_Notes`, labelled "Requirement"),
   `Products_enquired_for`, `Type_of_Client1`, tag `ware-ai-chat`. If Zoho
   insists on another field (e.g. Company) it gets "-".
4. One lead per chat; the card then shows the link.

Only Leads are checked, not Contacts.

Connection: a Zoho **Self Client** (api-console.zoho.in). Scopes:
`ZohoCRM.modules.leads.CREATE, ZohoCRM.modules.leads.READ,
ZohoCRM.modules.leads.UPDATE, ZohoCRM.settings.fields.READ,
ZohoCRM.settings.tags.ALL`. `scripts/zoho-token.mjs` swaps the one-time code
for a refresh token and saves `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`,
`ZOHO_REFRESH_TOKEN` to Supabase without printing them. Fields are found by
their labels, so renaming "Requirement" or "Products enquired for" in Zoho
would need a code change (`zohoLeadFields` in `chat-admin`).

---

## 9. Security and limits

- **Keys**: the Gemini key, Shopify token, Zoho tokens, Chats login and the
  Supabase service role key live only in Supabase secrets (and the
  gitignored `.env.local` for local runs). The browser only ever has the
  public anon key.
- **Database** (`supabase-security.sql`): reading FAQs, guidelines and
  download links is public; writing needs a signed-in team account. Chat
  tables have no public access at all: only the two functions (service
  role) touch them. Public sign-ups are off.
- **Origins**: `ask-faq` only answers wareinnovations.com, `*.myshopify.com`,
  `*.shopifypreview.com`, tancy-ux.github.io and localhost.
- **AI reply limits** (`RATE_LIMITS` in `ask-faq`, counted in Postgres by
  `ai_rate_check`): per browser 15 / 10 min and 60 / day; per connection 40
  / 10 min and 200 / day; **site-wide 250 / day** (≈ Rs 200, midnight to
  midnight IST). Over a limit → friendly WhatsApp nudge, no AI call.
- **Other limits** (`rate_limit`): name/number forms and "start over" 10 /
  10 min and 40 / day per connection; pill taps 30 / 10 min and 150 / day;
  Chats logins 10 / 10 min and 30 / day.
- Messages over 500 characters are refused; the AI sees at most the last 10
  turns (1,000 characters each).
- Team-only actions (the Improve AI "tidy") need a signed-in team session.
- Chat messages are shown as plain text (links are made clickable, nothing
  else); product cards come from Shopify data, never from the model's text.
- Optional hardening not done yet: Cloudflare Turnstile (only if bot
  traffic appears); revoking `rls_auto_enable()` execute from public roles.

---

## 10. Data and scripts

### Tables

| Table | What | Written by |
| --- | --- | --- |
| `faqs` | question, answer, category, internal, doc_key, deleted, updated_at | FAQ page (team), build-faqs sync |
| `ai_guidelines` | the bot's standing rules (rule, original note, enabled) | Chats → Bot, Improve AI panel |
| `ai_guidelines_versions` | every change to those rules (rules, note, by) | Chats → Bot |
| `chat_users` | Chats team: name, email, permissions, active, last_login_at | Chats → Team |
| `download_assets` | Home → Assets links (name, url) | Team |
| `chat_conversations` | one per browser: visitor_id, visitor_name, company, visitor_phone, visitor_email, label, first/last_question, first/last_page, takeover_at, started_at, last_message_at, visitor_number, requirement, lead_products, client_type, zoho_lead_id, zoho_lead_at | ask-faq, chat-admin |
| `chat_messages` | question, answer, products (title/url/available), sender (ai / agent / customer / system), page, created_at | ask-faq, chat-admin |
| `ai_usage` | rate-limit counters (and usage) | `ai_rate_check`, `rate_limit` |
| `restock_requests` | never created; "Check restock" is switched off | – |

Storage bucket `assets` (folder `uploads/`) for the Downloads page.

### SQL scripts (Supabase → SQL Editor; all safe to re-run; all have been run)

`supabase-faqs-table.sql`, `supabase-ai-guidelines-table.sql`,
`supabase-download-assets-table.sql`, `supabase-chat-logs-tables.sql`,
`supabase-security.sql`, `supabase-form-limits.sql` (after security),
`supabase-visitor-numbers.sql`, `supabase-chat-pages.sql`,
`supabase-zoho-leads.sql`, `supabase-chat-insights.sql` (topic, interest,
device, cart), `supabase-chat-users.sql` (team, email, agent_name),
`supabase-bot-versions.sql`, `supabase-chat-source.sql` (internal chats),
`supabase-chat-extras.sql` (what was shown under each reply),
`supabase-quick-replies.sql` (saved messages),
`supabase-chat-account.sql` (logged-in customer's account). (`supabase-restock-requests-table.sql` exists but was never
run.)

### Other scripts

| Script | Does |
| --- | --- |
| `scripts/build-faqs.mjs` | Docs → `faqs.json` + `faqs` table sync (runs before dev/build) |
| `scripts/copy-404.mjs` | `404.html` for GitHub Pages deep links (after build) |
| `scripts/shopify-token.mjs` | Gets the `shpca_` Admin token → `SHOPIFY_ADMIN_TOKEN` |
| `scripts/zoho-token.mjs` | Connects Zoho → `ZOHO_*` secrets |
| `widget/build-snippet.mjs` | After the widget build: default snippet + test page |

### Supabase secrets

`GEMINI_API_KEY`, `CHATS_USERNAME`, `CHATS_PASSWORD` (owner backup login),
`GOOGLE_CLIENT_ID`, `CHATS_OWNER_EMAIL` (optional `CHATS_OWNER_NAME`),
`SHOPIFY_ADMIN_TOKEN`
(`SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` also stored, unused while the
token works), `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`.
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are provided
automatically. Set with `npx supabase secrets set NAME=value` (never paste
secrets into chats or commits).

---

## 11. How the bot answers (inside `ask-faq`)

For a typed message:

1. Origin check, 500-character cap, takeover check (if the team has the
   chat, the message is just saved for them), rate limits.
2. Load the FAQs, enabled guidelines and the catalogue (cached).
3. **Shortlist** to keep the prompt small (~6–7K tokens instead of ~26K):
   30 matching products (8 with full details), 14 FAQs, whole-word matching
   with synonyms and stopwords, the current message weighted ×3, budget and
   colour filters, max 2 colours per design.
4. Work out facts in code and hand them to the model as notes: pincode
   delivery, gift packaging per piece, large quantities, whether the name
   was used recently, whether a number is on file.
5. Ask **Gemini** for a JSON reply (`reply`, `intent`, `products`,
   `visitorName`, `company`, `followUp`, `askForCall`, `request`), trying
   `gemini-3.6-flash`, `3.8-flash`, `3.7-flash`, `3.5-flash`,
   `3.5-flash-lite` in order (18 s per model, 25 s overall; a model out of
   quota is skipped for 10 minutes). Cut-off JSON is salvaged.
6. Code decides what's shown: cards only for recommend/product intents,
   Show more extras, similar pieces for sold-out ones, the bespoke offer
   for Atelier pieces, WhatsApp card for "human", the details form for
   follow-up-worthy enquiries or call requests, catalogue / maps links.
7. Log the turn to `chat_conversations` / `chat_messages` (never allowed to
   fail the reply).

Intents: `recommend`, `product`, `gift_packaging`, `call_request`, `human`,
`general`.

Not repeating itself: the prompt tells the model to carry forward what
they've said, never restate earlier replies, and when the same question
comes again, confirm in a line ("Just to confirm, …") and move them on
(e.g. "the form is right below this message") instead of rewording the
same answer. The team's hours are mentioned at most once a chat. The one
fixed text that replaces an AI reply (the Ware Atelier offer) is only used
the first time; later questions about the piece get a follow-up answer
(see 5.5).

Other `ask-faq` modes (no AI unless noted): `updates` (team replies /
takeover poll), `reset`, `contact` (name + phone), `name`, `similar`
(product-page pill), `bespoke` (Atelier steps: start / call / later),
`shipping-debug` (service role only: zones and one pincode's note),
`tidy` (team only, AI).

`chat-admin` actions: `login`, `list`, `search`, `messages`, `takeover`,
`reply`, `label`, `delete`, `results` (Stats), `lead-options`,
`lead-draft` (AI), `lead-save`, `lead-push`.

The prompt's business rules (all in `ask-faq/index.ts`): stay on Ware
topics, no invented discounts, overseas prices from the team, >20 pieces
confirmed by the team, gift packaging only when asked, Atelier never priced,
ranges never mixed, honest "couldn't find it", never promise a call without
a number, warm but short.

---

## 12. Running, building and deploying

| Command | Does |
| --- | --- |
| `npm install` | Dependencies |
| `npm run dev` | Team site locally (syncs FAQs first) |
| `npm run build` / `npm run preview` | Production build / serve it on :4173 (`/ware-assets/`; talks to the deployed functions) |
| `npm run build:widget` | Store chat → `widget/dist/` |
| `npm run lint` | ESLint (some older files have known warnings) |
| `npm run dev:ai` | `ask-faq` locally on :8000 (Deno via npx; needs `.env.local`) |
| `npm run dev:chats` | `chat-admin` locally on :8002 |
| `npx supabase functions deploy ask-faq --use-api` | Deploy the bot (same for `chat-admin`) |

- **Team site deploy**: push to `main` → GitHub Actions
  (`.github/workflows/deploy.yml`) builds and publishes to GitHub Pages
  (Node 20). `npm run deploy` (gh-pages) is the older manual route.
- **Functions** deploy separately and immediately (they're not part of the
  site build). Shopify files are uploaded by hand (§6.5).
- Local dev: in development only, `src/lib/askFaq.js` can point at local
  function URLs (`VITE_ASK_FAQ_URL`, `VITE_CHAT_ADMIN_URL` in `.env.local`); production builds
  always use the deployed functions.
- Git: commit only when asked; always get a fresh yes before pushing.
- Windows notes: files use CRLF; the repo is edited on Windows (PowerShell
  and Git Bash both work). Deno isn't installed globally; the dev scripts
  run it through npx.

---

## 13. Costs

| Service | Plan | Usage (29 Sep 2026) | Can it bill? |
| --- | --- | --- | --- |
| Gemini | Paid (Tier 1) | ~Rs 0.78 per AI reply | Yes: capped by the 250 replies/day limit (~Rs 200/day) and the Rs 1,000/month AI Studio cap |
| Supabase | Free | ~1,000 of 500,000 function calls/month, 28 MB of 500 MB database, 13 MB of 5 GB egress | No card on file: over a limit means a warning/pause, never a charge |
| GitHub Pages | Free | – | No |
| Vercel | Not used by this project | – | – |

Free (no AI): pill taps, Show more, similar pieces, bespoke buttons and
forms, delivery price/days lookup (the reply around it is AI), polling,
the Chats page. Paid: each typed message's reply, Improve AI tidy, Draft
from chat (under Rs 1 each).

Free Supabase projects pause after a week without activity; the chat keeps
this one active.

---

## 14. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Chat shows the WhatsApp fallback | Gemini out of quota / slow, or the site-wide daily cap reached. Check the function logs (Supabase → Edge Functions → ask-faq → Logs). |
| Store chat doesn't show at all | Snippet not rendered, or its style template missing (console says so), or an old cached script (hard-refresh). |
| New words/styles don't appear | The snippet wasn't updated; the engine falls back to defaults for texts but styles must be in the snippet. |
| Delivery lookup says it can't check | `SHOPIFY_ADMIN_TOKEN` missing/revoked (re-run `shopify-token.mjs`), or India Post API down. |
| Stats: "can't read orders" | Token lacks `read_orders`. |
| Zoho: "isn't connected" / sign-in failed | Re-run `zoho-token.mjs` with a fresh Self Client code (codes expire in 10 minutes and work once). |
| Chats page logs out | Session is 12 hours and per browser tab session. |
| A deep link on the team site 404s | `404.html` missing from the build (copy-404 step). |
| A FAQ keeps coming back | It's in a source doc; delete it on the FAQ page (soft delete) rather than in the table. |
| Test chats cluttering the Chats page | Delete them there; visitor numbers for that day close up. |

---

### The bot says it can't find products it should

The catalogue comes from a shared copy in Supabase Storage
(`bot-cache/catalog.json`), refreshed every 30 minutes through the Shopify
Admin API (`read_products`). The public `products.json` feed is only a
fallback: Shopify rate-limits it for Supabase's servers ("429
local_rate_limited"), which on 30 Sep 2026 left the bot with no products
until this was changed. If a refresh fails, the last copy stays in use.
To check what the store's feed answers from Supabase, call ask-faq with
`{"mode": "shipping-debug", "feed": true}` (or `"scopes": true` for the
Admin key's permissions) using the service role key.

Some store products are never recommended: the checkout add-ons
("Partial Payment", the ₹150 "Gift Wrapping"), "Ware's E-Gift Card", and
anything tagged `merchandise` (keychain, notebook, lapel pin). They're
listed in `EXCLUDED_TITLES` / `EXCLUDED_TAGS` at the top of
`ask-faq/index.ts`; add a new one there by its exact title, or tag it
`merchandise` in Shopify.

## 15. Known gaps and ideas not built

- Gifting / HoReCa conversation flows from the WhatsApp flow doc (and the
  HoReCa catalogue PDF) are not in the bot yet.
- Zoho duplicate check covers Leads only, not Contacts.
- "Check restock" is switched off (`restock_requests` table never created).
- Stock levels aren't checked beyond Shopify's available / sold out.
- Product metafields (materials, dimensions) aren't read; sizes come only
  from product names (ml).
- Optional: Mistral as a free fallback after Gemini; meaning-based search
  (embeddings) if vague questions struggle; Cloudflare Turnstile.
