// Supabase Edge Function: chat-admin
//
// Backs the site's Chats page: its own login (separate from the site's
// shared login, and checked here on the server, never in the browser),
// then lists / reads / labels / deletes the Ask AI conversations that
// ask-faq logs.
// The chat tables have no anon access, so this function (using the
// service role key) is the only way to read them.
//
// Deploy: supabase functions deploy chat-admin
// Requires the secrets:
//   supabase secrets set CHATS_USERNAME=... CHATS_PASSWORD=...
// (the owner's backup login, with every permission), and for "Sign in with
// Google":
//   supabase secrets set GOOGLE_CLIENT_ID=... CHATS_OWNER_EMAIL=you@wareinnovations.com
// (CHATS_OWNER_EMAIL: the owner's Google email(s), comma-separated;
// optional CHATS_OWNER_NAME, shown instead of "Owner").
// Team members sign in with Google only: their name, email and permissions
// live in chat_users (scripts/supabase-chat-users.sql), managed from the
// Chats page's Team section. Only @wareinnovations.com emails get in.
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically
// once deployed; for local runs they go in supabase/functions/.env.local.)
//
// Run locally: npm run dev:chats  (serves on http://localhost:8002)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "https://esm.sh/jose@5.9.6";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Signed in for 7 days (the page keeps the token across tabs).
const SESSION_HOURS = 7 * 24;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const encoder = new TextEncoder();

// Compares without bailing out at the first different character, so
// response timing doesn't leak how much of a guess was right.
function safeEqual(a: string, b: string) {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

// Session tokens are "<expiry ms>.<user id or "owner">.<HMAC>", signed
// with a key derived from the owner password + service key (+ a team
// member's email). Changing the owner password logs everyone out;
// changing a team member's email logs them out.
async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function makeToken(secret: string, uid = OWNER) {
  const expires = String(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  return `${expires}.${uid}.${await sign(`${expires}.${uid}`, secret)}`;
}

// { uid } if the token is one of ours, unexpired and signed with `secret`
// (which depends on whose it is: see sessionFor).
function readToken(token: unknown) {
  if (typeof token !== "string") return null;
  const [expires, uid, sig] = token.split(".");
  if (!expires || !uid || !sig || Number(expires) < Date.now()) return null;
  return { expires, uid, sig };
}

async function tokenSignedWith(
  t: { expires: string; uid: string; sig: string },
  secret: string,
) {
  return safeEqual(t.sig, await sign(`${t.expires}.${t.uid}`, secret));
}

// ---- Team logins and what each can do ----
const OWNER = "owner";
// Google sign-in: only work accounts, checked against Google's own keys.
const ALLOWED_DOMAIN = "wareinnovations.com";
const GOOGLE_KEYS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const ownerEmails = () =>
  (Deno.env.get("CHATS_OWNER_EMAIL") ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
const ownerName = () => Deno.env.get("CHATS_OWNER_NAME")?.trim() || "Tanushree";
const workEmail = (email: string) =>
  /^[\w.+-]+@wareinnovations\.com$/i.test(email);
// A signed-in team member's session is tied to their email: changing it
// ends their sessions.
const userSecret = (secret: string, email: string) =>
  `${secret}:email:${email.toLowerCase()}`;
// The Google ID token from "Sign in with Google": a verified work email,
// or null.
async function googleEmail(credential: unknown) {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  if (!clientId || typeof credential !== "string") return null;
  try {
    const { payload } = await jwtVerify(credential, GOOGLE_KEYS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
    });
    const email = String(payload.email ?? "").toLowerCase();
    if (payload.email_verified !== true || !workEmail(email)) return null;
    // Google Workspace accounts carry their domain; a Gmail account
    // renamed to look like one doesn't.
    if (payload.hd !== ALLOWED_DOMAIN) return null;
    return email;
  } catch (err) {
    console.error("Google sign-in check failed:", err);
    return null;
  }
}
// Everything a login can be allowed. Reading the conversations is always
// allowed; these are on top.
const PERMISSIONS = [
  "contacts", // see phone numbers and emails
  "people", // the Contacts section (its numbers / emails need "contacts" too)
  "reply", // take over chats and reply
  "edit", // edit contact / lead details, rename chats
  "draft", // "Draft from chat": the AI writes the requirement (with edit)
  "aireply", // "AI reply" in a taken-over chat (with reply): one AI answer a click
  "zoho", // send leads to Zoho
  "stats", // the Stats tab (orders, revenue)
  "carts", // Stats' Carts tab: who has things in their cart
  "delete", // delete chats
  "users", // manage team logins
] as const;
type Permission = typeof PERMISSIONS[number];
type Perms = Record<Permission, boolean>;
const ALL_PERMS = Object.fromEntries(PERMISSIONS.map((p) => [p, true])) as Perms;
const cleanPerms = (raw: unknown) =>
  Object.fromEntries(
    // deno-lint-ignore no-explicit-any
    PERMISSIONS.map((p) => [p, (raw as any)?.[p] === true]),
  ) as Perms;

// Phone numbers and emails in text, for logins that may not see them.
const HIDE_PHONE_RE = /(?:\+?\d[\d\s-]{6,}\d)/g;
const HIDE_EMAIL_RE = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const hideContacts = (text: string | null | undefined): string =>
  (text ?? "").replace(HIDE_EMAIL_RE, "•••@•••").replace(HIDE_PHONE_RE, "•••••");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Login attempts allowed per connection (right or wrong).
const LOGIN_ATTEMPTS_10M = 10;
const LOGIN_ATTEMPTS_DAY = 30;

// Most conversations the Chats list loads at once (newest first). With
// the date filter, "All time" is the only view likely to reach it.
const LIST_LIMIT = 2000;

// A timestamp from the page, or null if it's missing or not a date.
const validDate = (value: unknown) =>
  typeof value === "string" && !isNaN(Date.parse(value))
    ? new Date(value).toISOString()
    : null;

// Must match TAKEOVER_HOURS in ask-faq.
const TAKEOVER_HOURS = 24;
function takeoverActive(takeoverAt: string | null | undefined) {
  if (!takeoverAt) return false;
  return Date.now() - new Date(takeoverAt).getTime() <
    TAKEOVER_HOURS * 60 * 60 * 1000;
}

// ---- Results: orders the chat played a part in ----
// The store chat tags the shopper's cart (see tagCart in AskAi.jsx):
//   cart attribute  _ware_chat = their chat's visitor ID  -> "chatted, then
//                                                            ordered"
//   line property   _via = "Ware chat"   -> "added from the chat"
// Both carry through to the order. Shopify can't search orders by them, so
// this reads the orders in the date range (read-only, SHOPIFY_ADMIN_TOKEN
// with read_orders) and picks those out. Only order number, date and
// totals leave this function, never customer details.
const SHOP = "ware-innovations-mumbai.myshopify.com";
const SHOPIFY_API = "2026-07";
const CHAT_ATTRIBUTE = "_ware_chat";
const VIA_PROPERTY = "_via";
// Nothing is tagged before the chat started tagging carts.
const TRACKING_FROM = "2026-09-29T00:00:00Z";
const MAX_ORDER_PAGES = 25; // x 80 orders
// Shopify's orders are cached briefly (reading them takes a few calls);
// the chat counts are always fresh.
const ORDERS_CACHE_MS = 5 * 60 * 1000;
const ordersCache = new Map<
  string,
  { at: number; value: Awaited<ReturnType<typeof chatOrders>> }
>();

// The store's product and collection names and photos (handle -> title
// and first image, from the public products.json / collections.json
// feeds), kept for an hour: photos for chats logged before photos were
// saved with them, and real names for the Stats tab's pages. No AI, no
// admin token.
const STORE_URL = "https://www.wareinnovations.com";
const CATALOG_CACHE_MS = 60 * 60 * 1000;
// price / available: from the catalogue copy or feed (for "+ Product").
type CatalogItem = {
  title: string;
  image: string | null;
  price?: string | null;
  available?: boolean;
};

// "₹1,500", or "From ₹1,200" when the variants differ. Ware Atelier
// pieces (tagged "ware atelier") are made to order: never a price, as in
// the bot's cards.
// deno-lint-ignore no-explicit-any
function feedPrice(variants: any[] | undefined, tags?: unknown) {
  const tagList = Array.isArray(tags) ? tags : String(tags ?? "").split(",");
  if (tagList.some((t) => String(t).toLowerCase().trim() === "ware atelier")) {
    return "Price on request";
  }
  const prices = (variants ?? []).map((v) => Number(v?.price)).filter((n) => n > 0);
  if (!prices.length) return null;
  const min = Math.min(...prices);
  const text = `₹${Math.round(min).toLocaleString("en-IN")}`;
  return Math.max(...prices) > min ? `From ${text}` : text;
}
type StoreCatalog = {
  products: Map<string, CatalogItem>;
  collections: Map<string, CatalogItem>;
};
let catalogCache: { at: number; value: StoreCatalog } | null = null;

async function readFeed(kind: "products" | "collections") {
  const items = new Map<string, CatalogItem>();
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${STORE_URL}/${kind}.json?limit=250&page=${page}`);
    if (!res.ok) break;
    const list = (await res.json())[kind] ?? [];
    for (const x of list) {
      items.set(x.handle, {
        title: x.title,
        image: x.images?.[0]?.src ?? x.image?.src ?? null,
        price: feedPrice(x.variants, x.tags),
        // deno-lint-ignore no-explicit-any
        available: x.variants ? x.variants.some((v: any) => v?.available) : undefined,
      });
    }
    if (list.length < 250) break;
  }
  return items;
}

// Products: the bot's shared copy of the catalogue (ask-faq keeps it in
// Storage, bot-cache/catalog.json). Collections: the Admin API. The
// public feeds are only a fallback, since Shopify rate-limits them for
// Supabase's servers.
// deno-lint-ignore no-explicit-any
async function productsFromSnapshot(db: any) {
  const { data, error } = await db.storage.from("bot-cache").download("catalog.json");
  if (error || !data) throw new Error("No catalogue copy yet");
  const items = new Map<string, CatalogItem>();
  for (const p of JSON.parse(await data.text()).raw ?? []) {
    items.set(p.handle, {
      title: p.title,
      image: p.images?.[0]?.src ?? null,
      price: feedPrice(p.variants, p.tags),
      // deno-lint-ignore no-explicit-any
      available: p.variants ? p.variants.some((v: any) => v?.available) : undefined,
    });
  }
  return items;
}

async function collectionsFromAdmin() {
  const token = Deno.env.get("SHOPIFY_ADMIN_TOKEN");
  if (!token) throw new Error("SHOPIFY_ADMIN_TOKEN isn't set");
  const items = new Map<string, CatalogItem>();
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const res: Response = await fetch(`https://${SHOP}/admin/api/${SHOPIFY_API}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({
        query: `query($after: String) { collections(first: 250, after: $after) {
          pageInfo { hasNextPage endCursor } nodes { handle title image { url } } } }`,
        variables: { after },
      }),
    });
    // deno-lint-ignore no-explicit-any
    const json: any = await res.json();
    if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors ?? json).slice(0, 200));
    for (const c of json.data.collections.nodes) {
      items.set(c.handle, { title: c.title, image: c.image?.url ?? null });
    }
    if (!json.data.collections.pageInfo.hasNextPage) break;
    after = json.data.collections.pageInfo.endCursor;
  }
  return items;
}

