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

### Chats (`/chats`, `ChatLogs.jsx`, `ChatResults.jsx`, `LeadCard.jsx`)

Its own login (username + password from the Supabase secrets
`CHATS_USERNAME` / `CHATS_PASSWORD`), separate from the site login. A
session lasts 12 hours (signed token checked by `chat-admin`); closing the
browser logs out (sessionStorage). Login attempts are limited to 10 per 10
minutes and 30 per day per connection.

The page fits the screen: header, tabs, search and the open chat's header
stay put; the list, the transcript and the stats scroll inside their own
boxes. **Refresh** reloads the list and the stats.

**Conversations tab**

- **List**: newest activity first, with the date filter (Last 7 days
  default / 30 / 90 / All time / Custom dates). Each item shows the title,
  the latest question (or the matched line while searching), message count,
  a short browser tag (`#04174e`), and the page the chat started on.
- **Titles**: the team's label → the visitor's name → their company →
  **"Visitor N"** with its day underneath. Visitor numbers **restart every
  day** (India time): Visitor 3 = the 3rd chat started that day, counting
  the chats still there (deleting one renumbers the later ones that day).
- **Search** covers names, phone numbers (any formatting: "98765 43210",
  "+91-9876543210" and "9876543210" all match), labels, companies, pages,
  "visitor 3", and **every message** (searched on the server, 350 ms after
  typing stops).
- **Open a chat**: the transcript (jumps to the newest message), product
  chips the bot showed, "on Product · …" notes whenever the visitor moved to
  another page, and the header with name, company, phone (links to
  WhatsApp), "Started … on <page>", and the browser tag (click it to see
  every chat from that browser).
- **Rename** (✎) sets a label, e.g. "Converted – call".
- **Take over**: the AI stops answering this chat; the team replies from the
  box at the bottom and the shopper sees "A member of the Ware team has
  joined the chat". The transcript refreshes every 5 s. **Hand back to AI**
  ends it (it also ends after 24 hours, or if the shopper starts a new chat).
- **Delete** removes the chat, its messages and its saved name/phone for
  good.
- **Lead card** (Zoho): see §8.

**Stats tab** (same date filter)

- **Chats**, **Left their number**, **Orders after chatting** (and % of
  chats), **Their order value**, **Added from chat** (value and orders).
- **See orders**: order number (opens it in Shopify admin), date, total,
  amount added from the chat, and a link to the chat.
- **Pages**: messages sent from each store page ("Collection ·
  /collections/bulk-gifting … 12"), top 20 with **Show more**, filter by
  page kind (Homepage, Collections, Products, Pages, Search…), sort by most
  or A–Z. Market prefixes like `/en-us/` are ignored when grouping kinds.
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

Header: minimise (⌄), "Ware concierge", and a ⋯ menu (**Start a new chat**;
full screen on desktop only). Welcome message and four suggestion chips:
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

### 5.5 Ware Atelier (bespoke) pieces

Any question about specific Atelier pieces (typed, or the pill) gets the
same offer instead of an AI answer, because too little is known about each
piece: *"The Cosmic Temple is one of our bespoke pieces, and we're so glad
it caught your eye! … Shall we give you a call?"* with the piece's card,
**Browse our bespoke catalogue ↗** (the Atelier PDF), and **Yes, call me** /
**Not now**.

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
  corporate / custom / Atelier enquiries. **Not now** hides it.
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
- Bulk flow: first ask timeline and delivery city (one line), then suggest
  3–4 different pieces near the per-piece budget, then offer a call with the
  form.
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
the WhatsApp button, with their question pre-filled. The same happens for
messages over 500 characters or too many messages (limits in §9).

### 5.11 Team takeover (seen from the shopper's side)

While the team has taken a chat over, the shopper's messages go to the team
("Sent to the Ware team") and team replies appear in the chat (checked every
4 s while the team is active, every 20 s otherwise, and not at all after 10
minutes of quiet or in a background tab).

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
  (dropdown loaded from Zoho: Retail, Horeca, Reseller, Corporate, Ware
  Atelier - Early Bird, Ware Atelier, Bulk Gift, Retail Gift,
  Not-qualified), **Requirement** (type it, or **Draft from chat**: one AI
  call writes a WhatsApp-style summary, even for small interests),
  **Products enquired for**.
- **Save** keeps the details on the chat. **Send to Zoho** needs a name, a
  phone or email, and a requirement.

What **Send to Zoho** does:

1. Looks for an existing **Lead** with the same phone (last 10 digits,
   Phone and Mobile fields) or email.
2. **Found** → changes nothing that's filled in; fills only its **empty**
   fields (Phone, Email, Company, Requirement, Products enquired for, Type
   of client), **appends** the tag `ware-ai-chat` (`over_write: false`),
   and links the chat to it.
3. **Not found** → creates a lead: First/Last name (a one-word name becomes
   Last name "."), Phone/Email, **Lead Source "Website"**, Requirement
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
| `ai_guidelines` | the bot's standing rules (rule, original note, enabled) | Improve AI panel |
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
`supabase-zoho-leads.sql`. (`supabase-restock-requests-table.sql` exists but
was never run.)

### Other scripts

| Script | Does |
| --- | --- |
| `scripts/build-faqs.mjs` | Docs → `faqs.json` + `faqs` table sync (runs before dev/build) |
| `scripts/copy-404.mjs` | `404.html` for GitHub Pages deep links (after build) |
| `scripts/shopify-token.mjs` | Gets the `shpca_` Admin token → `SHOPIFY_ADMIN_TOKEN` |
| `scripts/zoho-token.mjs` | Connects Zoho → `ZOHO_*` secrets |
| `widget/build-snippet.mjs` | After the widget build: default snippet + test page |

### Supabase secrets

`GEMINI_API_KEY`, `CHATS_USERNAME`, `CHATS_PASSWORD`, `SHOPIFY_ADMIN_TOKEN`
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
