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

      return json({
        conversations: (data ?? []).map((c) => ({
          id: c.id,
          visitorId: c.visitor_id,
          visitorName: c.visitor_name,
          company: c.company,
          visitorPhone: c.visitor_phone ?? null,
          // "Visitor 12" (scripts/supabase-visitor-numbers.sql); null until
          // that's been run.
          visitorNumber: c.visitor_number ?? null,
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
      const [{ data: chats, error }, shop] = await Promise.all([
        chatsQuery.limit(LIST_LIMIT),
        loadOrders().catch((err) => ({ error: String(err) })),
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
          .select("id, visitor_id, visitor_number, visitor_name, label")
          .in("visitor_id", ids)
        : { data: [] };
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
        topPages: [
          ...(chats ?? []).reduce((m, c) => {
            if (c.first_page) m.set(c.first_page, (m.get(c.first_page) ?? 0) + 1);
            return m;
          }, new Map<string, number>()),
        ]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([page, count]) => ({ page, count })),
        ordersScanned: shop.scanned,
        trackingFrom: TRACKING_FROM,
        list: shop.orders.map((o) => {
          const c = o.visitorId ? byVisitor.get(o.visitorId) : null;
          return {
            ...o,
            conversationId: c?.id ?? null,
            chatTitle: c
              ? c.label || c.visitor_name ||
                (c.visitor_number ? `Visitor ${c.visitor_number}` : "Visitor")
              : null,
          };
        }),
      };
      return json(value);
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
