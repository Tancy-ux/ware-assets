import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  X,
  Pencil,
  Send,
  Trash2,
  Copy,
  Check,
  ArrowLeft,
  GraduationCap,
  MessageCircle,
} from "lucide-react";
import { toast } from "react-toastify";
import { supabase } from "./supabase";
import { callAskFaq } from "../lib/askFaq";
import AiGuidelines from "./AiGuidelines";
import RestockForm from "./RestockForm";
import ContactCard from "./ContactCard";

// Improved answers get saved as real rows in this category, so they're
// easy to find, review, and hand off — and since the ask-faq function
// reads straight from the faqs table, they immediately improve future
// answers too.
const CORRECTIONS_CATEGORY = "WhatsApp Bot FAQ";

// Chat history persists here so it survives refreshes/navigation — it's
// only ever cleared by the user hitting the clear button.
const STORAGE_KEY = "askAiChat";

// How much of the chat goes along with each question as context. The
// function caps turns too; this just avoids sending what it'd drop.
const HISTORY_MAX_TURNS = 10;
const HISTORY_MAX_AGE_MS = 30 * 60 * 60 * 1000;

// One anonymous ID per browser, so the Chats page can group a person's
// conversations together. Falls back to a throwaway ID if storage is off.
const VISITOR_KEY = "askAiVisitorId";
const getVisitorId = () => {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
};

let nextId = 1;

const formatTime = (ms) =>
  ms
    ? new Date(ms).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

// Answers are plain text, but product replies include store links — turn
// those into real anchors so they're clickable.
const URL_PATTERN = /(https?:\/\/[^\s)]+)/g;
const linkify = (text) =>
  text.split(URL_PATTERN).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  );

// "Check restock" on sold-out cards. Off for now: the restock_requests
// table (scripts/supabase-restock-requests-table.sql) isn't set up yet.
// Flip to true once it is, and restore the "Check restock" sentence in the
// ask-faq prompt.
const RESTOCK_CHECK_ENABLED = false;

// A reply shows up to 4 product cards; "Show more" posts the next 6 as a
// new message (and so on, for the up-to-16 similar products).
const FIRST_PAGE = 4;
const MORE_PAGE = 6;

// Human takeover: how often the chat checks for team replies, and when it
// stops bothering (matches the 24h takeover limit in ask-faq).
// Each check is one Supabase function call (no AI), so the idle rate is
// kept low: that's what counts towards the free tier's monthly allowance.
const POLL_TEAM_MS = 4000;
const POLL_IDLE_MS = 20000;
const POLL_IDLE_CUTOFF_MS = 10 * 60 * 1000;
const TAKEOVER_WINDOW_MS = 24 * 60 * 60 * 1000;
const SYSTEM_NOTES = {
  "team-joined": "A member of the Ware team has joined the chat.",
  "team-left": "You're chatting with the Ware assistant again.",
};

// How long local replies (Show more, similar products) "type" for.
const LOCAL_REPLY_MIN_MS = 1000;
const LOCAL_REPLY_JITTER_MS = 600;

// Whether to offer the "leave your details" card: { dismissed } after "Not
// now", { saved } mirroring what the server says (the name/phone themselves
// live only on the server, so deleting the chat in the Chats page really
// forgets them, and the card comes back). Clearing the chat resets this.
const CONTACT_KEY = "askAiContact";
// Without a follow-up-worthy enquiry, the details prompt waits this long.
const CONTACT_AFTER_MESSAGES = 5;
const loadContactPrefs = () => {
  try {
    const v = JSON.parse(localStorage.getItem(CONTACT_KEY)) ?? {};
    return { dismissed: !!v.dismissed, saved: !!v.saved };
  } catch {
    return { dismissed: false, saved: false };
  }
};
const storeContactPrefs = (value) => {
  try {
    localStorage.setItem(CONTACT_KEY, JSON.stringify(value));
  } catch {
    // Still applies for this page view.
  }
};

// Tells the server the visitor started over ("reset" / clear chat): ends
// any team takeover and marks the spot in the Chats transcript. Their chat
// stays one conversation there.
const notifyReset = () =>
  callAskFaq({
    mode: "reset",
    conversationId: getVisitorId(),
    visitorId: getVisitorId(),
  });

