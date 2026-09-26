import { useState } from "react";

// Loose on purpose: people type +91, spaces, dashes.
const looksLikePhone = (s) => s.replace(/\D/g, "").length >= 7;

// Crisp-style "leave your details" prompt. Starts as a single line with a
// button, so it doesn't take over the chat; the name / phone fields only
// open when they choose to. Saving attaches them to this visitor's chat
// for the team in the Chats page.
const ContactCard = ({ onSave, onDismiss }) => {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!expanded) {
    return (
      <div className="faq-chat-bubble faq-chat-ai faq-chat-contact-prompt">
        Want our team to follow up with you?
        <div className="faq-chat-contact-prompt-actions">
          <button
            type="button"
            className="faq-chat-similar-btn"
            onClick={() => setExpanded(true)}
          >
            Enter your details
          </button>
          <button
            type="button"
            className="faq-chat-contact-skip"
            onClick={onDismiss}
          >
            Not now
          </button>
        </div>
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    if (!looksLikePhone(phone)) {
      setError("Please enter a valid phone number.");
      return;
    }
    setError("");
    setSaving(true);
    const ok = await onSave({ name: name.trim(), phone: phone.trim() });
    setSaving(false);
    if (!ok) setError("Couldn't save that just now. Please try again.");
  };

  return (
    <form
      className="faq-chat-bubble faq-chat-ai faq-chat-contact faq-edit-form"
      onSubmit={submit}
    >
      <div className="faq-chat-contact-title">
        Leave your name and number and our team will get back to you.
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        maxLength={100}
        autoComplete="name"
        autoFocus
      />
      <input
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Phone number"
        maxLength={30}
        autoComplete="tel"
        required
      />
      {error && <div className="faq-chat-contact-error">{error}</div>}
      <div className="faq-chat-contact-note">
        We'll only use this to get back to you about your enquiry.
      </div>
      <div className="faq-edit-actions">
        <button type="button" className="faq-btn faq-btn-ghost" onClick={onDismiss}>
          Not now
        </button>
        <button
          type="submit"
          className="faq-btn faq-btn-primary"
          disabled={saving || !phone.trim()}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
};

export default ContactCard;
