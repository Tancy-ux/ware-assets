// Meta's WhatsApp webhook: every message customers send to our WhatsApp
// number, and the sent / delivered / read updates for ours, saved for the
// Chats page's WhatsApp section (scripts/supabase-whatsapp.sql). Read only:
// nothing is sent from here.
//
// Our own Meta app is subscribed to the WhatsApp Business Account next to
// any other tool on the number (TechMonk), so both get every message. A
// reply typed in that other tool only reaches us as a status (no text).
//
// Secrets (npx supabase secrets set …):
//   WA_VERIFY_TOKEN   any long random text, also typed into the Meta app's
//                     WhatsApp → Configuration → Verify token
//   WA_APP_SECRET     the Meta app's App secret: proves a call is from Meta
//   WA_TOKEN          the system user's token: to copy photos and files
// Deployed without JWT checks (Meta can't send one):
//   npx supabase functions deploy whatsapp-hook --use-api --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRAPH = "https://graph.facebook.com/v23.0";
const MEDIA_BUCKET = "whatsapp-media";
// Bigger files stay with Meta (the Chats page fetches them when opened,
// for as long as Meta keeps them: 30 days).
const MAX_MEDIA_BYTES = 15 * 1024 * 1024;

const db = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// A Meta signature check: X-Hub-Signature-256 is "sha256=" + the body's
// HMAC with the App secret.
async function fromMeta(raw: string, header: string | null) {
  const secret = Deno.env.get("WA_APP_SECRET");
  if (!secret || !header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)),
  );
  const hex = [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice("sha256=".length);
  // Same length, compared in full (no early exit).
  if (given.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

const MEDIA_TYPES = ["image", "video", "audio", "document", "sticker"];

// What a message says, as text for the list and the thread.
// deno-lint-ignore no-explicit-any
function readMessage(m: any) {
  const type = String(m.type ?? "unknown");
  let body: string | null = null;
  // deno-lint-ignore no-explicit-any
  let media: Record<string, any> | null = null;
  if (type === "text") body = m.text?.body ?? null;
  else if (MEDIA_TYPES.includes(type)) {
    const x = m[type] ?? {};
    media = {
      id: x.id ?? null,
      mime: x.mime_type ?? null,
      filename: x.filename ?? null,
      voice: x.voice === true,
    };
    body = x.caption ?? null;
  } else if (type === "location") {
    const l = m.location ?? {};
    body = [l.name, l.address].filter(Boolean).join(", ") ||
      `${l.latitude}, ${l.longitude}`;
    media = { lat: l.latitude, lng: l.longitude };
  } else if (type === "contacts") {
    // deno-lint-ignore no-explicit-any
    body = (m.contacts ?? []).map((c: any) =>
      [c.name?.formatted_name, c.phones?.[0]?.phone].filter(Boolean).join(" ")
    ).join("\n");
  } else if (type === "interactive") {
    body = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
  } else if (type === "button") body = m.button?.text ?? null;
  else if (type === "reaction") body = m.reaction?.emoji ?? "";
  else if (type === "order") {
    const n = m.order?.product_items?.length ?? 0;
    body = `Sent an order (${n} item${n === 1 ? "" : "s"})`;
  } else if (type === "unsupported" || type === "unknown") {
    body = "A message WhatsApp couldn't pass on";
  }
  return { type, body, media };
}

// The list's preview of a message.
const preview = (type: string, body: string | null) =>
  body?.trim()
    ? body.trim().slice(0, 200)
    : {
      image: "📷 Photo",
      video: "🎥 Video",
      audio: "🎤 Voice note",
      document: "📄 Document",
      sticker: "Sticker",
      location: "📍 Location",
      reaction: "Reacted",
    }[type] ?? "Message";

// Their chat row: made on their first message, then kept up to date.
async function touchChat(
  waId: string,
  fields: {
    name?: string | null;
    businessPhone?: string | null;
    at: string;
    text?: string | null;
    from?: "customer" | "business";
    unread?: boolean;
  },
) {
  const { data: existing, error } = await db
    .from("wa_chats")
    .select("wa_id, last_at, unread")
    .eq("wa_id", waId)
    .maybeSingle();
  if (error) throw error;
  // Only a newer message moves the preview (Meta can send them late).
  const newer = !existing || fields.at >= existing.last_at;
  const row: Record<string, unknown> = {};
  if (fields.name) row.name = fields.name;
  if (fields.businessPhone) row.business_phone = fields.businessPhone;
  if (newer && fields.text !== undefined) {
    row.last_at = fields.at;
    row.last_text = fields.text;
    row.last_from = fields.from;
  }
  if (fields.unread) row.unread = (existing?.unread ?? 0) + 1;
  // Someone on the team has replied (from any app): nothing waiting.
  if (newer && fields.from === "business") row.unread = 0;
  if (!existing) {
    const { error: insertError } = await db.from("wa_chats").insert({
      wa_id: waId,
      first_at: fields.at,
      last_at: fields.at,
      ...row,
    });
    // Two at once for a new customer: the other one made it.
    if (insertError?.code === "23505") return touchChat(waId, fields);
    if (insertError) throw insertError;
    return;
  }
  if (Object.keys(row).length) {
    const { error: updateError } = await db.from("wa_chats").update(row).eq("wa_id", waId);
    if (updateError) throw updateError;
  }
}

// Copies a photo / voice note / file from Meta into our storage, so it
// outlives Meta's 30 days. Never fails the message.
async function keepMedia(messageId: string, media: Record<string, unknown>) {
  const token = Deno.env.get("WA_TOKEN");
  if (!token || !media.id) return;
  try {
    const info = await fetch(`${GRAPH}/${media.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json());
    if (!info?.url || (info.file_size ?? 0) > MAX_MEDIA_BYTES) return;
    const file = await fetch(info.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!file.ok) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ext = String(info.mime_type ?? media.mime ?? "").split("/")[1]?.split(";")[0] || "bin";
    const path = `${messageId.replace(/[^\w.-]/g, "_")}.${ext}`;
    const { error } = await db.storage.from(MEDIA_BUCKET).upload(path, bytes, {
      contentType: String(info.mime_type ?? media.mime ?? "application/octet-stream"),
      upsert: true,
    });
    if (error) throw error;
    await db
      .from("wa_messages")
      .update({ media: { ...media, path, size: bytes.length } })
      .eq("id", messageId);
  } catch (err) {
    console.error("Media copy failed:", err);
  }
}

const STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };
const atOf = (ts: unknown) =>
  new Date(Number(ts) * 1000 || Date.now()).toISOString();

// One "messages" change from the webhook: their messages, and statuses
// for ours. `later` collects the media copies, done after we've answered.
// deno-lint-ignore no-explicit-any
async function saveChange(value: any, later: Promise<unknown>[]) {
  const businessPhone = value.metadata?.display_phone_number ?? null;
  const names = new Map<string, string>(
    // deno-lint-ignore no-explicit-any
    (value.contacts ?? []).map((c: any) => [String(c.wa_id), c.profile?.name ?? ""]),
  );

  for (const m of value.messages ?? []) {
    const waId = String(m.from ?? "");
    if (!waId || !m.id) continue;
    const { type, body, media } = readMessage(m);
    const at = atOf(m.timestamp);
    await touchChat(waId, {
      name: names.get(waId) || null,
      businessPhone,
      at,
      // A reaction doesn't move the chat's preview.
      ...(type === "reaction" ? {} : { text: preview(type, body), from: "customer" as const }),
      unread: type !== "reaction",
    });
    const { error } = await db.from("wa_messages").upsert({
      id: m.id,
      wa_id: waId,
      direction: "in",
      type,
      body,
      media,
      context_id: m.context?.id ?? (type === "reaction" ? m.reaction?.message_id : null) ?? null,
      sent_at: at,
      raw: m,
    }, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
    if (media?.id) later.push(keepMedia(m.id, media));
  }

  // Ours: sent / delivered / read / failed. One we haven't seen (sent from
  // another tool on the number) gets a row without text.
  for (const s of value.statuses ?? []) {
    const waId = String(s.recipient_id ?? "");
    if (!waId || !s.id) continue;
    const at = atOf(s.timestamp);
    const { data: known, error } = await db
      .from("wa_messages")
      .select("id, status")
      .eq("id", s.id)
      .maybeSingle();
    if (error) throw error;
    if (known) {
      // Only forwards (a late "delivered" never undoes "read").
      if ((STATUS_RANK[s.status] ?? 0) > (STATUS_RANK[known.status] ?? 0)) {
        await db.from("wa_messages").update({ status: s.status }).eq("id", s.id);
      }
      continue;
    }
    await touchChat(waId, {
      businessPhone,
      at,
      text: "Reply sent from another app",
      from: "business",
    });
    const { error: insertError } = await db.from("wa_messages").upsert({
      id: s.id,
      wa_id: waId,
      direction: "out",
      type: "unknown",
      body: null,
      status: s.status,
      sent_at: at,
      raw: s,
    }, { onConflict: "id", ignoreDuplicates: true });
    if (insertError) throw insertError;
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Meta checking the webhook when it's set up in the app.
  if (req.method === "GET") {
    const expected = Deno.env.get("WA_VERIFY_TOKEN");
    if (
      expected &&
      url.searchParams.get("hub.mode") === "subscribe" &&
      url.searchParams.get("hub.verify_token") === expected
    ) {
      return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await req.text();
  if (!(await fromMeta(raw, req.headers.get("x-hub-signature-256")))) {
    return new Response("Bad signature", { status: 401 });
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const later: Promise<unknown>[] = [];
  try {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field === "messages") await saveChange(change.value ?? {}, later);
      }
    }
  } catch (err) {
    // Meta tries again later when we don't answer 200.
    console.error("WhatsApp save failed:", err);
    return new Response("Error", { status: 500 });
  }

  // Answer Meta straight away; photos and files are copied after.
  const copies = Promise.allSettled(later);
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(copies);
  else await copies;
  return new Response("OK", { status: 200 });
});
