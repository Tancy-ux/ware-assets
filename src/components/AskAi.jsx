import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Pencil, Send, Trash2, Copy, Check } from "lucide-react";
import { toast } from "react-toastify";
import { supabase } from "./supabase";

// Improved answers get saved as real rows in this category, so they're
// easy to find, review, and hand off — and since the ask-faq function
// reads straight from the faqs table, they immediately improve future
// answers too.
const CORRECTIONS_CATEGORY = "WhatsApp Bot FAQ";

// Chat history persists here so it survives refreshes/navigation — it's
// only ever cleared by the user hitting the clear button.
const STORAGE_KEY = "askAiChat";

// Set in .env.local (dev only) to test a locally running ask-faq function
// instead of the deployed one — see the note at the top of that function.
const LOCAL_ASK_FAQ_URL = import.meta.env.VITE_ASK_FAQ_URL;

const askFaq = async (question, history) => {
  if (!LOCAL_ASK_FAQ_URL) {
    return supabase.functions.invoke("ask-faq", {
      body: { question, history },
    });
  }
  try {
    const res = await fetch(LOCAL_ASK_FAQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, history }),
    });
    return { data: await res.json(), error: null };
  } catch (error) {
    return { data: null, error };
  }
};

// How much of the chat goes along with each question as context. The
// function caps turns too; this just avoids sending what it'd drop.
const HISTORY_MAX_TURNS = 10;
const HISTORY_MAX_AGE_MS = 30 * 60 * 60 * 1000;

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

// A product the AI recommended. Everything shown here comes from the
// Shopify catalog via the function, not from the model's text. Single-
// variant products add straight to the store's cart; ones with options
// (size, colour) go to the product page to pick.
const ProductCard = ({ product }) => {
  const action = !product.available
    ? { href: product.url, label: "View" }
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
      <a
        href={action.href}
        target="_blank"
        rel="noopener noreferrer"
        className={`faq-chat-product-btn${
          product.available ? "" : " faq-chat-product-btn-muted"
        }`}
      >
        {action.label}
      </a>
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
const AskAi = ({ open, onClose, onSaved }) => {
  const [messages, setMessages] = useState(loadStoredMessages);
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

    const id = nextId++;

    // "reset" starts a new conversation without wiping the visible chat —
    // handled right here, no AI call needed.
    if (/^\/?reset$/i.test(question)) {
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

    setMessages((prev) => [
      ...prev,
      {
        id,
        question,
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

    // Only the turns since the last "reset", and none older than
    // HISTORY_MAX_AGE_MS — a stale chat shouldn't color a new one.
    const lastReset = messages.findLastIndex((m) => m.isReset);
    const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
    const history = messages
      .slice(lastReset + 1)
      .filter((m) => m.answer && m.time > cutoff)
      .slice(-HISTORY_MAX_TURNS)
      .map(({ question, answer, products }) => ({
        question,
        answer,
        products: (products ?? []).map((p) => p.title),
      }));
    const { data, error } = await askFaq(question, history);

    if (error || data?.error) {
      console.error(error ?? data?.error);
      patchMessage(id, {
        loading: false,
        error: "Couldn't get an answer just now. Try again in a moment.",
      });
      return;
    }
    patchMessage(id, {
      loading: false,
      answer: data.answer,
      products: data.products ?? [],
    });
  };

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

  const clearChat = () => {
    setMessages([]);
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
        <span className="faq-chat-title">
          <Sparkles size={15} />
          Ask AI
        </span>
        <div className="faq-chat-header-actions">
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

      <div className="faq-chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <p className="faq-chat-empty">
            Ask it anything a customer might. If a reply isn't quite right,
            hit "Improve answer" — saved answers collect under "
            {CORRECTIONS_CATEGORY}" so they're ready to hand off. It
            remembers the conversation; type "reset" to start fresh.
          </p>
        )}

        {messages.map((m) => (
          <div key={m.id} className="faq-chat-turn">
            <div className="faq-chat-bubble faq-chat-user">{m.question}</div>
            <div className="faq-chat-meta faq-chat-meta-user">
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

            {m.loading && (
              <div className="faq-chat-bubble faq-chat-ai faq-chat-thinking">
                Thinking...
              </div>
            )}

            {m.error && (
              <div className="faq-chat-bubble faq-chat-ai faq-chat-error">
                {m.error}
              </div>
            )}

            {m.answer && !m.correcting && (
              <div className="faq-chat-bubble faq-chat-ai">
                {linkify(m.answer)}
                {m.products?.length > 0 && (
                  <div className="faq-chat-products">
                    {m.products.map((p) => (
                      <ProductCard key={p.url} product={p} />
                    ))}
                  </div>
                )}
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
                  {m.isReset ? null : m.saved ? (
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
    </div>
  );
};

export default AskAi;
