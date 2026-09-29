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
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically
// once deployed; for local runs they go in supabase/functions/.env.local.)
//
// Run locally: npm run dev:chats  (serves on http://localhost:8002)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SESSION_HOURS = 12;

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

// Session tokens are "<expiry ms>.<HMAC of expiry>", signed with a key
// derived from the password + service key. Changing the password logs
// everyone out.
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

async function makeToken(secret: string) {
  const expires = String(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  return `${expires}.${await sign(expires, secret)}`;
}

async function tokenIsValid(token: unknown, secret: string) {
  if (typeof token !== "string") return false;
  const [expires, sig] = token.split(".", 2);
  if (!expires || !sig || Number(expires) < Date.now()) return false;
  return safeEqual(sig, await sign(expires, secret));
}

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
// Most messages read for the per-page counts.
const PAGE_MESSAGES_LIMIT = 20000;
// Shopify's orders are cached briefly (reading them takes a few calls);
// the chat counts are always fresh.
const ORDERS_CACHE_MS = 5 * 60 * 1000;
const ordersCache = new Map<
  string,
  { at: number; value: Awaited<ReturnType<typeof chatOrders>> }
>();

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
    const res = await fetch(
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
    const body = await res.json();
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

// ---- Zoho CRM leads (the Chats page's "Lead" card) ----
// Nothing goes to Zoho on its own: a team member reviews the card and
// clicks "Create lead". Needs ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET /
// ZOHO_REFRESH_TOKEN (scripts/zoho-token.mjs) and the columns from
// scripts/supabase-zoho-leads.sql.
const ZOHO_ACCOUNTS = "https://accounts.zoho.in";
const ZOHO_API = "https://www.zohoapis.in/crm/v5";
const ZOHO_CRM = "https://crm.zoho.in/crm";
const LEAD_TAG = "ware-ai-chat";
const LEAD_SOURCE = "Website";
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
    // "Website" as Zoho spells it, if it's in the Lead Source list.
    leadSource: sources.find((s) => /^website$/i.test(s)) ??
      sources.find((s) => /web/i.test(s)) ?? LEAD_SOURCE,
  };
  leadFields = { at: Date.now(), value };
  return value;
}

