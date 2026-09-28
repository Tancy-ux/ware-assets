import { useState } from "react";
import { X } from "lucide-react";

// "What should we call you?" under the chat's first few replies, for
// people who skipped the welcome's name question. One field; it goes to
// the team's Chats page and the assistant starts using it.
const NameCard = ({ onSave, onDismiss }) => {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setError("");
    setSaving(true);
    const ok = await onSave(name.trim());
    setSaving(false);
    if (!ok) setError("Couldn't save that just now. Please try again.");
  };

  return (
    <form className="faq-chat-name-card" onSubmit={submit}>
      <div className="faq-chat-name-card-top">
        <span>What should we call you?</span>
        <button
          type="button"
          className="faq-chat-name-card-close"
          onClick={onDismiss}
          aria-label="No thanks"
          title="No thanks"
        >
          <X size={14} />
        </button>
      </div>
      <div className="faq-chat-name-card-row">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          maxLength={60}
          autoComplete="given-name"
        />
        <button
          type="submit"
          className="faq-btn faq-btn-primary"
          disabled={saving || !name.trim()}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
      {error && <div className="faq-chat-contact-error">{error}</div>}
    </form>
  );
};

export default NameCard;