// deno-lint-ignore no-explicit-any
async function storeCatalog(db?: any): Promise<StoreCatalog> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_CACHE_MS) {
    return catalogCache.value;
  }
  const [products, collections] = await Promise.all([
    (db ? productsFromSnapshot(db) : Promise.reject(new Error("no db")))
      .catch(() => readFeed("products")),
    collectionsFromAdmin().catch(() => readFeed("collections")),
  ]);
  catalogCache = { at: Date.now(), value: { products, collections } };
  return catalogCache.value;
}

const EMPTY_CATALOG: StoreCatalog = {
  products: new Map(),
  collections: new Map(),
};

// A store path's product or collection, if it's one of those.
function catalogItem(catalog: StoreCatalog, path: string) {
  const parts = path.split("/").filter(Boolean);
  const at = parts.lastIndexOf("products");
  if (at >= 0) return catalog.products.get(parts[at + 1] ?? "") ?? null;
  const c = parts.indexOf("collections");
  if (c >= 0 && parts.length === c + 2) {
    return catalog.collections.get(parts[c + 1]) ?? null;
  }
  return null;
}

// Stats: what a chat was about, by simple keyword rules over its topic
// and questions (no AI). First match wins, so the order matters.
const ASK_ABOUT: [string, RegExp][] = [
  ["Bulk or restaurant orders", /\b(bulk|restaurants?|hotels?|cafes?|horeca|wholesale|corporate|quantit(y|ies)|resell)/i],
  ["Ware Atelier (bespoke)", /\b(atelier|bespoke|furniture)/i],
  ["Gifting", /\b(gift|gifting|diwali|wedding|hamper|return gifts?)/i],
  ["Similar products", /\b(similar|more (products|pieces) like|pieces like)/i],
  ["Delivery and shipping", /\b(deliver|delivery|shipping|ship|pincode|dispatch|courier|international)/i],
  ["Returns, care and quality", /\b(return|exchange|refund|damaged?|broken|care|dishwasher|microwave|oven)/i],
  ["How to order", /\b(how (do i|to|can i) (order|buy)|place (an )?order|payment|cod|checkout|order)/i],
  ["Just saying hi", /^(hi|hii+|hello|hey|yo|hola|namaste|just saying hi|greeting)\b/i],
];

function askedAbout(c: { topic?: string | null; first_question?: string | null; last_question?: string | null }) {
  const text = [c.topic, c.first_question, c.last_question].filter(Boolean).join(" \n ");
  if (!text.trim()) return "Other questions";
  for (const [label, re] of ASK_ABOUT) {
    if (label === "Just saying hi") {
      if ((c.topic && re.test(c.topic)) || (!c.topic && re.test((c.first_question ?? "").trim()) && (c.first_question ?? "").length < 25)) {
        return label;
      }
    } else if (re.test(text)) return label;
  }
  return c.topic ? "Product questions" : "Other questions";
}

// "Hide test and junk chats": ones the team named or labelled test / junk.
const TEST_RE = /\b(test(ing)?|junk)\b/i;
// Chats from the team's own site count too (source "internal").
const isTestChat = (c: { label?: string | null; visitor_name?: string | null; company?: string | null; source?: string | null }) =>
  c.source === "internal" ||
  [c.label, c.visitor_name, c.company].some((s) => s && TEST_RE.test(s));