// "Devika" -> First "Devika", Last "." (Zoho needs a last name);
// "Devika Shah" -> First "Devika", Last "Shah".
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
      const ok = safeEqual(String(body.username ?? ""), username) &&
        safeEqual(String(body.password ?? ""), password);
      if (!ok) {
        // Slows down password guessing.
        await new Promise((r) => setTimeout(r, 800));
        return json({ error: "Wrong username or password" }, 401);
      }
      return json({ token: await makeToken(secret) });
    }

    if (!(await tokenIsValid(body.token, secret))) {
      return json({ error: "Session expired, please log in again" }, 401);
    }

    const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

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
      const numbers = await dailyNumbers(db, data ?? []);

      return json({
        conversations: (data ?? []).map((c) => ({
          id: c.id,
          visitorId: c.visitor_id,
          visitorName: c.visitor_name,
          company: c.company,
          visitorPhone: c.visitor_phone ?? null,
          // The "Lead" card (scripts/supabase-zoho-leads.sql).
          visitorEmail: c.visitor_email ?? null,
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
          preview: c.last_question ?? c.first_question ?? "",
          takeover: takeoverActive(c.takeover_at),
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
        matches.push({
          conversationId: r.conversation_id,
          text: snippet(inQuestion ? r.question : r.answer ?? ""),
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
      return json({
        messages: (data ?? []).map((m) => ({
          id: m.id,
          question: m.question,
          answer: m.answer,
          products: m.products,
          created_at: m.created_at,
          sender: m.sender ?? "ai",
          page: m.page ?? null,
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
      const { data: convo, error: convoError } = await db
        .from("chat_conversations")
        .select("*")
        .eq("id", body.conversationId)
        .maybeSingle();
      if (convoError) throw convoError;
      if (!takeoverActive(convo?.takeover_at)) {
        return json({ error: "Take over the chat first" }, 400);
      }
      const { data, error } = await db
        .from("chat_messages")
        .insert({
          conversation_id: body.conversationId,
          question: "",
          answer: text,
          sender: "agent",
        })
        .select()
        .single();
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
          products: [],
          created_at: data.created_at,
          sender: "agent",
        },
      });
    }

    // The Chats page's Results panel, for the same date range as the list.
    if (body.action === "results") {
      const key = `${since}|${until}`;
      const cached = ordersCache.get(key);
      const loadOrders = async () => {
        if (cached && Date.now() - cached.at < ORDERS_CACHE_MS && !body.fresh) {
          return cached.value;
        }
        const value = await chatOrders(since, until);
        ordersCache.set(key, { at: Date.now(), value });
        return value;
      };
      let chatsQuery = db
        .from("chat_conversations")
        // "*": works before and after first_page exists.
        .select("*");
      if (since) chatsQuery = chatsQuery.gte("last_message_at", since);
      if (until) chatsQuery = chatsQuery.lt("last_message_at", until);
      // Messages sent in the range, for "messages sent from each page",
      // read 1000 at a time (the most the API returns at once).
      const loadPageMessages = async () => {
        const rows: { page: string }[] = [];
        for (let from = 0; from < PAGE_MESSAGES_LIMIT; from += 1000) {
          let q = db
            .from("chat_messages")
            .select("page")
            .not("page", "is", null)
            .order("created_at", { ascending: false })
            .range(from, from + 999);
          if (since) q = q.gte("created_at", since);
          if (until) q = q.lt("created_at", until);
          const { data, error } = await q;
          if (error) throw error;
          rows.push(...(data ?? []));
          if ((data ?? []).length < 1000) break;
        }
        return { data: rows };
      };
      const [{ data: chats, error }, shop, { data: pageMessages }] =
        await Promise.all([
          chatsQuery.limit(LIST_LIMIT),
          loadOrders().catch((err) => ({ error: String(err) })),
          // Before scripts/supabase-chat-pages.sql this fails: no pages.
          loadPageMessages().catch(() => ({ data: [] })),
        ]);
      if (error) throw error;
      if ("error" in shop) {
        console.error(shop.error);
        const noAccess = /access|scope|denied|401|403/i.test(shop.error);
        return json({
          error: noAccess
            ? "The Shopify token can't read orders yet (needs read_orders)."
            : "Couldn't load orders from Shopify just now.",
        }, 502);
      }
      // Which chat each order came from ("Visitor 12" / their name). The
      // chat may be outside the date range, so look those up by ID.
      const ids = [...new Set(shop.orders.map((o) => o.visitorId).filter(Boolean))];
      const { data: linked } = ids.length
        ? await db
          .from("chat_conversations")
          .select("id, visitor_id, visitor_name, label, started_at")
          .in("visitor_id", ids)
        : { data: [] };
      const linkedNumbers = await dailyNumbers(db, linked ?? []);
      const byVisitor = new Map((linked ?? []).map((c) => [c.visitor_id, c]));
      const counted = shop.orders.filter((o) => !o.cancelled);
      const value = {
        chats: chats?.length ?? 0,
        leads: (chats ?? []).filter((c) => c.visitor_phone).length,
        orders: counted.length,
        revenue: counted.reduce((s, o) => s + o.total, 0),
        fromChatOrders: counted.filter((o) => o.fromChatTotal > 0).length,
        fromChatRevenue: counted.reduce((s, o) => s + o.fromChatTotal, 0),
        // Where chats start: the pages with the most chats, top 10.
        // Every page chats started on or messages were sent from, with
        // both counts (the Stats tab picks which to show and sorts).
        pages: (() => {
          const byPage = new Map<string, { chats: number; messages: number }>();
          const row = (page: string) => {
            if (!byPage.has(page)) byPage.set(page, { chats: 0, messages: 0 });
            return byPage.get(page)!;
          };
          for (const c of chats ?? []) if (c.first_page) row(c.first_page).chats++;
          for (const m of pageMessages ?? []) row(m.page).messages++;
          return [...byPage].map(([page, n]) => ({ page, ...n }));
        })(),
        ordersScanned: shop.scanned,
        trackingFrom: TRACKING_FROM,
        list: shop.orders.map((o) => {
          const c = o.visitorId ? byVisitor.get(o.visitorId) : null;
          return {
            ...o,
            conversationId: c?.id ?? null,
            chatTitle: c
              ? c.label || c.visitor_name ||
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
      return json(value);
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
        const v = clean(body.lead?.[key], max);
        if (v !== undefined) edits[column] = v || null;
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
          ...splitName(lead.visitor_name),
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
