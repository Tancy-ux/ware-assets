import { useState } from "react";
import { X } from "lucide-react";
import { TEXTS } from "../lib/chatTexts";

// "What should we call you?" under the chat's first few replies, for
// people who skipped the welcome's name question. One field; it goes to
// the team's Chats page and the assistant starts using it.
// With `phone`, the same box asks for an optional number instead (straight
// after they give their name), with `note` under it.
const NameCard = ({ onSave, onDismiss, phone = false, title, note, closeLabel }) => {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    // Loose, like the details form: people type +91, spaces and dashes.
    if (phone && name.replace(/\D/g, "").length < 7) {
      setError(TEXTS.invalidPhone);
      return;
    }
    setError("");
    setSaving(true);
    const ok = await onSave(name.trim());
    setSaving(false);
    if (!ok) setError(TEXTS.saveFailed);
  };

  return (
    <form className="faq-chat-name-card" onSubmit={submit}>
      <div className="faq-chat-name-card-top">
        <span>{title ?? TEXTS.nameBoxTitle}</span>
        <button
          type="button"
          className="faq-chat-name-card-close"
          onClick={onDismiss}
          aria-label={closeLabel ?? TEXTS.notNow}
          title={closeLabel ?? TEXTS.notNow}
        >
          <X size={14} />
        </button>
      </div>
      <div className="faq-chat-name-card-row">
        <input
          type={phone ? "tel" : "text"}
          inputMode={phone ? "tel" : undefined}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={phone ? TEXTS.phonePlaceholder : TEXTS.namePlaceholder}
          maxLength={phone ? 20 : 60}
          autoComplete={phone ? "tel" : "given-name"}
        />
        <button
          type="submit"
          className="faq-btn faq-btn-primary"
          disabled={saving || !name.trim()}
        >
          {saving ? TEXTS.saving : TEXTS.save}
        </button>
      </div>
      {error && <div className="faq-chat-contact-error">{error}</div>}
      {note && !error && <div className="faq-chat-name-card-note">{note}</div>}
    </form>
  );
};

export default NameCard;
