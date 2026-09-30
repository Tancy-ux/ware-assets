import { useState } from "react";
import { TEXTS, fillText } from "../lib/chatTexts";

// "Pinky Sharma" -> "Pinky", capitalised, for "Thanks, Pinky!".
const firstName = (name) => {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first.charAt(0).toUpperCase() + first.slice(1);
};

// Loose on purpose: people type +91, spaces, dashes.
const looksLikePhone = (s) => s.replace(/\D/g, "").length >= 7;

// Crisp-style "leave your details" prompt. Starts as a single line with a
// button, so it doesn't take over the chat; the name / phone fields only
// open when they choose to. Saving attaches them to this visitor's chat
// for the team in the Chats page. With startOpen (the reply just asked if
// the team can call them) the form shows straight away. `title` and
// `children` (shown under the buttons) let other flows reuse the form.
const ContactCard = ({
  onSave,
  onDismiss,
  startOpen = false,
  initialName = "",
  // A logged-in customer's number, to confirm or change.
  initialPhone = "",
  title,
  // The title when the name's known ({name} is filled in).
  titleNamed,
  children,
}) => {
  const [expanded, setExpanded] = useState(startOpen);
  // Already told us their name? Then only the number is asked for (the
  // name box is left out). A name that arrives while the card is open
  // (a reply just picked it up) counts too.
  const [name, setName] = useState(initialName);
  const [knownName, setKnownName] = useState(initialName);
  if (initialName !== knownName) {
    setKnownName(initialName);
    if (initialName && !name.trim()) setName(initialName);
  }
  const askName = !knownName.trim();
  const [phone, setPhone] = useState(initialPhone);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!expanded) {
    return (
      <div className="faq-chat-bubble faq-chat-ai faq-chat-contact-prompt">
        {TEXTS.contactPrompt}
        <div className="faq-chat-contact-prompt-actions">
          <button
            type="button"
            className="faq-chat-similar-btn"
            onClick={() => setExpanded(true)}
          >
            {TEXTS.contactPromptButton}
          </button>
          <button
            type="button"
            className="faq-chat-contact-skip"
            onClick={onDismiss}
          >
            {TEXTS.notNow}
          </button>
        </div>
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    if (!looksLikePhone(phone)) {
      setError(TEXTS.invalidPhone);
      return;
    }
    setError("");
    setSaving(true);
    const ok = await onSave({ name: name.trim(), phone: phone.trim() });
    setSaving(false);
    if (!ok) setError(TEXTS.saveFailed);
  };

  return (
    <form
      className="faq-chat-bubble faq-chat-ai faq-chat-contact faq-edit-form"
      onSubmit={submit}
    >
      <div className="faq-chat-contact-title">
        {askName
          ? (title ??
            (startOpen ? TEXTS.contactFormTitleCall : TEXTS.contactFormTitle))
          : fillText(
              titleNamed ??
                (startOpen
                  ? TEXTS.contactFormTitleCallNamed
                  : TEXTS.contactFormTitleNamed),
              { name: firstName(knownName) },
            )}
      </div>
      {askName && (
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={TEXTS.namePlaceholder}
          maxLength={100}
          autoComplete="name"
          // Only when they asked for the form, so it doesn't pull the
          // phone keyboard up on its own.
          autoFocus={!startOpen}
        />
      )}
      <input
        type="tel"
        // With the name known, the number is the only field.
        autoFocus={!askName && !startOpen}
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder={TEXTS.phonePlaceholder}
        maxLength={30}
        autoComplete="tel"
        required
      />
      {error && <div className="faq-chat-contact-error">{error}</div>}
      <div className="faq-chat-contact-note">
        {fillText(TEXTS.contactFormNote)}
      </div>
      <div className="faq-edit-actions">
        <button type="button" className="faq-btn faq-btn-ghost" onClick={onDismiss}>
          {TEXTS.notNow}
        </button>
        <button
          type="submit"
          className="faq-btn faq-btn-primary"
          disabled={saving || !phone.trim()}
        >
          {saving ? TEXTS.saving : TEXTS.save}
        </button>
      </div>
      {children}
    </form>
  );
};

export default ContactCard;
