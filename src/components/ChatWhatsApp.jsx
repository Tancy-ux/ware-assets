import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  FileText,
  MapPin,
  MessagesSquare,
  Search,
  X,
} from "lucide-react";
import { formatWhen } from "./chatTableUtils";

// The Chats page's WhatsApp section: the WhatsApp number's chats, as Meta
// sends them to the whatsapp-hook function (chat-admin "wa-list" /
// "wa-thread"). Read only for now: replies are still sent from the
// WhatsApp tool on the number (TechMonk), and only show here as "Reply
// sent from another app" with its delivered / read ticks.

const LIST_POLL_MS = 20 * 1000;
const THREAD_POLL_MS = 8 * 1000;

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
const dayLabel = (iso) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
};
const timeOf = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
// The list's time: today's as a time, older ones as a date.
const listTime = (iso) =>
  sameDay(iso, Date.now())
    ? timeOf(iso)
    : new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });

const Ticks = ({ status }) =>
  status === "read" ? (
    <CheckCheck size={14} className="chats-wa-read" aria-label="Read" />
  ) : status === "delivered" ? (
    <CheckCheck size={14} aria-label="Delivered" />
  ) : status === "failed" ? (
    <span className="chats-wa-failed">Not delivered</span>
  ) : (
    <Check size={14} aria-label="Sent" />
  );

