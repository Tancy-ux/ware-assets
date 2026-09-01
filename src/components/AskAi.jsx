import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Pencil, Send } from "lucide-react";
import { toast } from "react-toastify";
import { supabase } from "./supabase";

// Improved answers get saved as real rows in this category, so they're
// easy to find, review, and hand off — and since the ask-faq function
// reads straight from the faqs table, they immediately improve future
// answers too.
const CORRECTIONS_CATEGORY = "WhatsApp Bot FAQ";

let nextId = 1;

// A small chat popup for testing the FAQ bot turn by turn. Each question
// is answered independently (no conversation memory is sent to the
// model) — that matches how the FAQ itself works and keeps things simple.
const AskAi = ({ open, onClose, onSaved }) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const listRef = useRef(null);

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
      },
    ]);

    const { data, error } = await supabase.functions.invoke("ask-faq", {
      body: { question },
    });

    if (error || data?.error) {
      console.error(error ?? data?.error);
      patchMessage(id, {
        loading: false,
        error: "Couldn't get an answer just now. Try again in a moment.",
      });
      return;
    }
    patchMessage(id, { loading: false, answer: data.answer });
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
        <button
          type="button"
          onClick={onClose}
          className="faq-icon-btn"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      <div className="faq-chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <p className="faq-chat-empty">
            Ask it anything a customer might. If a reply isn't quite right,
            hit "Improve answer" — saved answers collect under "
            {CORRECTIONS_CATEGORY}" so they're ready to hand off.
          </p>
        )}

        {messages.map((m) => (
          <div key={m.id} className="faq-chat-turn">
            <div className="faq-chat-bubble faq-chat-user">{m.question}</div>

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
                {m.answer}
                <div className="faq-chat-bubble-actions">
                  {m.saved ? (
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