// A product the AI recommended. Everything shown here comes from the
// Shopify catalog via the function, not from the model's text. Single-
// variant products add straight to the store's cart; ones with options
// (size, colour) go to the product page to pick.
const ProductCard = ({ product, restockState, onCheckRestock }) => {
  // Ware Atelier pieces are made to order: no cart, just a WhatsApp
  // enquiry (the function already hides their price).
  const action = product.enquireUrl
    ? { href: product.enquireUrl, label: "Enquire" }
    : product.cartUrl
      ? { href: product.cartUrl, label: "Add to cart" }
      : { href: product.url, label: "Shop now" };
  return (
    <div className="faq-chat-product">
      <a
        href={product.url}
        target="_blank"
        rel="noopener noreferrer"
        className="faq-chat-product-link"
      >
        <div className="faq-chat-product-img">
          {product.image && <img src={product.image} alt="" loading="lazy" />}
          {!product.available && (
            <span className="faq-chat-product-badge">Sold out</span>
          )}
        </div>
        <div className="faq-chat-product-title">{product.title}</div>
        <div className="faq-chat-product-price">{product.price}</div>
      </a>
      {product.available ? (
        <a
          href={action.href}
          target="_blank"
          rel="noopener noreferrer"
          className="faq-chat-product-btn"
        >
          {action.label}
        </a>
      ) : !RESTOCK_CHECK_ENABLED ? (
        <a
          href={product.url}
          target="_blank"
          rel="noopener noreferrer"
          className="faq-chat-product-btn faq-chat-product-btn-muted"
        >
          View
        </a>
      ) : (
        // Sold out: no pre-orders, but the team can check for stock.
        <button
          type="button"
          className="faq-chat-product-btn faq-chat-product-btn-muted"
          disabled={restockState === "done"}
          onClick={onCheckRestock}
        >
          {restockState === "done" ? "Requested ✓" : "Check restock"}
        </button>
      )}
    </div>
  );
};

const loadStoredMessages = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // A message still "loading" or mid-edit when the page closed can
    // never resolve on its own — settle it into a plain state instead of
    // showing a permanent "Thinking..." bubble.
    return parsed.map((m) => ({
      ...m,
      loading: false,
      error: m.loading ? "Interrupted — try asking again." : m.error,
      correcting: false,
    }));
  } catch {
    return [];
  }
};

