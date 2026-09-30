import { useEffect, useRef, useState } from "react";
import { MessageSquareText, Plus, Smile, X } from "lucide-react";
import { toast } from "react-toastify";

// The reply box's helpers: your saved messages (each login has its own,
// kept by chat-admin in chat_quick_replies) and a few emojis. Picking one
// puts it in the box to edit or send; nothing is sent by itself.
// "{name}" in a saved message becomes the visitor's first name.

const EMOJIS = [
  "😊", "🙂", "😄", "🙏", "👍", "👌", "🙌", "✨",
  "🎉", "❤️", "💛", "🌸", "🎁", "☕", "🍽️", "📦",
  "🚚", "📞", "📍", "⏰", "✅", "👉", "💬", "😇",
];

const firstName = (name) => (name ?? "").trim().split(/\s+/)[0] ?? "";
const fillName = (text, visitorName) =>
  text.replace(/\{name\}/gi, firstName(visitorName) || "there");

const ChatQuickReplies = ({ api, visitorName, onInsert }) => {
  const [open, setOpen] = useState(null); // "saved" | "emoji" | null
  const [replies, setReplies] = useState(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const box = useRef(null);

  // Loaded the first time the list opens.
  useEffect(() => {
    if (open !== "saved" || replies) return;
    let cancelled = false;
    api({ action: "quick-list" }).then((res) => {
      if (!cancelled) setReplies(res?.replies ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [open, replies, api]);

  // Closes on a click outside or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(null);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const add = async (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || saving) return;
    setSaving(true);
    const res = await api({ action: "quick-save", text });
    setSaving(false);
    if (!res?.reply) return;
    setReplies((prev) => [...(prev ?? []), res.reply]);
    setDraft("");
  };

  const remove = async (r) => {
    const res = await api({ action: "quick-delete", id: r.id });
    if (!res) return;
    setReplies((prev) => prev.filter((x) => x.id !== r.id));
    toast.success("Saved message removed");
  };

  return (
    <div className="chats-quick" ref={box}>
      <button
        type="button"
        className={`chats-icon-btn${open === "saved" ? " chats-quick-on" : ""}`}
        onClick={() => setOpen(open === "saved" ? null : "saved")}
        aria-label="Saved messages"
        title="Saved messages"
      >
        <MessageSquareText size={17} />
      </button>
      <button
        type="button"
        className={`chats-icon-btn${open === "emoji" ? " chats-quick-on" : ""}`}
        onClick={() => setOpen(open === "emoji" ? null : "emoji")}
        aria-label="Emoji"
        title="Emoji"
      >
        <Smile size={17} />
      </button>

      {open === "saved" && (
        <div className="chats-quick-pop" role="dialog" aria-label="Saved messages">
          <h4>Saved messages</h4>
          <div className="chats-quick-list">
            {!replies && <p className="chats-results-note">Loading…</p>}
            {replies?.length === 0 && (
              <p className="chats-results-note">
                Nothing saved yet. Add the lines you send often below; only you
                see yours. Use {"{name}"} for their first name.
              </p>
            )}
            {replies?.map((r) => (
              <div key={r.id} className="chats-quick-item">
                <button
                  type="button"
                  onClick={() => {
                    onInsert(fillName(r.text, visitorName));
                    setOpen(null);
                  }}
                >
                  {r.text}
                </button>
                <button
                  type="button"
                  className="chats-quick-remove"
                  onClick={() => remove(r)}
                  aria-label="Remove saved message"
                  title="Remove"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
          {/* Not a <form>: it sits inside the reply box's form. */}
          <div className="chats-quick-add">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) add(e);
              }}
              placeholder="Add a saved message… e.g. Hi {name}! Thanks for reaching out 😊"
              rows={2}
              maxLength={1000}
            />
            <button
              type="button"
              className="chats-btn chats-btn-primary"
              onClick={add}
              disabled={!draft.trim() || saving}
            >
              <Plus size={14} /> Add
            </button>
          </div>
        </div>
      )}

      {open === "emoji" && (
        <div className="chats-quick-pop chats-quick-emoji" role="dialog" aria-label="Emoji">
          {EMOJIS.map((e) => (
            <button key={e} type="button" onClick={() => onInsert(e, true)}>
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ChatQuickReplies;