const handleOf = (url: string) => url.match(/\/products\/([^/?#]+)/)?.[1] ?? "";

const ORDERS_QUERY = `
query Orders($q: String!, $after: String) {
  orders(first: 80, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      legacyResourceId
      name
      createdAt
      cancelledAt
      test
      customAttributes { key value }
      currentTotalPriceSet { shopMoney { amount } }
      lineItems(first: 15) {
        nodes {
          title
          quantity
          customAttributes { key value }
          discountedTotalSet { shopMoney { amount } }
        }
      }
    }
  }
}`;

type Attr = { key: string; value: string | null };

async function chatOrders(since: string | null, until: string | null) {
  const token = Deno.env.get("SHOPIFY_ADMIN_TOKEN");
  if (!token) throw new Error("SHOPIFY_ADMIN_TOKEN isn't set");
  const from = since && since > TRACKING_FROM ? since : TRACKING_FROM;
  const q = `created_at:>='${from}'` + (until ? ` created_at:<'${until}'` : "");
  // deno-lint-ignore no-explicit-any
  const found: any[] = [];
  let after: string | null = null;
  let scanned = 0;
  for (let page = 0; page < MAX_ORDER_PAGES; page++) {
    const res: Response = await fetch(
      `https://${SHOP}/admin/api/${SHOPIFY_API}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query: ORDERS_QUERY, variables: { q, after } }),
      },
    );
    // deno-lint-ignore no-explicit-any
    const body: any = await res.json();
    if (!res.ok || body.errors) {
      const detail = JSON.stringify(body.errors ?? body).slice(0, 300);
      throw new Error(`Shopify orders failed (${res.status}): ${detail}`);
    }
    const { nodes, pageInfo } = body.data.orders;
    scanned += nodes.length;
    for (const o of nodes) {
      if (o.test) continue;
      const visitor = (o.customAttributes as Attr[])
        .find((a) => a.key === CHAT_ATTRIBUTE)?.value ?? null;
      // deno-lint-ignore no-explicit-any
      const fromChat = o.lineItems.nodes.filter((l: any) =>
        (l.customAttributes as Attr[]).some((a) => a.key === VIA_PROPERTY)
      );
      if (!visitor && !fromChat.length) continue;
      found.push({
        id: o.legacyResourceId,
        name: o.name,
        createdAt: o.createdAt,
        cancelled: !!o.cancelledAt,
        total: Number(o.currentTotalPriceSet.shopMoney.amount),
        fromChatTotal: fromChat.reduce(
          // deno-lint-ignore no-explicit-any
          (sum: number, l: any) => sum + Number(l.discountedTotalSet.shopMoney.amount),
          0,
        ),
        // What was added with the chat's own + button (the Products tab).
        // deno-lint-ignore no-explicit-any
        fromChatItems: fromChat.map((l: any) => ({
          title: String(l.title ?? ""),
          quantity: Number(l.quantity ?? 1),
          amount: Number(l.discountedTotalSet.shopMoney.amount),
        })),
        visitorId: visitor && UUID_RE.test(visitor) ? visitor : null,
        adminUrl: `https://admin.shopify.com/store/${
          SHOP.split(".")[0]
        }/orders/${o.legacyResourceId}`,
      });
    }
    if (!pageInfo.hasNextPage) break;
    after = pageInfo.endCursor;
  }
  return { orders: found, scanned };
}

// Orders for a date range, kept for ORDERS_CACHE_MS unless `fresh`.
async function cachedOrders(since: string | null, until: string | null, fresh = false) {
  const key = `${since}|${until}`;
  const cached = ordersCache.get(key);
  if (cached && Date.now() - cached.at < ORDERS_CACHE_MS && !fresh) {
    return cached.value;
  }
  const value = await chatOrders(since, until);
  ordersCache.set(key, { at: Date.now(), value });
  return value;
}

// A phone number's last 10 digits, so "+91 98200 12345" and "9820012345"
// are the same person.
const phoneKey = (phone: string | null | undefined) => {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-10) : "";
};

// "₹" amounts in a cart summary: "2 items · ₹12,407" -> 12407.
const cartValue = (cart: string | null | undefined) =>
  Number(String(cart ?? "").match(/₹\s*([\d,]+)/)?.[1]?.replace(/,/g, "") ?? 0);

// Messages of the conversations in `ids`: 100 conversations a request
// (URL length), each paged by 1,000 rows (Supabase's most per request).
// deno-lint-ignore no-explicit-any
async function messagesOf(db: any, ids: string[], columns: string, filter?: (q: any) => any) {
  const PAGE = 1000;
  // deno-lint-ignore no-explicit-any
  const rows: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    for (let from = 0; from < 50 * PAGE; from += PAGE) {
      let q = db.from("chat_messages").select(columns)
        .in("conversation_id", ids.slice(i, i + 100))
        .order("id", { ascending: true });
      if (filter) q = filter(q);
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...(data ?? []));
      if ((data ?? []).length < PAGE) break;
    }
  }
  return rows;
}

// The bot's reply says it doesn't know or can't help ("Couldn't answer").
const DIDNT_KNOW_RE =
  /\b(couldn'?t|could not|can'?t|cannot|unable to|wasn'?t able to) (find|confirm|say|tell|answer|share|check)\b|\bnot sure\b|\b(don'?t|do not) (have|know) (that|this|those|any|the|much|enough|specific)\b|\bno (information|details) (on|about)\b/i;
// Not a gap: the bot couldn't make out what they typed (gibberish, "hi").
const DIDNT_UNDERSTAND_RE = /\b(understand|understood|make out|catch) (that|what you|your)/i;
// They asked for a person themselves: sending them on isn't a gap.
const WANTS_PERSON_RE =
  /\b(human|person|someone|real|agent|executive|representative|whats ?app|call me|talk to|speak to|contact (you|the team))\b/i;

// ---- Daily visitor numbers ----
// "Visitor 3" = the 3rd chat started that day (India time), counting the
// chats still there. Each day starts again from 1, so testing doesn't
// push the numbers into the thousands; the Chats page shows the day under
// it. Deleting a chat renumbers the later ones of that day.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const istDay = (iso: string) =>
  new Date(new Date(iso).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

// deno-lint-ignore no-explicit-any
async function dailyNumbers(db: any, conversations: { started_at: string }[]) {
  const numbers = new Map<string, number>();
  if (!conversations.length) return numbers;
  const days = conversations.map((c) => istDay(c.started_at)).sort();
  // Every chat started on those days (not just the ones listed), oldest
  // first, 1000 at a time.
  const from = new Date(Date.parse(`${days[0]}T00:00:00Z`) - IST_OFFSET_MS);
  const to = new Date(
    Date.parse(`${days[days.length - 1]}T00:00:00Z`) - IST_OFFSET_MS +
      24 * 60 * 60 * 1000,
  );
  const counts = new Map<string, number>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db
      .from("chat_conversations")
      .select("id, started_at")
      .gte("started_at", from.toISOString())
      .lt("started_at", to.toISOString())
      .order("started_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw error;
    for (const c of data ?? []) {
      const day = istDay(c.started_at);
      const n = (counts.get(day) ?? 0) + 1;
      counts.set(day, n);
      numbers.set(c.id, n);
    }
    if ((data ?? []).length < 1000) break;
  }
  return numbers;
}

// ---- Needs reply / visits (the Chats list) ----
// A taken-over chat needs a reply when its latest message is the
// customer's (the AI isn't answering it). Returns those chats' ids.
// deno-lint-ignore no-explicit-any
async function awaitingTeam(db: any, ids: string[]) {
  const waiting = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data, error } = await db
      .from("chat_messages")
      .select("conversation_id, sender, created_at")
      .in("conversation_id", chunk)
      .neq("sender", "system")
      .order("created_at", { ascending: false })
      .limit(chunk.length * 20);
    if (error) throw error;
    const seen = new Set<string>();
    for (const m of data ?? []) {
      if (seen.has(m.conversation_id)) continue;
      seen.add(m.conversation_id);
      if (m.sender === "customer") waiting.add(m.conversation_id);
    }
  }
  return waiting;
}

// ---- Zoho CRM leads (the Chats page's "Lead" card) ----
// Nothing goes to Zoho on its own: a team member reviews the card and
// clicks "Create lead". Needs ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET /
// ZOHO_REFRESH_TOKEN (scripts/zoho-token.mjs) and the columns from
// scripts/supabase-zoho-leads.sql.
const ZOHO_ACCOUNTS = "https://accounts.zoho.in";
const ZOHO_API = "https://www.zohoapis.in/crm/v5";
const ZOHO_CRM = "https://crm.zoho.in/crm";
const LEAD_TAG = "ware-ai-chat";
// Every lead sent from the Chats page (Zoho's Lead Source picklist).
const LEAD_SOURCE = "Website Bot";
let zohoToken: { value: string; expires: number } | null = null;

async function zohoAccessToken() {
  if (zohoToken && zohoToken.expires > Date.now() + 60_000) {
    return zohoToken.value;
  }
  const id = Deno.env.get("ZOHO_CLIENT_ID");
  const secret = Deno.env.get("ZOHO_CLIENT_SECRET");
  const refresh = Deno.env.get("ZOHO_REFRESH_TOKEN");
  if (!id || !secret || !refresh) {
    throw new ZohoError("Zoho isn't connected yet (run scripts/zoho-token.mjs).");
  }
  const res = await fetch(`${ZOHO_ACCOUNTS}/oauth/v2/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: id,
      client_secret: secret,
      refresh_token: refresh,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) {
    console.error("Zoho token refresh failed:", res.status, data.error);
    throw new ZohoError("Couldn't sign in to Zoho. Re-run scripts/zoho-token.mjs.");
  }
  zohoToken = {
    value: data.access_token,
    expires: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  };
  return zohoToken.value;
}

// An error whose message is fine to show on the Chats page.
class ZohoError extends Error {}

async function zoho(path: string, init: RequestInit = {}) {
  const res = await fetch(`${ZOHO_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Zoho-oauthtoken ${await zohoAccessToken()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

// The Leads fields the card fills, found by their labels (custom fields'
// internal names differ per account). Cached for the function's lifetime.
type LeadFields = {
  requirement: string | null;
  products: string | null;
  clientType: string | null;
  clientTypes: string[];
  leadSource: string;
  // Whether "Website Bot" is in Zoho's Lead Source list.
  leadSourceListed: boolean;
};
let leadFields: { at: number; value: LeadFields } | null = null;

async function zohoLeadFields(): Promise<LeadFields> {
  if (leadFields && Date.now() - leadFields.at < 60 * 60 * 1000) {
    return leadFields.value;
  }
  const { res, data } = await zoho("/settings/fields?module=Leads");
  if (!res.ok) {
    console.error("Zoho fields failed:", res.status, JSON.stringify(data).slice(0, 300));
    throw new ZohoError("Couldn't read the Leads fields from Zoho.");
  }
  // deno-lint-ignore no-explicit-any
  const fields: any[] = data.fields ?? [];
  const find = (re: RegExp) => fields.find((f) => re.test(f.field_label ?? ""));
  const picklist = (f: { pick_list_values?: { display_value: string }[] }) =>
    (f?.pick_list_values ?? [])
      .map((v) => v.display_value)
      .filter((v) => v && v !== "-None-");
  const clientType = find(/^\s*type of client/i);
  const sources = picklist(fields.find((f) => f.api_name === "Lead_Source"));
  const value = {
    requirement: find(/^\s*requirements?\s*$/i)?.api_name ?? null,
    products: find(/^\s*products? enquired/i)?.api_name ?? null,
    clientType: clientType?.api_name ?? null,
    clientTypes: picklist(clientType),
    // "Website Bot" as Zoho spells it.
    leadSource: sources.find((s) => s.toLowerCase() === LEAD_SOURCE.toLowerCase()) ??
      LEAD_SOURCE,
    leadSourceListed: sources.some((s) => s.toLowerCase() === LEAD_SOURCE.toLowerCase()),
  };
  leadFields = { at: Date.now(), value };
  return value;
}

// "Devika" -> First "Devika", Last "." (Zoho needs a last name);
// "Devika Shah" -> First "Devika", Last "Shah".
// "pinky sharma" -> "Pinky Sharma": each word's first letter capitalised,
// the rest left as typed (so "McDonald" and "D'Souza" stay as they are).
const nameCase = (name: string) =>
  name.replace(/(^|[\s-])(\p{Ll})/gu, (_, sep, ch) => sep + ch.toUpperCase());

function splitName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { First_Name: parts[0] ?? "", Last_Name: "." };
  return { First_Name: parts[0], Last_Name: parts.slice(1).join(" ") };
}

const EMAIL_RE = /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/;
const leadReady = (c: {
  visitor_name?: string | null;
  visitor_phone?: string | null;
  visitor_email?: string | null;
  requirement?: string | null;
}) => {
  const missing = [];
  if (!c.visitor_name?.trim()) missing.push("name");
  if (!c.visitor_phone?.trim() && !c.visitor_email?.trim()) {
    missing.push("phone or email");
  }
  if (!c.requirement?.trim()) missing.push("requirement");
  return missing;
};

// An existing Zoho lead with the same phone (compared on the last 10
// digits, so "+91 93267 62731" and "919326762731" match) or email.
// Phone first. Null if there's none.
async function findZohoLead(phone: string | null, email: string | null) {
  // deno-lint-ignore no-explicit-any
  const search = async (params: Record<string, string>): Promise<any[]> => {
    const { res, data } = await zoho(
      `/Leads/search?${new URLSearchParams(params)}`,
    );
    if (res.status === 204) return []; // no matches
    if (!res.ok) {
      console.error("Zoho search failed:", res.status, JSON.stringify(data).slice(0, 300));
      throw new ZohoError("Couldn't check Zoho for an existing lead.");
    }
    return data?.data ?? [];
  };
  const digits = (phone ?? "").replace(/\D/g, "").slice(-10);
  if (digits.length === 10) {
    // Zoho matches phone numbers as typed, so try the usual spellings.
    for (const variant of [digits, `91${digits}`, `+91${digits}`, `+91 ${digits}`]) {
      const found = (await search({ phone: variant })).find((l) =>
        [l.Phone, l.Mobile].some((p) =>
          String(p ?? "").replace(/\D/g, "").slice(-10) === digits
        )
      );
      if (found) return { lead: found, matchedBy: "phone" };
    }
  }
  if (email) {
    const found = (await search({ email: email.trim() })).find(
      (l) => String(l.Email ?? "").toLowerCase() === email.trim().toLowerCase(),
    );
    if (found) return { lead: found, matchedBy: "email" };
  }
  return null;
}

// The Chats page's "Draft from chat": the AI sums up what they want, like
// the WhatsApp hand-off message, plus the pieces they asked about.
const GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
];
async function draftRequirement(
  transcript: string,
): Promise<{ requirement: string; products: string } | null> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) return null;
  const body = JSON.stringify({
    systemInstruction: {
      parts: [{
        text:
          "You summarise a website chat between a shopper and Ware Innovations' assistant (handmade ceramic and marble tableware, gifting, HoReCa, Ware Atelier bespoke pieces) for a sales lead in the CRM. " +
          '"requirement": one or two plain sentences on what the shopper is interested in or asking for, with every detail they gave (products, quantity, budget, occasion, timeline, city or pincode, company, customisation). Even a small interest counts, e.g. "Interested in the Lilo espresso cups in tan; asked about delivery to Pune." Write it about the shopper, not the bot. No names or phone numbers. ' +
          '"products": the Ware products they asked about or showed interest in, comma-separated, or an empty string.',
      }],
    },
    contents: [{ role: "user", parts: [{ text: transcript.slice(-12000) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          requirement: { type: "STRING" },
          products: { type: "STRING" },
        },
        required: ["requirement", "products"],
      },
      maxOutputTokens: 1024,
    },
  });
  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (!res.ok) {
        console.error(`Gemini ${model} error:`, res.status);
        continue;
      }
      const result = await res.json();
      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const parsed = JSON.parse(text);
      return {
        requirement: String(parsed.requirement ?? "").trim().slice(0, 1000),
        products: String(parsed.products ?? "").trim().slice(0, 500),
      };
    } catch (err) {
      console.error(`Gemini ${model} failed:`, err);
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const username = Deno.env.get("CHATS_USERNAME");
    const password = Deno.env.get("CHATS_PASSWORD");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!username || !password || !serviceKey) {
      return json({ error: "Chats login isn't configured yet" }, 500);
    }
    const secret = `${password}:${serviceKey}`;

    const body = await req.json();

    if (body.action === "login") {
      // Limits password guessing per connection (rate_limit, in
      // scripts/supabase-form-limits.sql). The delay below alone doesn't
      // stop many guesses sent at once. Allowed if the check itself fails.
      const ip = (
        req.headers.get("cf-connecting-ip") ??
          req.headers.get("x-forwarded-for")?.split(",")[0] ??
          ""
      ).trim().slice(0, 64);
      const { data: allowed, error: limitError } = await createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        serviceKey,
      ).rpc("rate_limit", {
        p_key: `login:${ip || "unknown"}`,
        p_per_10m: LOGIN_ATTEMPTS_10M,
        p_per_day: LOGIN_ATTEMPTS_DAY,
      });
      if (limitError) console.error("Login rate check failed:", limitError);
      if (allowed === false) {
        return json(
          { error: "Too many attempts. Please wait a few minutes and try again." },
          429,
        );
      }
      const typedName = String(body.username ?? "").trim();
      const typedPassword = String(body.password ?? "");
      const wrong = async () => {
        // Slows down password guessing.
        await new Promise((r) => setTimeout(r, 800));
        return json({ error: "Wrong username or password" }, 401);
      };
      // The owner's backup login; the team signs in with Google.
      if (
        typedName.toLowerCase() === username.toLowerCase() &&
        safeEqual(typedPassword, password)
      ) {
        return json({ token: await makeToken(secret) });
      }
      return await wrong();
    }

    // "Sign in with Google": the owner's email(s), or an active team
    // member's. Same attempt limit as the password login.
    if (body.action === "google-login") {
      const ip = (
        req.headers.get("cf-connecting-ip") ??
          req.headers.get("x-forwarded-for")?.split(",")[0] ??
          ""
      ).trim().slice(0, 64);
      const users = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);
      const { data: allowed, error: limitError } = await users.rpc("rate_limit", {
        p_key: `login:${ip || "unknown"}`,
        p_per_10m: LOGIN_ATTEMPTS_10M,
        p_per_day: LOGIN_ATTEMPTS_DAY,
      });
      if (limitError) console.error("Login rate check failed:", limitError);
      if (allowed === false) {
        return json(
          { error: "Too many attempts. Please wait a few minutes and try again." },
          429,
        );
      }
      if (!Deno.env.get("GOOGLE_CLIENT_ID")) {
        return json({ error: "Google sign-in isn't set up yet." }, 500);
      }
      const email = await googleEmail(body.credential);
      if (!email) {
        return json({ error: "Please use your @wareinnovations.com Google account." }, 401);
      }
      if (ownerEmails().includes(email)) {
        return json({ token: await makeToken(secret) });
      }
      const { data: user } = await users
        .from("chat_users")
        .select("id, email, active")
        .ilike("email", email.replace(/[\\%_]/g, (c) => `\\${c}`))
        .maybeSingle();
      if (!user?.active) {
        return json({
          error: `${email} doesn't have access to Chats. Ask the owner to add you in Team.`,
        }, 403);
      }
      await users
        .from("chat_users")
        .update({ last_login_at: new Date().toISOString() })
        .eq("id", user.id);
      return json({ token: await makeToken(userSecret(secret, user.email), user.id) });
    }

    const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

    // Who's asking, and what they may do. A team login is looked up on
    // every call, so turning it off or changing its permissions applies
    // straight away.
    const token = readToken(body.token);
    let me: { id: string; name: string; username: string; owner: boolean; perms: Perms } | null = null;
    if (token?.uid === OWNER) {
      if (await tokenSignedWith(token, secret)) {
        me = { id: OWNER, name: ownerName(), username, owner: true, perms: ALL_PERMS };
      }
    } else if (token && UUID_RE.test(token.uid)) {
      const { data: user } = await db
        .from("chat_users")
        .select("*")
        .eq("id", token.uid)
        .maybeSingle();
      if (
        user?.active && user.email &&
        (await tokenSignedWith(token, userSecret(secret, user.email)))
      ) {
        me = {
          id: user.id,
          name: user.name || user.email,
          username: user.email,
          owner: false,
          perms: cleanPerms(user.permissions),
        };
      }
    }
    if (!me) {
      return json({ error: "Session expired, please log in again" }, 401);
    }
    const perms = me.perms;
    const notAllowed = () =>
      json({ error: "Your login isn't allowed to do that." }, 403);

    // Checked before each action below.
    const ACTION_NEEDS: Record<string, Permission> = {
      takeover: "reply",
      reply: "reply",
      label: "edit",
      "lead-draft": "draft",
      "lead-save": "edit",
      "lead-push": "zoho",
      delete: "delete",
      "users-list": "users",
      "quick-list": "reply",
      "quick-save": "reply",
      "quick-delete": "reply",
      "ai-reply": "aireply",
      "product-search": "reply",
      contacts: "people",
      products: "stats",
      gaps: "stats",
      "user-save": "users",
      "user-delete": "users",
    };
    const needed = ACTION_NEEDS[String(body.action)];
    if (needed && !perms[needed]) return notAllowed();
    // Stats, or the Carts section (which only gets the carts, below).
    if (body.action === "results" && !perms.stats && !perms.carts) {
      return notAllowed();
    }
    // Drafting fills the requirement box, so it needs edit too.
    if (body.action === "lead-draft" && !perms.edit) return notAllowed();
    // Only useful while replying, so it needs that too.
    if (body.action === "ai-reply" && !perms.reply) return notAllowed();
    if (body.action === "lead-options" && !perms.edit && !perms.zoho) {
      return notAllowed();
    }

    // The logged-in person and their permissions, for the page.
    if (body.action === "me") {
      return json({
        name: me.name,
        username: me.username,
        owner: me.owner,
        permissions: perms,
      });
    }

    // ---- Team logins (the Team section) ----
    if (body.action === "users-list") {
      const { data, error } = await db
        .from("chat_users")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205") {
          return json({ error: "Run scripts/supabase-chat-users.sql in Supabase first." }, 400);
        }
        throw error;
      }
      return json({
        owner: { name: ownerName(), emails: ownerEmails() },
        permissionNames: PERMISSIONS,
        users: (data ?? []).map((u) => ({
          id: u.id,
          email: u.email ?? "",
          name: u.name ?? "",
          permissions: cleanPerms(u.permissions),
          active: u.active,
          createdAt: u.created_at,
          lastLoginAt: u.last_login_at,
        })),
      });
    }

    // Adds a login (no id) or changes one: name, username, permissions,
    // on/off, and a new password if one is given.
    if (body.action === "user-save") {
      const u = body.user ?? {};
      const id = typeof u.id === "string" && UUID_RE.test(u.id) ? u.id : null;
      const email = String(u.email ?? "").trim().toLowerCase().slice(0, 120);
      if (!workEmail(email)) {
        return json({ error: `Use their @${ALLOWED_DOMAIN} Google email.` }, 400);
      }
      if (ownerEmails().includes(email)) {
        return json({ error: "That's the owner's email." }, 400);
      }
      if (id === me.id && u.active === false) {
        return json({ error: "You can't turn off your own login." }, 400);
      }
      const row: Record<string, unknown> = {
        email,
        // Kept filled for the table's older unique username column.
        username: email,
        name: String(u.name ?? "").trim().slice(0, 80) || null,
        permissions: cleanPerms(u.permissions),
        active: u.active !== false,
      };
      // Nobody hands out more than they have themselves.
      if (!me.owner) {
        for (const p of PERMISSIONS) {
          if ((row.permissions as Perms)[p] && !perms[p]) {
            return json({ error: "You can only give permissions you have yourself." }, 403);
          }
        }
      }
      const query = id
        ? db.from("chat_users").update(row).eq("id", id).select("id").single()
        : db.from("chat_users").insert(row).select("id").single();
      const { data, error } = await query;
      if (error) {
        if (error.code === "23505") {
          return json({ error: "That email is already on the team." }, 400);
        }
        if (error.code === "PGRST204" || error.code === "42703") {
          return json({ error: "Run scripts/supabase-chat-users.sql in Supabase again (it adds the email column)." }, 400);
        }
        if (error.code === "42P01" || error.code === "PGRST205") {
          return json({ error: "Run scripts/supabase-chat-users.sql in Supabase first." }, 400);
        }
        throw error;
      }
      return json({ ok: true, id: data.id });
    }

    if (body.action === "user-delete") {
      const id = String(body.id ?? "");
      if (!UUID_RE.test(id)) return json({ error: "Bad login id" }, 400);
      if (id === me.id) return json({ error: "You can't delete your own login." }, 400);
      const { error } = await db.from("chat_users").delete().eq("id", id);
      if (error) throw error;
      return json({ ok: true });
    }

    // ---- Saved messages for the reply box: each login's own list ----
    const MAX_QUICK = 50;
    const quickMissing = () =>
      json({ error: "Run scripts/supabase-quick-replies.sql in Supabase first." }, 400);
    if (body.action === "quick-list") {
      const { data, error } = await db
        .from("chat_quick_replies")
        .select("id, text")
        .eq("owner_key", me.id)
        .order("created_at", { ascending: true });
      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205") return quickMissing();
        throw error;
      }
      return json({ replies: data ?? [] });
    }
    if (body.action === "quick-save") {
      const text = String(body.text ?? "").trim().slice(0, 1000);
      if (!text) return json({ error: "Type the message to save." }, 400);
      const { count } = await db
        .from("chat_quick_replies")
        .select("id", { count: "exact", head: true })
        .eq("owner_key", me.id);
      if ((count ?? 0) >= MAX_QUICK) {
        return json({ error: `You can save up to ${MAX_QUICK} messages.` }, 400);
      }
      const { data, error } = await db
        .from("chat_quick_replies")
        .insert({ owner_key: me.id, text })
        .select("id, text")
        .single();
      if (error) {
        if (error.code === "42P01" || error.code === "PGRST205") return quickMissing();
        throw error;
      }
      return json({ reply: data });
    }
    if (body.action === "quick-delete") {
      const id = String(body.id ?? "");
      if (!UUID_RE.test(id)) return json({ error: "Bad id" }, 400);
      // Only ever one's own.
      const { error } = await db
        .from("chat_quick_replies")
        .delete()
        .eq("id", id)
        .eq("owner_key", me.id);
      if (error) throw error;
      return json({ ok: true });
    }

    // ---- The bot's instructions (the Bot section): owner login only ----
    // Not a permission: nobody else can be given it.
    if (String(body.action).startsWith("bot-") && !me.owner) {
      return notAllowed();
    }
    const MAX_RULES = 60;
    const MAX_RULE_CHARS = 400;
    const missingTable = (error: { code?: string } | null) =>
      error?.code === "42P01" || error?.code === "PGRST205";
    const liveRules = async () => {
      const { data, error } = await db
        .from("ai_guidelines")
        .select("id, rule, enabled, created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    };
    // Saves the whole set as a new version (the undo history).
    const saveVersion = async (
      rules: { rule: string; enabled: boolean }[],
      note: string,
    ) => {
      const { error } = await db.from("ai_guidelines_versions").insert({
        rules: rules.map((r) => ({ rule: r.rule, enabled: r.enabled })),
        note,
        created_by: me.name,
      });
      if (error && !missingTable(error)) throw error;
      return !error;
    };
    // Makes the live rules exactly `incoming` (in that order): changed ones
    // updated, new ones added, missing ones removed.
    const publishRules = async (
      incoming: { id?: string; rule: string; enabled: boolean }[],
    ) => {
      const current = await liveRules();
      const byId = new Map(current.map((r) => [r.id, r]));
      const keep = new Set<string>();
      let added = 0, changed = 0;
      const start = Date.now();
      for (const [i, r] of incoming.entries()) {
        // Spaced a millisecond apart so the order sticks.
        const createdAt = new Date(start - (incoming.length - i)).toISOString();
        const old = r.id ? byId.get(r.id) : undefined;
        if (old) {
          keep.add(old.id);
          if (old.rule !== r.rule || old.enabled !== r.enabled) changed++;
          const { error } = await db.from("ai_guidelines").update({
            rule: r.rule,
            enabled: r.enabled,
            created_at: createdAt,
            updated_at: new Date().toISOString(),
          }).eq("id", old.id);
          if (error) throw error;
        } else {
          added++;
          const { error } = await db.from("ai_guidelines").insert({
            rule: r.rule,
            original: r.rule,
            enabled: r.enabled,
            created_at: createdAt,
          });
          if (error) throw error;
        }
      }
      const gone = current.filter((r) => !keep.has(r.id)).map((r) => r.id);
      if (gone.length) {
        const { error } = await db.from("ai_guidelines").delete().in("id", gone);
        if (error) throw error;
      }
      return { added, changed, removed: gone.length };
    };
    const cleanRules = (raw: unknown) =>
      (Array.isArray(raw) ? raw : [])
        .map((r) => ({
          id: typeof r?.id === "string" && UUID_RE.test(r.id) ? r.id : undefined,
          rule: String(r?.rule ?? "").trim().slice(0, MAX_RULE_CHARS),
          enabled: r?.enabled !== false,
        }))
        .filter((r) => r.rule)
        .slice(0, MAX_RULES);

    if (body.action === "bot-get") {
      const rules = await liveRules();
      let { data: versions, error } = await db
        .from("ai_guidelines_versions")
        .select("id, note, created_by, created_at, rules")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error && !missingTable(error)) throw error;
      // The first visit: today's rules become the starting version.
      if (!error && !versions?.length && rules.length) {
        await saveVersion(rules, "Starting point");
        ({ data: versions } = await db
          .from("ai_guidelines_versions")
          .select("id, note, created_by, created_at, rules")
          .order("created_at", { ascending: false })
          .limit(30));
      }
      return json({
        rules: rules.map((r) => ({ id: r.id, rule: r.rule, enabled: r.enabled })),
        limits: { rules: MAX_RULES, chars: MAX_RULE_CHARS },
        // Null: scripts/supabase-bot-versions.sql not run yet.
        versions: error ? null : (versions ?? []).map((v) => ({
          id: v.id,
          note: v.note ?? "",
          by: v.created_by ?? "",
          at: v.created_at,
          rules: Array.isArray(v.rules) ? v.rules : [],
        })),
      });
    }

    if (body.action === "bot-save") {
      const incoming = cleanRules(body.rules);
      // Each one said in full (at least 5 words and 25 characters), so the
      // bot has something clear to follow. Only new or changed ones are
      // checked; older ones can stay as they are.
      const current = new Set((await liveRules()).map((r) => r.rule));
      const short = incoming.find((r) =>
        !current.has(r.rule) &&
        (r.rule.length < 25 || r.rule.split(/\s+/).length < 5)
      );
      if (short) {
        return json({
          error: "Write each instruction in full: at least 5 words and 25 characters.",
        }, 400);
      }
      const { added, changed, removed } = await publishRules(incoming);
      const note = [
        added && `added ${added}`,
        changed && `changed ${changed}`,
        removed && `removed ${removed}`,
      ].filter(Boolean).join(", ") || "no changes";
      await saveVersion(incoming, note[0].toUpperCase() + note.slice(1));
      return json({ ok: true });
    }

    if (body.action === "bot-restore") {
      const id = String(body.id ?? "");
      if (!UUID_RE.test(id)) return json({ error: "Bad version id" }, 400);
      const { data: version, error } = await db
        .from("ai_guidelines_versions")
        .select("rules, created_at")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!version) return json({ error: "That version is gone." }, 404);
      // Rules that are still live keep their row; the rest come back new.
      const current = await liveRules();
      const unused = [...current];
      const incoming = cleanRules(version.rules).map((r) => {
        const i = unused.findIndex((c) => c.rule === r.rule);
        return i >= 0 ? { ...r, id: unused.splice(i, 1)[0].id } : r;
      });
      await publishRules(incoming);
      const when = new Date(version.created_at).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      });
      await saveVersion(incoming, `Went back to the version from ${when}`);
      return json({ ok: true });
    }

    // Asks the bot a question with the page's unsaved rules, without
    // publishing them or logging a chat (through ask-faq, with the service
    // role key so it accepts the draft).
    if (body.action === "bot-try") {
      const question = String(body.question ?? "").trim().slice(0, 500);
      if (!question) return json({ error: "Type a question to try." }, 400);
      const history = (Array.isArray(body.history) ? body.history : [])
        .slice(-6)
        .map((t: { question?: unknown; answer?: unknown }) => ({
          question: String(t?.question ?? "").slice(0, 1000),
          answer: String(t?.answer ?? "").slice(0, 1000),
          products: [],
        }));
      const base = Deno.env.get("ASK_FAQ_URL") ??
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/ask-faq`;
      const res = await fetch(base, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          // ask-faq only answers the store and this site.
          Origin: "https://tancy-ux.github.io",
        },
        body: JSON.stringify({
          question,
          history,
          draftGuidelines: cleanRules(body.rules)
            .filter((r) => r.enabled)
            .map((r) => r.rule),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.answer) {
        return json({ error: data.error ?? "The bot didn't answer. Try again." }, 502);
      }
      return json({
        answer: data.answer,
        products: (Array.isArray(data.products) ? data.products : [])
          .slice(0, 6)
          .map((p: { title?: string; url?: string }) => ({ title: p.title, url: p.url })),
      });
    }

    // The Chats page's date filter: conversations active in [since, until)
    // (either end optional, ISO timestamps).
    const since = validDate(body.since);
    const until = validDate(body.until);

    if (body.action === "list") {
      let query = db
        .from("chat_conversations")
        // "*" rather than a column list, so this keeps working whether or
        // not last_question has been added to the table yet.
        .select("*, chat_messages(count)")
        .order("last_message_at", { ascending: false })
        .limit(LIST_LIMIT);
      if (since) query = query.gte("last_message_at", since);
      if (until) query = query.lt("last_message_at", until);
      const { data, error } = await query;
      if (error) throw error;
      const [numbers, waiting] = await Promise.all([
        dailyNumbers(db, data ?? []),
        awaitingTeam(
          db,
          (data ?? []).filter((c) => takeoverActive(c.takeover_at)).map((c) => c.id),
        ),
      ]);

      return json({
        conversations: (data ?? []).map((c) => ({
          id: c.id,
          visitorId: c.visitor_id,
          visitorName: c.visitor_name ? nameCase(c.visitor_name) : null,
          company: c.company,
          // Only for logins allowed to see contact details.
          visitorPhone: perms.contacts ? c.visitor_phone ?? null : null,
          // A logged-in store customer's account (scripts/supabase-chat-account.sql).
          accountName: c.account_name ?? null,
          accountPhone: perms.contacts ? c.account_phone ?? null : null,
          accountEmail: perms.contacts ? c.account_email ?? null : null,
          shopifyCustomerId: c.shopify_customer_id ?? null,
          // The "Lead" card (scripts/supabase-zoho-leads.sql).
          visitorEmail: perms.contacts ? c.visitor_email ?? null : null,
          requirement: c.requirement ?? null,
          leadProducts: c.lead_products ?? null,
          clientType: c.client_type ?? null,
          zohoLeadId: c.zoho_lead_id ?? null,
          zohoLeadAt: c.zoho_lead_at ?? null,
          zohoUrl: c.zoho_lead_id ? `${ZOHO_CRM}/tab/Leads/${c.zoho_lead_id}` : null,
          // "Visitor 12" (scripts/supabase-visitor-numbers.sql); null until
          // that's been run.
          // Daily: "Visitor 3" of visitorDay (see dailyNumbers).
          visitorNumber: numbers.get(c.id) ?? null,
          visitorDay: istDay(c.started_at),
          // Store pages (scripts/supabase-chat-pages.sql); null before that.
          firstPage: c.first_page ?? null,
          lastPage: c.last_page ?? null,
          label: c.label,
          startedAt: c.started_at,
          lastMessageAt: c.last_message_at,
          // deno-lint-ignore no-explicit-any
          messageCount: (c.chat_messages as any)?.[0]?.count ?? 0,
          // Latest question; older chats from before that column existed
          // fall back to their first one.
          preview: (perms.contacts ? (x: string) => x : hideContacts)(
            c.last_question ?? c.first_question ?? "",
          ),
          hasContact: !!(c.visitor_phone || c.visitor_email),
          takeover: takeoverActive(c.takeover_at),
          needsReply: waiting.has(c.id),
          // scripts/supabase-chat-insights.sql; null before that's run.
          topic: c.topic ?? null,
          interest: c.interest ?? null,
          device: c.device ?? null,
          cart: c.cart ?? null,
          // From the team's own site, not a store visitor.
          internal: c.source === "internal",
        })),
      });
    }

    // Search every message (what visitors asked and what was replied), for
    // the Chats page's search box. Returns the latest matching line of each
    // conversation, trimmed to the part around the match.
    if (body.action === "search") {
      const query = String(body.query ?? "").trim().slice(0, 100);
      if (query.length < 2) return json({ matches: [] });
      // % and _ are wildcards in LIKE; search for them literally.
      const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const [asked, answered] = await Promise.all(
        ["question", "answer"].map((column) => {
          let q = db
            .from("chat_messages")
            .select("conversation_id, question, answer, created_at")
            .ilike(column, pattern)
            .order("created_at", { ascending: false })
            .limit(300);
          if (since) q = q.gte("created_at", since);
          if (until) q = q.lt("created_at", until);
          return q;
        }),
      );
      if (asked.error) throw asked.error;
      if (answered.error) throw answered.error;
      const rows = [...(asked.data ?? []), ...(answered.data ?? [])].sort(
        (a, b) => b.created_at.localeCompare(a.created_at),
      );
      const needle = query.toLowerCase();
      const snippet = (text: string) => {
        const at = text.toLowerCase().indexOf(needle);
        if (at < 0) return text.slice(0, 90);
        const start = Math.max(0, at - 35);
        const end = Math.min(text.length, at + needle.length + 55);
        return `${start > 0 ? "…" : ""}${text.slice(start, end)}${
          end < text.length ? "…" : ""
        }`;
      };
      const matches: { conversationId: string; text: string }[] = [];
      const seen = new Set<string>();
      for (const r of rows) {
        if (seen.has(r.conversation_id)) continue;
        seen.add(r.conversation_id);
        const inQuestion = (r.question ?? "").toLowerCase().includes(needle);
        const text = snippet(inQuestion ? r.question : r.answer ?? "");
        matches.push({
          conversationId: r.conversation_id,
          text: perms.contacts ? text : hideContacts(text),
        });
      }
      return json({ matches });
    }

    if (body.action === "messages") {
      if (!UUID_RE.test(String(body.conversationId))) {
        return json({ error: "Bad conversation id" }, 400);
      }
      // "*" so this works before and after the `sender` column exists.
      const { data, error } = await db
        .from("chat_messages")
        .select("*")
        .eq("conversation_id", body.conversationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      const { data: convo } = await db
        .from("chat_conversations")
        .select("*")
        .eq("id", body.conversationId)
        .maybeSingle();
      // Older messages' products have no photo saved: look them up.
      // deno-lint-ignore no-explicit-any
      const needPhotos = (data ?? []).some((m) =>
        (m.products ?? []).some((p: any) => p?.url && !p.image)
      );
      const images = needPhotos
        ? (await storeCatalog(db).catch(() => EMPTY_CATALOG)).products
        : null;
      return json({
        messages: (data ?? []).map((m) => ({
          id: m.id,
          question: perms.contacts ? m.question : hideContacts(m.question),
          answer: perms.contacts ? m.answer : hideContacts(m.answer),
          products: images
            // deno-lint-ignore no-explicit-any
            ? (m.products ?? []).map((p: any) =>
              p?.image || !p?.url
                ? p
                : { ...p, image: images.get(handleOf(p.url))?.image ?? null }
            )
            : m.products,
          created_at: m.created_at,
          sender: m.sender ?? "ai",
          // The team member who sent a team reply.
          agentName: m.agent_name ?? null,
          page: m.page ?? null,
          // What the chat showed under the reply (links, buttons, forms).
          extras: Array.isArray(m.extras) ? m.extras : [],
        })),
        takeover: takeoverActive(convo?.takeover_at),
      });
    }

    // Take a chat over from the AI (it stops answering) or hand it back.
    if (body.action === "takeover") {
      if (!UUID_RE.test(String(body.conversationId))) {
        return json({ error: "Bad conversation id" }, 400);
      }
      const { error } = await db
        .from("chat_conversations")
        .update({ takeover_at: body.on ? new Date().toISOString() : null })
        .eq("id", body.conversationId);
      if (error) {
        if (error.code === "PGRST204") {
          return json({ error: "Run the latest chat SQL script first" }, 400);
        }
        throw error;
      }
      return json({ ok: true, takeover: !!body.on });
    }

    // A team member's reply during a takeover. The customer's chat window
    // picks it up on its next check (ask-faq "updates").
    if (body.action === "reply") {
      if (!UUID_RE.test(String(body.conversationId))) {
        return json({ error: "Bad conversation id" }, 400);
      }
      const text = String(body.text ?? "").trim().slice(0, 2000);
      if (!text) return json({ error: "Empty reply" }, 400);
      // Products from "AI reply" the team member kept: only real store
      // products (the shopper's chat rebuilds the cards from the live
      // catalogue anyway).
      const picked = (Array.isArray(body.products) ? body.products : []).slice(0, 6);
      const catalog = picked.length ? await storeCatalog(db).catch(() => EMPTY_CATALOG) : EMPTY_CATALOG;
      const products = picked
        // deno-lint-ignore no-explicit-any
        .map((p: any) => {
          const handle = handleOf(String(p?.url ?? ""));
          const item = handle ? catalog.products.get(handle) : null;
          if (!item) return null;
          return {
            title: item.title,
            url: `${STORE_URL}/products/${handle}`,
            image: item.image,
            price: typeof p.price === "string" ? p.price.slice(0, 40) : null,
            available: p.available !== false,
          };
        })
        .filter(Boolean);
      const { data: convo, error: convoError } = await db
        .from("chat_conversations")
        .select("*")
        .eq("id", body.conversationId)
        .maybeSingle();
      if (convoError) throw convoError;
      if (!takeoverActive(convo?.takeover_at)) {
        return json({ error: "Take over the chat first" }, 400);
      }
      // Who's replying, shown to the shopper and in Chats.
      const agentName = me.name;
      const row = {
        conversation_id: body.conversationId,
        question: "",
        answer: text,
        sender: "agent",
        agent_name: agentName,
        ...(products.length ? { products } : {}),
      };
      const insertReply = (r: Record<string, unknown>) =>
        db.from("chat_messages").insert(r).select().single();
      let { data, error } = await insertReply(row);
      // Before scripts/supabase-chat-users.sql added agent_name.
      if (error?.code === "PGRST204") {
        const { agent_name: _, ...rest } = row;
        ({ data, error } = await insertReply(rest));
      }
      if (error) throw error;
      await db
        .from("chat_conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", body.conversationId);
      return json({
        message: {
          id: data.id,
          question: "",
          answer: data.answer,
          products: data.products ?? [],
          created_at: data.created_at,
          sender: "agent",
          agentName: data.agent_name ?? null,
        },
      });
    }

    // "+ Product" in the reply box: store products by name (no AI), in
    // stock first. Every word typed must be in the title.
    if (body.action === "product-search") {
      const words = String(body.query ?? "").toLowerCase().trim().slice(0, 80)
        .split(/\s+/).filter(Boolean);
      if (!words.length || words.join("").length < 2) return json({ products: [] });
      const catalog = await storeCatalog(db).catch(() => EMPTY_CATALOG);
      const found = [...catalog.products]
        .filter(([, p]) => words.every((w) => p.title.toLowerCase().includes(w)))
        .sort(([, a], [, b]) =>
          Number(b.available !== false) - Number(a.available !== false) ||
          a.title.length - b.title.length
        )
        .slice(0, 12)
        .map(([handle, p]) => ({
          title: p.title,
          url: `${STORE_URL}/products/${handle}`,
          image: p.image,
          price: p.price ?? null,
          available: p.available !== false,
        }));
      return json({ products: found });
    }

    // "AI reply" during a takeover: what the bot would say to the shopper's
    // latest message(s), as a draft for the team member to edit and send.
    // Nothing is saved or sent to the shopper here.
    if (body.action === "ai-reply") {
      if (!UUID_RE.test(String(body.conversationId))) {
        return json({ error: "Bad conversation id" }, 400);
      }
      const [{ data: rows, error }, { data: convo }] = await Promise.all([
        db.from("chat_messages").select("*").eq("conversation_id", body.conversationId)
          .order("created_at", { ascending: true }),
        db.from("chat_conversations").select("*").eq("id", body.conversationId).maybeSingle(),
      ]);
      if (error) throw error;
      // Since they last started over.
      const all = rows ?? [];
      const lastReset = all.findLastIndex((m) =>
        m.sender === "system" && /reset/i.test(m.answer ?? "")
      );
      const msgs = all.slice(lastReset + 1).filter((m) => m.sender !== "system");
      // Their latest message is what to answer; everything before it (their
      // other unanswered messages included) is the history the bot reads.
      const at = msgs.findLastIndex((m) => m.question?.trim());
      if (at < 0) return json({ error: "They haven't asked anything yet." }, 400);
      const question = String(msgs[at].question).trim();
      const history = msgs.slice(0, at).slice(-10).map((m) => ({
        question: String(m.question ?? "").slice(0, 1000),
        answer: String(m.answer ?? "").slice(0, 1000),
        // deno-lint-ignore no-explicit-any
        products: (m.products ?? []).map((p: any) => p?.title).filter(Boolean),
        fromTeam: m.sender === "agent",
      }));
      const base = Deno.env.get("ASK_FAQ_URL") ??
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/ask-faq`;
      const res = await fetch(base, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          Origin: "https://tancy-ux.github.io",
        },
        body: JSON.stringify({
          // The bot's own limit per message.
          question: question.slice(0, 500),
          history,
          teamDraft: {
            name: convo?.visitor_name || convo?.account_name || "",
            contactSaved: !!convo?.visitor_phone,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      // `fallback`: one of the bot's stand-in messages (busy, too long), not
      // a reply worth sending.
      if (!res.ok || !data.answer || data.fallback) {
        return json({ error: data.error ?? "The AI couldn't write a reply just now. Try again." }, 502);
      }
      return json({
        answer: data.answer,
        products: (Array.isArray(data.products) ? data.products : [])
          .slice(0, 6)
          // deno-lint-ignore no-explicit-any
          .map((p: any) => ({
            title: p.title,
            url: p.url,
            image: p.image ?? null,
            price: typeof p.price === "string" ? p.price.replace(/^Rs\.?\s*/, "₹") : null,
            available: p.available !== false,
          })),
      });
    }

    // The Chats page's Results panel, for the same date range as the list.
    if (body.action === "results") {
      const loadOrders = () => cachedOrders(since, until, !!body.fresh);
      let chatsQuery = db
        .from("chat_conversations")
        // "*": works before and after first_page / topic exist. The count
        // is each chat's turns, for "had a real conversation".
        .select("*, chat_messages(count)");
      if (since) chatsQuery = chatsQuery.gte("last_message_at", since);
      if (until) chatsQuery = chatsQuery.lt("last_message_at", until);
      const [{ data: allChats, error }, shop, catalog] = await Promise.all([
        chatsQuery.limit(LIST_LIMIT),
        loadOrders().catch((err) => ({ error: String(err) })),
        storeCatalog(db).catch(() => EMPTY_CATALOG),
      ]);
      if (error) throw error;
      // "Hide test and junk chats" (on unless turned off).
      const hideTest = body.hideTest !== false;
      const chats = (allChats ?? []).filter((c) => !hideTest || !isTestChat(c));
      // Without orders (Shopify down, or no token, as in a local run) the
      // chat and page numbers still show, with a note about the orders.
      let ordersError: string | null = null;
      if ("error" in shop) {
        console.error(shop.error);
        ordersError = /access|scope|denied|401|403/i.test(shop.error)
          ? "The Shopify token can't read orders yet (needs read_orders)."
          : /isn't set/.test(shop.error)
          ? "Orders need the Shopify token, which isn't set here."
          : "Couldn't load orders from Shopify just now.";
      }
      const shopOrders = "error" in shop
        ? { orders: [] as Awaited<ReturnType<typeof chatOrders>>["orders"], scanned: 0 }
        : shop;
      // Which chat each order came from ("Visitor 12" / their name). The
      // chat may be outside the date range, so look those up by ID.
      const ids = [...new Set(shopOrders.orders.map((o) => o.visitorId).filter(Boolean))];
      const { data: linked } = ids.length
        ? await db
          .from("chat_conversations")
          .select("id, visitor_id, visitor_name, company, label, started_at")
          .in("visitor_id", ids)
        : { data: [] };
      const linkedNumbers = await dailyNumbers(db, linked ?? []);
      // An order counts unless every chat from its browser is a test one.
      const realVisitors = new Set(
        (linked ?? []).filter((c) => !isTestChat(c)).map((c) => c.visitor_id),
      );
      const orders = shopOrders.orders.filter((o) =>
        !hideTest || !o.visitorId || realVisitors.has(o.visitorId) ||
        !(linked ?? []).some((c) => c.visitor_id === o.visitorId)
      );
      // Each order's chat: a real one over a test one from the same browser.
      const byVisitor = new Map<string, NonNullable<typeof linked>[number]>();
      for (const c of linked ?? []) {
        if (!byVisitor.has(c.visitor_id) || !isTestChat(c)) {
          byVisitor.set(c.visitor_id, c);
        }
      }
      const counted = orders.filter((o) => !o.cancelled);
      // deno-lint-ignore no-explicit-any
      const turns = (c: any) => c.chat_messages?.[0]?.count ?? 0;

      // Where chats start: chats per first page, with the product's or
      // collection's real name and photo when it is one.
      const startCounts = new Map<string, number>();
      for (const c of chats) {
        if (c.first_page) {
          startCounts.set(c.first_page, (startCounts.get(c.first_page) ?? 0) + 1);
        }
      }
      const askCounts = new Map<string, number>();
      for (const c of chats) {
        const label = askedAbout(c);
        askCounts.set(label, (askCounts.get(label) ?? 0) + 1);
      }

      // Who had something in their cart when they last chatted (the
      // chat reads the shopper's cart), biggest cart first. Only for
      // logins allowed to see carts; left out otherwise.
      let carts: unknown[] | undefined;
      if (perms.carts) {
        const withCart = chats
          .filter((c) => c.cart && !/^empty$/i.test(c.cart))
          .sort((a, b) =>
            cartValue(b.cart) - cartValue(a.cart) ||
            String(b.last_message_at).localeCompare(String(a.last_message_at))
          );
        const numbers = await dailyNumbers(db, withCart);
        const orderedBy = new Set(counted.map((o) => o.visitorId).filter(Boolean));
        carts = withCart.map((c) => ({
          conversationId: c.id,
          // The date is in "Last chatted"; the browser's short id tells
          // same-numbered visitors apart.
          title: c.label || (c.visitor_name && nameCase(c.visitor_name)) ||
            `Visitor ${numbers.get(c.id) ?? ""}`,
          tag: `#${String(c.visitor_id ?? "").slice(0, 6)}`,
          cart: c.cart,
          value: cartValue(c.cart),
          lastAt: c.last_message_at,
          page: c.last_page ?? null,
          lead: !!(c.visitor_phone || c.visitor_email),
          ordered: orderedBy.has(c.visitor_id),
        }));
      }

      const value = {
        carts,
        chats: chats.length,
        realChats: chats.filter((c) => turns(c) >= 2).length,
        leads: chats.filter((c) => c.visitor_phone).length,
        // People (browsers) who ordered, and their orders.
        ordered: new Set(counted.map((o) => o.visitorId).filter(Boolean)).size,
        orders: counted.length,
        revenue: counted.reduce((s, o) => s + o.total, 0),
        fromChatOrders: counted.filter((o) => o.fromChatTotal > 0).length,
        fromChatRevenue: counted.reduce((s, o) => s + o.fromChatTotal, 0),
        hiddenTest: (allChats ?? []).length - chats.length,
        pages: [...startCounts].map(([page, n]) => {
          const item = catalogItem(catalog, page);
          return {
            page,
            chats: n,
            title: item?.title ?? null,
            image: item?.image ?? null,
          };
        }),
        askedAbout: [...askCounts]
          .map(([label, n]) => ({ label, chats: n }))
          .sort((a, b) => b.chats - a.chats),
        ordersScanned: shopOrders.scanned,
        trackingFrom: TRACKING_FROM,
        ordersError,
        list: orders.map((o) => {
          const c = o.visitorId ? byVisitor.get(o.visitorId) : null;
          return {
            ...o,
            conversationId: c?.id ?? null,
            chatTitle: c
              ? c.label || (c.visitor_name && nameCase(c.visitor_name)) ||
                `Visitor ${linkedNumbers.get(c.id) ?? ""} · ${
                  new Date(c.started_at).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    timeZone: "Asia/Kolkata",
                  })
                }`
              : null,
          };
        }),
      };
      // A carts-only login gets just the carts.
      if (!perms.stats) {
        return json({ carts: value.carts, hiddenTest: value.hiddenTest });
      }
      return json(value);
    }

    // ---- Contacts: one row per person who left a phone or email ----
    // Chats with the same phone (last 10 digits) or email are one person,
    // even across browsers. Only people last seen in the date range.
    if (body.action === "contacts") {
      const { data, error } = await db
        .from("chat_conversations")
        .select("*, chat_messages(count)")
        .or("visitor_phone.not.is.null,visitor_email.not.is.null,account_phone.not.is.null,account_email.not.is.null")
        .order("last_message_at", { ascending: false })
        .limit(LIST_LIMIT);
      if (error) {
        // Before scripts/supabase-chat-account.sql: without the account columns.
        if (!/account_/.test(error.message ?? "")) throw error;
      }
      const rows = (data ?? (await db
        .from("chat_conversations")
        .select("*, chat_messages(count)")
        .or("visitor_phone.not.is.null,visitor_email.not.is.null")
        .order("last_message_at", { ascending: false })
        .limit(LIST_LIMIT)).data ?? [])
        .filter((c) => c.source !== "internal" && !isTestChat(c));

      // Group chats into people: any shared phone or email joins them.
      const parent = rows.map((_, i) => i);
      const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
      const owner = new Map<string, number>();
      rows.forEach((c, i) => {
        const keys = [
          phoneKey(c.visitor_phone) && `p:${phoneKey(c.visitor_phone)}`,
          phoneKey(c.account_phone) && `p:${phoneKey(c.account_phone)}`,
          c.visitor_email && `e:${String(c.visitor_email).toLowerCase()}`,
          c.account_email && `e:${String(c.account_email).toLowerCase()}`,
        ].filter(Boolean) as string[];
        for (const k of keys) {
          const j = owner.get(k);
          if (j === undefined) owner.set(k, i);
          else parent[find(i)] = find(j);
        }
      });
      const groups = new Map<number, typeof rows>();
      rows.forEach((c, i) => {
        const g = find(i);
        groups.set(g, [...(groups.get(g) ?? []), c]);
      });

      // Who the team has written to (a reply in any of their chats).
      const replied = new Set(
        (await messagesOf(db, rows.map((c) => c.id), "conversation_id", (q) =>
          q.eq("sender", "agent")
        )).map((m) => m.conversation_id),
      );
      // Who ordered (from the same browser, since tracking began).
      let ordersError: string | null = null;
      const orderedBy = new Set<string>();
      try {
        for (const o of (await cachedOrders(null, null, !!body.fresh)).orders) {
          if (!o.cancelled && o.visitorId) orderedBy.add(o.visitorId);
        }
      } catch (err) {
        console.error(err);
        ordersError = "Couldn't check Shopify orders just now.";
      }

      const people = [...groups.values()].map((chats) => {
        // Newest first (the query's order).
        const latest = chats[0];
        const first = (pick: (c: (typeof chats)[number]) => unknown) =>
          chats.map(pick).find((v) => typeof v === "string" && v.trim()) as string | undefined;
        const from = [
          chats.some((c) => (c.visitor_phone || c.visitor_email) &&
            !/^Ware Atelier/.test(c.topic ?? "")) && "Chat",
          chats.some((c) => /^Ware Atelier/.test(c.topic ?? "") && c.visitor_phone) &&
          "Atelier form",
          chats.some((c) => c.account_phone || c.account_email) && "Store account",
        ].filter(Boolean);
        const cartChat = chats.find((c) => c.cart);
        return {
          conversationId: latest.id,
          name: (first((c) => c.visitor_name) && nameCase(first((c) => c.visitor_name)!)) ||
            first((c) => c.account_name) || null,
          company: first((c) => c.company) ?? null,
          // Only with "See phone numbers & emails" too.
          phone: perms.contacts
            ? first((c) => c.visitor_phone) ?? first((c) => c.account_phone) ?? null
            : null,
          email: perms.contacts
            ? (first((c) => c.visitor_email) ?? first((c) => c.account_email) ?? "")
              .toLowerCase() || null
            : null,
          from,
          chats: chats.length,
          firstAt: chats[chats.length - 1].started_at,
          lastAt: latest.last_message_at,
          topic: first((c) => c.topic) ?? null,
          askedAbout: askedAbout(latest),
          // Their latest known cart.
          cart: cartChat?.cart ?? null,
          cartValue: cartValue(cartChat?.cart),
          ordered: ordersError ? null : chats.some((c) => orderedBy.has(c.visitor_id)),
          zohoUrl: chats.find((c) => c.zoho_lead_id)
            ? `${ZOHO_CRM}/tab/Leads/${chats.find((c) => c.zoho_lead_id).zoho_lead_id}`
            : null,
          replied: chats.some((c) => replied.has(c.id)),
        };
      }).filter((p) =>
        (!since || p.lastAt >= since) && (!until || p.lastAt < until)
      );
      return json({ contacts: people, ordersError, canDownload: me.owner });
    }

    // ---- Products: what the bot showed, what they looked at, what sold ----
    if (body.action === "products") {
      let chatsQuery = db
        .from("chat_conversations")
        .select("id, visitor_id, visitor_name, company, label, source");
      if (since) chatsQuery = chatsQuery.gte("last_message_at", since);
      if (until) chatsQuery = chatsQuery.lt("last_message_at", until);
      const [{ data: allChats, error }, catalog, shop] = await Promise.all([
        chatsQuery.limit(LIST_LIMIT),
        storeCatalog(db).catch(() => EMPTY_CATALOG),
        cachedOrders(since, until, !!body.fresh).catch((err) => ({ error: String(err) })),
      ]);
      if (error) throw error;
      const hideTest = body.hideTest !== false;
      const chats = (allChats ?? []).filter((c) => !hideTest || !isTestChat(c));
      const messages = await messagesOf(db, chats.map((c) => c.id), "conversation_id, products, page");

      type Row = { handle: string; title: string; image: string | null; price: string | null;
        shown: Set<string>; onPage: Set<string>; ordered: number; orderedValue: number };
      const rows = new Map<string, Row>();
      const row = (handle: string, title = "", image: string | null = null) => {
        if (!rows.has(handle)) {
          const item = catalog.products.get(handle);
          rows.set(handle, {
            handle,
            title: item?.title ?? title ?? handle,
            image: item?.image ?? image,
            price: null,
            shown: new Set(),
            onPage: new Set(),
            ordered: 0,
            orderedValue: 0,
          });
        }
        return rows.get(handle)!;
      };
      for (const m of messages) {
        // deno-lint-ignore no-explicit-any
        for (const p of (m.products ?? []) as any[]) {
          const handle = p?.url ? handleOf(p.url) : "";
          if (!handle) continue;
          const r = row(handle, p.title, p.image ?? null);
          r.shown.add(m.conversation_id);
          if (p.price) r.price = String(p.price).replace(/^Rs\.?\s*/, "₹");
        }
        const onPage = m.page ? handleOf(m.page) : "";
        if (onPage && catalog.products.has(onPage)) row(onPage).onPage.add(m.conversation_id);
      }
      // Items added with the chat's + button, then ordered.
      const byTitle = new Map(
        [...catalog.products].map(([handle, p]) => [p.title.toLowerCase(), handle]),
      );
      if (!("error" in shop)) {
        for (const o of shop.orders) {
          if (o.cancelled) continue;
          for (const item of o.fromChatItems ?? []) {
            const handle = byTitle.get(item.title.toLowerCase()) ??
              [...rows.values()].find((r) => r.title.toLowerCase() === item.title.toLowerCase())?.handle;
            const r = handle ? row(handle) : row(`title:${item.title}`, item.title);
            r.ordered += item.quantity;
            r.orderedValue += item.amount;
          }
        }
      }
      return json({
        products: [...rows.values()].map((r) => ({
          handle: r.handle.startsWith("title:") ? null : r.handle,
          title: r.title,
          image: r.image,
          price: r.price,
          shown: r.shown.size,
          onPage: r.onPage.size,
          ordered: r.ordered,
          orderedValue: r.orderedValue,
        })),
        ordersError: "error" in shop ? "Couldn't load Shopify orders just now." : null,
      });
    }

    // ---- Couldn't answer: bot replies that didn't help ----
    // The bot said it didn't know, or sent them to the team on WhatsApp
    // when they hadn't asked for a person. Same question, one row.
    if (body.action === "gaps") {
      let chatsQuery = db
        .from("chat_conversations")
        .select("id, visitor_id, visitor_name, company, label, source");
      if (since) chatsQuery = chatsQuery.gte("last_message_at", since);
      if (until) chatsQuery = chatsQuery.lt("last_message_at", until);
      const { data: allChats, error } = await chatsQuery.limit(LIST_LIMIT);
      if (error) throw error;
      const hideTest = body.hideTest !== false;
      const chats = (allChats ?? []).filter((c) => !hideTest || !isTestChat(c));
      const messages = await messagesOf(
        db,
        chats.map((c) => c.id),
        "conversation_id, question, answer, created_at, sender, extras",
      );
      const groups = new Map<string, {
        question: string; answer: string; why: string; count: number;
        lastAt: string; conversationId: string; chats: Set<string>;
      }>();
      for (const m of messages) {
        if ((m.sender ?? "ai") !== "ai" || !m.question?.trim() || !m.answer) continue;
        const handedOn = Array.isArray(m.extras) && m.extras.includes("whatsapp") &&
          !WANTS_PERSON_RE.test(m.question);
        const didntKnow = DIDNT_KNOW_RE.test(m.answer) && !DIDNT_UNDERSTAND_RE.test(m.answer);
        if (!handedOn && !didntKnow) continue;
        const key = m.question.trim().toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ");
        const g = groups.get(key);
        const tidy = (t: string) => (perms.contacts ? t : hideContacts(t));
        if (!g || m.created_at > g.lastAt) {
          groups.set(key, {
            question: tidy(m.question.trim()).slice(0, 300),
            answer: tidy(m.answer).slice(0, 400),
            why: didntKnow ? "Didn't know" : "Sent to WhatsApp",
            count: (g?.count ?? 0) + 1,
            lastAt: m.created_at,
            conversationId: m.conversation_id,
            chats: new Set([...(g?.chats ?? []), m.conversation_id]),
          });
        } else {
          g.count++;
          g.chats.add(m.conversation_id);
        }
      }
      return json({
        gaps: [...groups.values()]
          .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
          .slice(0, 300)
          .map(({ chats: c, ...g }) => ({ ...g, chats: c.size })),
        canTeach: me.owner,
      });
    }

    // ---- The "Lead" card (Zoho CRM) ----
    // lead-options: Zoho's "Type of client" choices (and whether Zoho is
    // connected at all).
    if (body.action === "lead-options") {
      try {
        const fields = await zohoLeadFields();
        return json({
          connected: true,
          clientTypes: fields.clientTypes,
          // Which Zoho fields the card fills (null = not found in Leads).
          fields: {
            requirement: fields.requirement,
            products: fields.products,
            clientType: fields.clientType,
            leadSource: fields.leadSource,
          },
          leadSource: fields.leadSource,
          leadSourceListed: fields.leadSourceListed,
        });
      } catch (err) {
        return json({
          connected: false,
          clientTypes: [],
          message: err instanceof ZohoError ? err.message : "Zoho isn't reachable.",
        });
      }
    }

    if (["lead-draft", "lead-save", "lead-push"].includes(body.action)) {
      if (!UUID_RE.test(String(body.conversationId))) {
        return json({ error: "Bad conversation id" }, 400);
      }
      const { data: convo, error: convoError } = await db
        .from("chat_conversations")
        .select("*")
        .eq("id", body.conversationId)
        .maybeSingle();
      if (convoError) throw convoError;
      if (!convo) return json({ error: "Chat not found" }, 404);
      if (!("requirement" in convo)) {
        return json(
          { error: "Run scripts/supabase-zoho-leads.sql in Supabase first." },
          400,
        );
      }

      // The AI's summary of the chat, for the team to check and edit.
      if (body.action === "lead-draft") {
        const { data: msgs, error } = await db
          .from("chat_messages")
          .select("question, answer, sender")
          .eq("conversation_id", convo.id)
          .order("created_at", { ascending: true });
        if (error) throw error;
        const transcript = (msgs ?? [])
          .filter((m) => m.sender !== "system")
          .map((m) =>
            [
              m.question && `Shopper: ${m.question}`,
              m.answer && `${m.sender === "agent" ? "Ware team" : "Assistant"}: ${m.answer}`,
            ].filter(Boolean).join("\n")
          )
          .join("\n");
        if (!transcript.trim()) return json({ error: "This chat is empty." }, 400);
        const draft = await draftRequirement(transcript);
        if (!draft) return json({ error: "Couldn't draft it just now. Try again." }, 502);
        return json(draft);
      }

      // What's typed in the card, saved on the chat (name and phone are the
      // same ones the chat's details form fills).
      const clean = (v: unknown, max: number) =>
        typeof v === "string" ? v.trim().slice(0, max) : undefined;
      const edits: Record<string, string | null> = {};
      const fields: [string, string, number][] = [
        ["name", "visitor_name", 100],
        ["phone", "visitor_phone", 30],
        ["email", "visitor_email", 120],
        ["requirement", "requirement", 1000],
        ["products", "lead_products", 500],
        ["clientType", "client_type", 100],
      ];
      for (const [key, column, max] of fields) {
        // A login that can't see phone numbers and emails gets them blank,
        // so its blanks never replace the saved ones (Send to Zoho still
        // uses the saved ones).
        if (!perms.contacts && (key === "phone" || key === "email")) continue;
        // Sending to Zoho without the edit permission sends what's saved.
        if (!perms.edit) continue;
        const v = clean(body.lead?.[key], max);
        if (v !== undefined) {
          edits[column] = (column === "visitor_name" ? nameCase(v) : v) || null;
        }
      }
      if (edits.visitor_email && !EMAIL_RE.test(edits.visitor_email)) {
        return json({ error: "That email doesn't look right." }, 400);
      }
      if (Object.keys(edits).length) {
        const { error } = await db
          .from("chat_conversations")
          .update(edits)
          .eq("id", convo.id);
        if (error) throw error;
      }
      const lead = { ...convo, ...edits };
      if (body.action === "lead-save") return json({ ok: true });

      // lead-push: create the lead in Zoho, once per chat.
      if (lead.zoho_lead_id) {
        return json({ error: "This chat already has a Zoho lead." }, 409);
      }
      const missing = leadReady(lead);
      if (missing.length) {
        return json({ error: `Add the ${missing.join(", ")} first.` }, 400);
      }
      try {
        const f = await zohoLeadFields();
        const record: Record<string, unknown> = {
          ...splitName(nameCase(lead.visitor_name)),
          Lead_Source: f.leadSource,
          Tag: [{ name: LEAD_TAG }],
        };
        if (lead.visitor_phone) record.Phone = lead.visitor_phone;
        if (lead.visitor_email) record.Email = lead.visitor_email;
        if (lead.company) record.Company = lead.company;
        if (f.requirement) record[f.requirement] = lead.requirement;
        if (f.products && lead.lead_products) record[f.products] = lead.lead_products;
        if (f.clientType && lead.client_type) record[f.clientType] = lead.client_type;
        // Without a Requirement field, it goes in the description.
        if (!f.requirement) record.Description = lead.requirement;

        const at = new Date().toISOString();
        const linkChat = (leadId: string) =>
          db
            .from("chat_conversations")
            .update({ zoho_lead_id: leadId, zoho_lead_at: at })
            .eq("id", convo.id);

        // Already a lead with this phone or email? Then that lead is kept as
        // it is: only its empty fields get filled from the card (never
        // overwriting anything), plus the ware-ai-chat tag.
        const existing = await findZohoLead(lead.visitor_phone, lead.visitor_email);
        if (existing) {
          const { lead: found, matchedBy } = existing;
          const isEmpty = (v: unknown) =>
            v == null || (typeof v === "string" && !v.trim()) ||
            (Array.isArray(v) && !v.length);
          const fill: Record<string, unknown> = {};
          const labels: Record<string, string> = {
            Phone: "Phone",
            Email: "Email",
            Company: "Company",
            Description: "Description",
            // An existing lead keeps its own source; only an empty one is set.
            Lead_Source: "Lead Source",
            ...(f.requirement ? { [f.requirement]: "Requirement" } : {}),
            ...(f.products ? { [f.products]: "Products enquired for" } : {}),
            ...(f.clientType ? { [f.clientType]: "Type of client" } : {}),
          };
          for (const key of Object.keys(labels)) {
            if (key in record && isEmpty(found[key])) fill[key] = record[key];
          }
          if (Object.keys(fill).length) {
            const { res, data } = await zoho(`/Leads/${found.id}`, {
              method: "PUT",
              body: JSON.stringify({ data: [fill] }),
            });
            if (!res.ok || data?.data?.[0]?.code !== "SUCCESS") {
              console.error("Zoho update failed:", res.status, JSON.stringify(data).slice(0, 500));
              throw new ZohoError(
                `Found the lead in Zoho but couldn't fill its empty fields: ${
                  data?.data?.[0]?.message ?? res.status
                }`,
              );
            }
          }
          // Adding the tag never removes the lead's other tags. Not worth
          // failing over if it doesn't work.
          const tagged = await zoho(`/Leads/actions/add_tags`, {
            method: "POST",
            // over_write false: appended to the lead's tags, never replacing.
            body: JSON.stringify({
              tags: [{ name: LEAD_TAG }],
              ids: [found.id],
              over_write: false,
            }),
          }).catch(() => null);
          if (!tagged?.res.ok) console.error("Zoho tag failed:", JSON.stringify(tagged?.data ?? "").slice(0, 300));
          await linkChat(found.id);
          const filled = Object.keys(fill).map((k) => labels[k]);
          return json({
            ok: true,
            existing: true,
            message: `Matched an existing lead (same ${matchedBy}). ` +
              (filled.length
                ? `Filled its empty ${filled.join(", ")}; nothing else changed.`
                : "It already had everything, so nothing was changed."),
            zohoLeadId: found.id,
            zohoLeadAt: at,
            zohoUrl: `${ZOHO_CRM}/tab/Leads/${found.id}`,
          });
        }

        // Zoho may insist on fields this card doesn't have (e.g. Company):
        // those get "-" and it tries again.
        let result;
        for (let attempt = 0; attempt < 3; attempt++) {
          const { res, data } = await zoho("/Leads", {
            method: "POST",
            body: JSON.stringify({ data: [record] }),
          });
          result = data?.data?.[0];
          if (res.ok && result?.code === "SUCCESS") break;
          const field = result?.details?.api_name;
          if (result?.code === "MANDATORY_NOT_FOUND" && field && !(field in record)) {
            record[field] = "-";
            continue;
          }
          console.error("Zoho lead failed:", res.status, JSON.stringify(data).slice(0, 500));
          throw new ZohoError(
            `Zoho said no: ${result?.message ?? data?.message ?? res.status}` +
              (field ? ` (${field})` : ""),
          );
        }
        const leadId = result?.details?.id;
        if (!leadId) throw new ZohoError("Zoho didn't return the new lead.");
        await linkChat(leadId);
        return json({
          ok: true,
          existing: false,
          message: "New lead created in Zoho.",
          zohoLeadId: leadId,
          zohoLeadAt: at,
          zohoUrl: `${ZOHO_CRM}/tab/Leads/${leadId}`,
        });
      } catch (err) {
        if (err instanceof ZohoError) return json({ error: err.message }, 502);
        throw err;
      }
    }

    if (body.action === "label") {
      if (!UUID_RE.test(String(body.conversationId))) {
        return json({ error: "Bad conversation id" }, 400);
      }
      const label = String(body.label ?? "").trim().slice(0, 100) || null;
      const { error } = await db
        .from("chat_conversations")
        .update({ label })
        .eq("id", body.conversationId);
      if (error) throw error;
      return json({ ok: true, label });
    }

    if (body.action === "delete") {
      if (!UUID_RE.test(String(body.conversationId))) {
        return json({ error: "Bad conversation id" }, 400);
      }
      // Its chat_messages go too (on delete cascade).
      const { error } = await db
        .from("chat_conversations")
        .delete()
        .eq("id", body.conversationId);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong" }, 500);
  }
});