// A small chat popup for testing the FAQ bot turn by turn. The earlier
// answered turns go along with each question so the model can follow the
// conversation; clearing the chat starts it fresh.
const AskAi = ({ open, onClose, onSaved, canEdit }) => {
  const [messages, setMessages] = useState(loadStoredMessages);
  const [showGuidelines, setShowGuidelines] = useState(false);
  const [contactPrefs, setContactPrefs] = useState(loadContactPrefs);
  const [contactThanks, setContactThanks] = useState(null);
  const [input, setInput] = useState("");
  const [copiedKey, setCopiedKey] = useState(null);
  const listRef = useRef(null);

  // Keep nextId ahead of anything restored from storage so new messages
  // never collide with old ones.
  useEffect(() => {
    const maxStored = messages.reduce((max, m) => Math.max(max, m.id), 0);
    if (maxStored >= nextId) nextId = maxStored + 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // Storage full or unavailable (e.g. private browsing) — chat still
      // works for the session, it just won't persist.
    }
  }, [messages]);

  // Reserves room on the page for the drawer (see .faq-chat-open in
  // Faq.css) so it pushes the Q&A content and navbar aside instead of
  // covering them.
  useEffect(() => {
    document.body.classList.toggle("faq-chat-open", open);
    return () => document.body.classList.remove("faq-chat-open");
  }, [open]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const patchMessage = (id, patch) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    );
  };

  const send = async (e) => {
    e.preventDefault();
    const question = input.trim();
    if (!question) return;
    setInput("");
    setContactThanks(null);

    const id = nextId++;

    // "reset" wipes the AI's memory of the chat without wiping what's on
    // screen — handled right here, no AI call needed.
    if (/^\/?reset$/i.test(question)) {
      notifyReset();
      setMessages((prev) => [
        ...prev,
        {
          id,
          question,
          answer: "Okay, starting fresh. I've forgotten the earlier chat.",
          isReset: true,
          time: Date.now(),
        },
      ]);
      return;
    }

    // Only the turns since the last "reset", and none older than
    // HISTORY_MAX_AGE_MS — a stale chat shouldn't color a new one.
    const lastReset = messages.findLastIndex((m) => m.isReset);
    const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
    // Includes team replies and the customer's messages to the team from
    // a takeover, so the AI knows what was said once it's handed back.
    const recent = messages
      .slice(lastReset + 1)
      .filter((m) => (m.answer || m.awaitingTeam) && m.time > cutoff)
      .slice(-HISTORY_MAX_TURNS);
    const history = recent.map((m) => ({
      question: m.question ?? "",
      answer: m.answer ?? "",
      products: (m.products ?? []).map((p) => p.title),
      fromTeam: !!m.isAgent,
    }));
    // One conversation per visitor in the Chats page, so it's keyed on the
    // browser's visitor ID; resets only clear the AI's memory above.
    const conversationId = getVisitorId();

    setMessages((prev) => [
      ...prev,
      {
        id,
        question,
        conversationId,
        answer: null,
        loading: true,
        error: null,
        correcting: false,
        correctedText: "",
        saving: false,
        saved: false,
        time: Date.now(),
      },
    ]);

    const { data, error } = await callAskFaq({
      question,
      history,
      conversationId,
      visitorId: getVisitorId(),
    });
    if (data && typeof data.contactSaved === "boolean") {
      syncContactSaved(data.contactSaved);
    }

    if (error || data?.error) {
      console.error(error ?? data?.error);
      patchMessage(id, {
        loading: false,
        error: "Couldn't get an answer just now. Try again in a moment.",
      });
      return;
    }
    // The team has taken this chat over: no AI answer, the message waits
    // for them (their replies arrive through the polling below).
    if (data.takeover) {
      patchMessage(id, { loading: false, awaitingTeam: true });
      if (!teamActive) addSystemNote("team-joined");
      return;
    }
    patchMessage(id, {
      loading: false,
      answer: data.answer,
      products: (data.products ?? []).slice(0, FIRST_PAGE),
      moreProducts: (data.products ?? []).slice(FIRST_PAGE),
      images: data.images ?? [],
      whatsappUrl: data.whatsappUrl ?? null,
      askForDetails: !!data.askForDetails,
    });
  };

  // The alternatives were already picked by the function alongside the
  // sold-out card, so this just shows them — no second AI call.
  const showSimilar = (msg, product) => {
    patchMessage(msg.id, {
      similarShown: { ...msg.similarShown, [product.url]: true },
    });
    postLocalReply("Yes, show me similar ones", {
      answer: `Here are some pieces similar to the ${product.title} that are in stock:`,
      products: product.similar.slice(0, FIRST_PAGE),
      moreProducts: product.similar.slice(FIRST_PAGE),
    });
  };

  // "Show more" continues the conversation: a "Show me more" turn and a
  // new bot message with the next batch, which can offer more again.
  // Everything was already sent by the function, so no AI call.
  const showMore = (msg) => {
    patchMessage(msg.id, { moreProducts: [] });
    postLocalReply("Show me more", {
      answer: "Here are a few more:",
      products: msg.moreProducts.slice(0, MORE_PAGE),
      moreProducts: msg.moreProducts.slice(MORE_PAGE),
    });
  };

  // Replies the chat already has the answer to still "type" for a moment
  // (the three dots), so they don't pop in unnaturally fast.
  const postLocalReply = (question, reply) => {
    const id = nextId++;
    setMessages((prev) => [
      ...prev,
      { id, question, loading: true, isLocal: true, time: Date.now() },
    ]);
    const delay = LOCAL_REPLY_MIN_MS + Math.random() * LOCAL_REPLY_JITTER_MS;
    setTimeout(() => patchMessage(id, { loading: false, ...reply }), delay);
  };

  // The conversation the details card attaches to: the latest one the
  // function has logged (since the last "reset").
  const lastResetIndex = messages.findLastIndex((m) => m.isReset);
  const currentConversationId = messages
    .slice(lastResetIndex + 1)
    .findLast((m) => m.conversationId && m.answer)?.conversationId;
  // Offer it only when it's useful: the function flagged an enquiry the
  // team should follow up on (bulk / custom / quote...), or they've been
  // chatting a while. Not from the very first message.
  const customerMessages = messages.filter(
    (m) => m.question && !m.isLocal && !m.isReset,
  ).length;
  const showContactCard =
    !contactPrefs.dismissed &&
    !contactPrefs.saved &&
    !!currentConversationId &&
    !messages.some((m) => m.loading) &&
    (messages.some((m) => m.askForDetails) ||
      customerMessages >= CONTACT_AFTER_MESSAGES);

  const updateContactPrefs = (patch) =>
    setContactPrefs((prev) => {
      const next = { ...prev, ...patch };
      storeContactPrefs(next);
      return next;
    });
  // The server says whether this visitor's details are on file; if the
  // team deleted the chat, that flips back to false and the card returns.
  const syncContactSaved = (saved) => {
    if (saved !== contactPrefs.saved) updateContactPrefs({ saved });
  };

  // ---- Human takeover (a team member replying from the Chats page) ----
  const sinceReset = messages.slice(lastResetIndex + 1);
  const teamActive =
    sinceReset.findLast((m) => m.isSystem)?.kind === "team-joined";
  const lastAgentTime = sinceReset.findLast((m) => m.isAgent)?.serverTime;
  const lastActivity = sinceReset.findLast((m) => !m.isSystem)?.time ?? 0;

  const addSystemNote = (kind) => {
    const id = nextId++;
    setMessages((prev) => [
      ...prev,
      { id, isSystem: true, kind, text: SYSTEM_NOTES[kind], time: Date.now() },
    ]);
  };

  // Checks for team replies and takeover changes: every few seconds while
  // the team is in the chat, less often otherwise, and not at all once the
  // chat has gone quiet (nobody would be waiting on it).
  useEffect(() => {
    if (!open || !currentConversationId) return;
    const idleFor = Date.now() - lastActivity;
    if (!teamActive && idleFor > POLL_IDLE_CUTOFF_MS) return;
    if (teamActive && idleFor > TAKEOVER_WINDOW_MS) return;

    const timer = setInterval(
      async () => {
        // Nobody's looking at a background tab; catch up once it's back.
        if (document.hidden) return;
        const { data } = await callAskFaq({
          mode: "updates",
          conversationId: currentConversationId,
          visitorId: getVisitorId(),
          after: lastAgentTime,
        });
        if (!data || data.error) return;
        const incoming = (data.messages ?? []).map((r) => ({
          id: nextId++,
          answer: r.answer,
          isAgent: true,
          isLocal: true,
          serverId: r.id,
          serverTime: r.created_at,
          conversationId: currentConversationId,
          time: Date.now(),
        }));
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.serverId).filter(Boolean));
          const fresh = incoming.filter((m) => !seen.has(m.serverId));
          const notes = [];
          if (data.takeover && !teamActive) notes.push("team-joined");
          if (!data.takeover && teamActive) notes.push("team-left");
          if (!fresh.length && !notes.length) return prev;
          return [
            ...prev,
            ...notes
              .filter((k) => k === "team-joined")
              .map((kind) => ({
                id: nextId++,
                isSystem: true,
                kind,
                text: SYSTEM_NOTES[kind],
                time: Date.now(),
              })),
            ...fresh,
            ...notes
              .filter((k) => k === "team-left")
              .map((kind) => ({
                id: nextId++,
                isSystem: true,
                kind,
                text: SYSTEM_NOTES[kind],
                time: Date.now(),
              })),
          ];
        });
      },
      teamActive ? POLL_TEAM_MS : POLL_IDLE_MS,
    );
    return () => clearInterval(timer);
  }, [open, currentConversationId, teamActive, lastAgentTime, lastActivity]);

  const saveContact = async (details) => {
    const { data, error } = await callAskFaq({
      mode: "contact",
      contact: details,
      conversationId: getVisitorId(),
      visitorId: getVisitorId(),
    });
    if (error || data?.error) {
      console.error(error ?? data?.error);
      return false;
    }
    updateContactPrefs({ saved: true });
    setContactThanks(
      `Thanks${details.name ? `, ${details.name}` : ""}! Our team can reach you on ${details.phone}.`,
    );
    return true;
  };

  const dismissContact = () => updateContactPrefs({ dismissed: true });

  const copyText = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't copy to clipboard.");
    }
  };

  // Starting over: the AI forgets the chat, any takeover ends, and "Not
  // now" is forgotten so the details card can be offered again. (It stays
  // one conversation in the Chats page, with a reset marker.)
  const clearChat = () => {
    notifyReset();
    setMessages([]);
    setContactThanks(null);
    updateContactPrefs({ dismissed: false });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore — the in-memory state is already cleared either way.
    }
  };

  const startCorrection = (msg) =>
    patchMessage(msg.id, { correcting: true, correctedText: msg.answer });

  const saveCorrection = async (msg) => {
    if (!msg.correctedText.trim()) return;

    patchMessage(msg.id, { saving: true });
    const { data, error } = await supabase
      .from("faqs")
      .insert({
        question: msg.question,
        answer: msg.correctedText.trim(),
        category: CORRECTIONS_CATEGORY,
      })
      .select()
      .single();

    if (error) {
      toast.error("Couldn't save that. Check the Supabase setup.");
      console.error(error);
      patchMessage(msg.id, { saving: false });
      return;
    }

    toast.success(`Saved under "${CORRECTIONS_CATEGORY}"`);
    onSaved?.(data);
    patchMessage(msg.id, {
      saving: false,
      correcting: false,
      saved: true,
      answer: msg.correctedText.trim(),
    });
  };

  return (
    <div className={`faq-chat-popup ${open ? "faq-chat-popup-open" : ""}`}>
      <div className="faq-chat-header">
        {showGuidelines ? (
          <span className="faq-chat-title">
            <button
              type="button"
              onClick={() => setShowGuidelines(false)}
              className="faq-icon-btn"
              aria-label="Back to chat"
              title="Back to chat"
            >
              <ArrowLeft size={15} />
            </button>
            Improve AI
          </span>
        ) : (
          <span className="faq-chat-title">
            <Sparkles size={15} />
            Ask AI
          </span>
        )}
        <div className="faq-chat-header-actions">
          {canEdit && !showGuidelines && (
            <button
              type="button"
              onClick={() => setShowGuidelines(true)}
              className="faq-icon-btn faq-chat-improve-ai-btn"
              title="Improve AI: teach it how to answer"
            >
              <GraduationCap size={15} />
              Improve AI
            </button>
          )}
          {!showGuidelines && (
            <button
              type="button"
              onClick={clearChat}
              className="faq-icon-btn faq-danger"
              aria-label="Clear chat"
              title="Clear chat"
              disabled={messages.length === 0}
            >
              <Trash2 size={15} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="faq-icon-btn"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {showGuidelines ? (
        <div className="faq-chat-messages">
          <AiGuidelines />
        </div>
      ) : (
      <>
      <div className="faq-chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <p className="faq-chat-empty">
            Ask it anything a customer might. If a reply isn't quite right,
            hit "Improve answer" — saved answers collect under "
            {CORRECTIONS_CATEGORY}" so they're ready to hand off. It
            remembers the conversation; type "reset" to start fresh. Chats
            are saved so the team can review them.
          </p>
        )}

        {messages.map((m) => m.isSystem ? (
          <div key={m.id} className="faq-chat-system">{m.text}</div>
        ) : (
          <div key={m.id} className="faq-chat-turn">
            {m.question && (
            <>
            <div className="faq-chat-bubble faq-chat-user">{m.question}</div>
            <div className="faq-chat-meta faq-chat-meta-user">
              {m.awaitingTeam && (
                <span className="faq-chat-sent-team">Sent to the Ware team ·</span>
              )}
              <button
                type="button"
                className="faq-chat-copy-btn"
                onClick={() => copyText(m.question, `${m.id}-q`)}
                aria-label="Copy question"
                title="Copy"
              >
                {copiedKey === `${m.id}-q` ? (
                  <Check size={11} />
                ) : (
                  <Copy size={11} />
                )}
              </button>
              <span className="faq-chat-time">{formatTime(m.time)}</span>
            </div>
            </>
            )}

            {m.loading && (
              <div
                className="faq-chat-bubble faq-chat-ai faq-chat-typing"
                aria-label="Typing"
              >
                <span />
                <span />
                <span />
              </div>
            )}

            {m.error && (
              <div className="faq-chat-bubble faq-chat-ai faq-chat-error">
                {m.error}
              </div>
            )}

            {m.answer && !m.correcting && (
              <div
                className={`faq-chat-bubble faq-chat-ai${m.isAgent ? " faq-chat-team" : ""}`}
              >
                {m.isAgent && <span className="faq-chat-team-label">Ware team</span>}
                {linkify(m.answer)}
                {m.products?.length > 0 && (
                  <div className="faq-chat-products">
                    {m.products.map((p) => (
                      <ProductCard
                        key={p.url}
                        product={p}
                        restockState={
                          m.restockDone?.[p.url]
                            ? "done"
                            : m.restockOpen === p.url
                              ? "open"
                              : null
                        }
                        onCheckRestock={() =>
                          patchMessage(m.id, { restockOpen: p.url })
                        }
                      />
                    ))}
                  </div>
                )}
                {m.moreProducts?.length > 0 && (
                  <button
                    type="button"
                    className="faq-chat-similar-btn faq-chat-more-btn"
                    onClick={() => showMore(m)}
                  >
                    Show more
                  </button>
                )}
                {/* "Talk to a human" — the function only sends this link
                    when someone asks for the team, with a pre-filled
                    message carrying their name / products for context. */}
                {m.whatsappUrl && (
                  <a
                    href={m.whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="faq-chat-whatsapp-btn"
                  >
                    <MessageCircle size={15} />
                    Chat with us on WhatsApp
                  </a>
                )}
                {/* Gift packaging photos — only sent for gift packaging
                    questions, and only when real photos exist. */}
                {m.images?.length > 0 && (
                  <div className="faq-chat-products">
                    {m.images.map((img) => (
                      <a
                        key={img.src}
                        href={img.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="faq-chat-gift-image"
                      >
                        <img
                          src={img.src}
                          alt={`Gift packaging for ${img.productTitle}`}
                          loading="lazy"
                        />
                        <span>{img.productTitle}</span>
                      </a>
                    ))}
                  </div>
                )}
                {m.products
                  ?.filter((p) => m.restockOpen === p.url)
                  .map((p) => (
                    <RestockForm
                      key={p.url}
                      product={p}
                      onCancel={() => patchMessage(m.id, { restockOpen: null })}
                      onDone={(contact) =>
                        patchMessage(m.id, {
                          restockOpen: null,
                          restockDone: {
                            ...m.restockDone,
                            [p.url]: contact,
                          },
                        })
                      }
                    />
                  ))}
                {m.products
                  ?.filter((p) => m.restockDone?.[p.url])
                  .map((p) => (
                    <div key={p.url} className="faq-chat-restock-done">
                      Thanks! We'll check stock for the {p.title} and reach
                      out at {m.restockDone[p.url]}.
                    </div>
                  ))}
                {m.products
                  ?.filter((p) => p.similar?.length && !m.similarShown?.[p.url])
                  .map((p) => (
                    <div key={p.url} className="faq-chat-similar-offer">
                      {m.products.length > 1
                        ? `${p.title} is sold out right now. `
                        : ""}
                      Would you like to see similar products that are in
                      stock?
                      <button
                        type="button"
                        className="faq-chat-similar-btn"
                        onClick={() => showSimilar(m, p)}
                      >
                        Yes, show me
                      </button>
                    </div>
                  ))}
                <div className="faq-chat-bubble-actions">
                  <div className="faq-chat-meta">
                    <button
                      type="button"
                      className="faq-chat-copy-btn"
                      onClick={() => copyText(m.answer, `${m.id}-a`)}
                      aria-label="Copy answer"
                      title="Copy"
                    >
                      {copiedKey === `${m.id}-a` ? (
                        <Check size={11} />
                      ) : (
                        <Copy size={11} />
                      )}
                    </button>
                    <span className="faq-chat-time">
                      {formatTime(m.time)}
                    </span>
                  </div>
                  {m.isReset || m.isLocal ? null : m.saved ? (
                    <span className="faq-chat-saved">Saved ✓</span>
                  ) : (
                    <button
                      type="button"
                      className="faq-chat-improve-btn"
                      onClick={() => startCorrection(m)}
                    >
                      <Pencil size={12} />
                      Improve answer
                    </button>
                  )}
                </div>
              </div>
            )}

            {m.correcting && (
              <div className="faq-chat-bubble faq-chat-ai faq-chat-editing faq-edit-form">
                <textarea
                  value={m.correctedText}
                  onChange={(e) =>
                    patchMessage(m.id, { correctedText: e.target.value })
                  }
                  rows={4}
                  autoFocus
                />
                <div className="faq-edit-actions">
                  <button
                    type="button"
                    className="faq-btn faq-btn-ghost"
                    onClick={() => patchMessage(m.id, { correcting: false })}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="faq-btn faq-btn-primary"
                    disabled={m.saving}
                    onClick={() => saveCorrection(m)}
                  >
                    {m.saving ? "Saving..." : "Save improved answer"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {showContactCard && (
          <ContactCard onSave={saveContact} onDismiss={dismissContact} />
        )}
        {contactThanks && (
          <div className="faq-chat-bubble faq-chat-ai">{contactThanks}</div>
        )}
      </div>

      <form onSubmit={send} className="faq-chat-input-row">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a question like a customer would…"
        />
        <button type="submit" className="faq-chat-send-btn" aria-label="Send">
          <Send size={15} />
        </button>
      </form>
      </>
      )}
    </div>
  );
};

export default AskAi;
