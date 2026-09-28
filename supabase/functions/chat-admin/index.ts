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