// A photo, voice note, video or file. One only at Meta (not copied) is
// fetched when tapped (chat-admin "wa-media").
const Media = ({ m, api }) => {
  const [loaded, setLoaded] = useState(null);
  const [busy, setBusy] = useState(false);
  const media = m.media;
  const src = media.url ?? loaded;
  const kind = (media.mime ?? "").split("/")[0];

  if (m.type === "location" && media.lat != null) {
    return (
      <a
        className="chats-wa-file"
        href={`https://www.google.com/maps?q=${media.lat},${media.lng}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        <MapPin size={15} /> Open the location
      </a>
    );
  }
  if (!src) {
    if (!media.mediaId) return <span className="chats-wa-file">File not available</span>;
    const load = async () => {
      setBusy(true);
      const data = await api({ action: "wa-media", mediaId: media.mediaId });
      setBusy(false);
      if (data?.dataUrl) setLoaded(data.dataUrl);
    };
    return (
      <button type="button" className="chats-wa-file" onClick={load} disabled={busy}>
        <FileText size={15} />
        {busy ? "Loading…" : `Open ${m.type === "image" ? "photo" : m.type}`}
      </button>
    );
  }
  if (m.type === "image" || m.type === "sticker" || kind === "image") {
    return (
      <a href={src} target="_blank" rel="noopener noreferrer">
        <img className="chats-wa-img" src={src} alt={m.body || "Photo"} loading="lazy" />
      </a>
    );
  }
  if (m.type === "audio" || kind === "audio") {
    return <audio className="chats-wa-audio" src={src} controls preload="none" />;
  }
  if (m.type === "video" || kind === "video") {
    return <video className="chats-wa-img" src={src} controls preload="metadata" />;
  }
  return (
    <a className="chats-wa-file" href={src} target="_blank" rel="noopener noreferrer" download={media.filename ?? true}>
      <FileText size={15} /> {media.filename || "Document"}
    </a>
  );
};

const Thread = ({ chat, api, onBack, onOpenChat }) => {
  const [result, setResult] = useState({ waId: null, messages: [] });
  const bottomRef = useRef(null);
  const lastCount = useRef(0);

  // Now, then every few seconds while it's in view.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api({ action: "wa-thread", waId: chat.waId }, { quiet: true }).then((data) => {
        if (!cancelled && data && !data.error) {
          setResult({ waId: chat.waId, messages: data.messages ?? [] });
        }
      });
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, THREAD_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, chat.waId]);

  const loading = result.waId !== chat.waId;
  const messages = useMemo(() => (loading ? [] : result.messages), [loading, result.messages]);
  // Reactions sit on the message they react to, not as their own bubble.
  const reactions = useMemo(() => {
    const map = new Map();
    for (const m of messages) {
      if (m.type === "reaction" && m.replyTo && m.body) map.set(m.replyTo, m.body);
    }
    return map;
  }, [messages]);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const shown = messages.filter((m) => m.type !== "reaction");

  // Down to the newest when it opens, or when something new arrives.
  useEffect(() => {
    if (shown.length !== lastCount.current) {
      bottomRef.current?.scrollIntoView({ block: "end" });
      lastCount.current = shown.length;
    }
  }, [shown.length]);

  return (
    <section className="chats-wa-thread">
      <header className="chats-wa-head">
        <button type="button" className="chats-wa-back" onClick={onBack} aria-label="Back to the list">
          <ArrowLeft size={18} />
        </button>
        <span className="chats-avatar" style={{ "--avatar": "#3f7f86" }}>
          {(chat.name || "?").charAt(0).toUpperCase()}
        </span>
        <span className="chats-wa-who">
          <strong>{chat.name || chat.phone}</strong>
          <small>
            {chat.name ? chat.phone : ""}
            {chat.businessPhone && ` · to ${chat.businessPhone}`}
          </small>
        </span>
        {chat.siteChatId && (
          <button
            type="button"
            className="chats-btn"
            onClick={() => onOpenChat(chat.siteChatId)}
            title="They chatted on the website too"
          >
            <MessagesSquare size={14} /> Website chat
          </button>
        )}
      </header>

      <div className="chats-wa-messages">
        {loading ? (
          <p className="chats-results-note">Loading…</p>
        ) : (
          shown.map((m, i) => {
            const quoted = m.replyTo && m.type !== "reaction" ? byId.get(m.replyTo) : null;
            return (
              <div key={m.id}>
                {(i === 0 || !sameDay(shown[i - 1].at, m.at)) && (
                  <div className="chats-wa-day">
                    <span>{dayLabel(m.at)}</span>
                  </div>
                )}
                <div className={`chats-wa-msg chats-wa-${m.direction}`}>
                  <div className={`chats-wa-bubble${m.body == null && !m.media ? " chats-wa-unknown" : ""}`}>
                    {quoted && (
                      <span className="chats-wa-quote">
                        {quoted.body || (quoted.media ? "Attachment" : "Reply")}
                      </span>
                    )}
                    {m.media && <Media m={m} api={api} />}
                    {m.body != null && m.body !== "" ? (
                      <span className="chats-wa-text">{m.body}</span>
                    ) : (
                      m.direction === "out" &&
                      !m.media && (
                        <span className="chats-wa-text">
                          Reply sent from another app (WhatsApp only tells us it was
                          sent, not what it said)
                        </span>
                      )
                    )}
                    <span className="chats-wa-meta" title={formatWhen(m.at)}>
                      {timeOf(m.at)}
                      {m.direction === "out" && <Ticks status={m.status} />}
                    </span>
                    {reactions.get(m.id) && (
                      <span className="chats-wa-reaction">{reactions.get(m.id)}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
      <footer className="chats-wa-foot">
        Read only for now. Reply from the WhatsApp app on this number.
      </footer>
    </section>
  );
};

const ChatWhatsApp = ({ api, isOwner, onOpenChat }) => {
  const [list, setList] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [search, setSearch] = useState("");
  const [setup, setSetup] = useState(null);
  const [connecting, setConnecting] = useState(false);

  // Now, then every 20 seconds while it's in view.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api({ action: "wa-list" }, { quiet: true }).then((data) => {
        if (cancelled) return;
        if (data && !data.error) setList(data);
        else setList((prev) => prev ?? { chats: [], error: data?.error });
      });
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, LIST_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api]);

  // The owner sees how far the connection is set up until messages come in.
  const empty = list && !list.chats?.length;
  useEffect(() => {
    if (!isOwner || !empty) return;
    api({ action: "wa-setup" }, { quiet: true }).then((data) => {
      if (data && !data.error) setSetup(data);
    });
  }, [api, isOwner, empty]);

  const connect = async () => {
    setConnecting(true);
    const data = await api({ action: "wa-setup", connect: true });
    setConnecting(false);
    if (data) setSetup(data);
  };

  const chats = list?.chats ?? [];
  const needle = search.trim().toLowerCase();
  const digits = needle.replace(/\D/g, "");
  const shown = chats.filter(
    (c) =>
      !needle ||
      c.name?.toLowerCase().includes(needle) ||
      c.lastText?.toLowerCase().includes(needle) ||
      (digits.length >= 3 && c.phone.replace(/\D/g, "").includes(digits)),
  );
  const open = chats.find((c) => c.waId === openId) ?? null;

  const openChat = (c) => {
    setOpenId(c.waId);
    // Opening clears its unread on the server; show that straight away.
    setList((prev) => ({
      ...prev,
      chats: prev.chats.map((x) => (x.waId === c.waId ? { ...x, unread: 0 } : x)),
    }));
  };

  if (!list) return <p className="chats-results-note chats-wa-loading">Loading…</p>;

  if (list.missingTable || (empty && isOwner)) {
    const steps = setup && [
      ["Tables in Supabase (scripts/supabase-whatsapp.sql)", !list.missingTable],
      ["Verify token (WA_VERIFY_TOKEN)", setup.verifyTokenSet],
      ["App secret (WA_APP_SECRET)", setup.appSecretSet],
      ["System user token (WA_TOKEN)", setup.tokenSet],
      ["WhatsApp Business Account ID (WA_BUSINESS_ACCOUNT_ID)", setup.wabaIdSet],
      ["Our app subscribed to the WhatsApp account", setup.subscribed],
    ];
    return (
      <div className="chats-stats">
        <section className="chats-card chats-wa-setup">
          <h3>Connect WhatsApp</h3>
          <p className="chats-card-sub">
            Messages to the WhatsApp number appear here as they arrive, next
            to TechMonk (which keeps working). Chats from before the connection
            don&apos;t come across.
          </p>
          {list.missingTable && (
            <p className="chats-results-note chats-results-warn">
              Run scripts/supabase-whatsapp.sql in Supabase first.
            </p>
          )}
          {steps && (
            <ul className="chats-wa-steps">
              {steps.map(([label, done]) => (
                <li key={label} className={done ? "chats-wa-done" : ""}>
                  {done ? <Check size={14} /> : <X size={14} />} {label}
                </li>
              ))}
            </ul>
          )}
          {setup && (
            <>
              <p className="chats-card-sub">
                In the Meta app: WhatsApp → Configuration → Callback URL{" "}
                <code>{setup.webhookUrl}</code>, the same verify token, and
                subscribe to <strong>messages</strong>.
              </p>
              {setup.message && (
                <p className="chats-results-note chats-results-warn">{setup.message}</p>
              )}
              {setup.tokenSet && setup.wabaIdSet && !setup.subscribed && (
                <button
                  type="button"
                  className="chats-btn chats-btn-primary"
                  onClick={connect}
                  disabled={connecting}
                >
                  {connecting ? "Connecting…" : "Subscribe our app to the WhatsApp account"}
                </button>
              )}
              {setup.subscribed && (
                <p className="chats-card-sub">
                  All set: send a message to the number and it shows up here.
                </p>
              )}
            </>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className={`chats-wa${open ? " chats-wa-has-open" : ""}`}>
      <aside className="chats-wa-list">
        <div className="chats-search chats-wa-search">
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, number or message"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </div>
        <p className="chats-wa-count">
          {chats.length} chat{chats.length === 1 ? "" : "s"}
        </p>
        {!shown.length ? (
          <p className="chats-results-note">
            {chats.length ? "Nobody matches." : "No WhatsApp messages yet."}
          </p>
        ) : (
          <ul>
            {shown.map((c) => (
              <li key={c.waId}>
                <button
                  type="button"
                  className={`chats-wa-item${c.waId === openId ? " chats-wa-item-on" : ""}`}
                  onClick={() => openChat(c)}
                >
                  <span className="chats-avatar" style={{ "--avatar": "#3f7f86" }}>
                    {(c.name || "?").charAt(0).toUpperCase()}
                  </span>
                  <span className="chats-wa-item-main">
                    <span className="chats-wa-item-top">
                      <strong>{c.name || c.phone}</strong>
                      <small>{listTime(c.lastAt)}</small>
                    </span>
                    <span className="chats-wa-item-bottom">
                      <span className="chats-wa-preview">
                        {c.lastFrom === "business" && "You: "}
                        {c.lastText}
                      </span>
                      {c.siteChatId && <span className="chats-tag">Website</span>}
                      {c.unread > 0 && <span className="chats-wa-unread">{c.unread}</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      {open ? (
        <Thread
          key={open.waId}
          chat={open}
          api={api}
          onBack={() => setOpenId(null)}
          onOpenChat={onOpenChat}
        />
      ) : (
        <div className="chats-wa-none">
          <MessagesSquare size={28} />
          <p>Pick a chat to read it.</p>
        </div>
      )}
    </div>
  );
};

export default ChatWhatsApp;
