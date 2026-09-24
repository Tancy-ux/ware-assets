import { useState } from "react";
import { toast } from "react-toastify";
import { supabase } from "./supabase";

// Loose on purpose: people type numbers with spaces, +91, dashes, etc.
const looksLikeContact = (s) =>
  /^\S+@\S+\.\S+$/.test(s) || s.replace(/\D/g, "").length >= 7;

// "Check restock" for a sold-out card: saves who to contact into the
// restock_requests table, which the team reviews in Supabase. The site can
// only insert there, never read it back (it's customers' contact details).
const RestockForm = ({ product, onDone, onCancel }) => {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const trimmed = contact.trim();
    if (!looksLikeContact(trimmed)) {
      toast.error("Please enter a phone number or email.");
      return;
    }
    setSaving(true);
    // No .select() — there's no read policy on this table, by design.
    const { error } = await supabase.from("restock_requests").insert({
      product_title: product.title,
      product_url: product.url,
      name: name.trim() || null,
      contact: trimmed,
    });
    setSaving(false);
    if (error) {
      console.error(error);
      toast.error("Couldn't send that just now. Please try again.");
      return;
    }
    onDone(trimmed);
  };

  return (
    <form className="faq-chat-restock faq-edit-form" onSubmit={submit}>
      <div className="faq-chat-restock-title">
        We'll check stock for the {product.title} and get back to you.
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name (optional)"
        maxLength={100}
        autoComplete="name"
      />
      <input
        type="text"
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        placeholder="Phone or email"
        maxLength={200}
        autoComplete="email"
        autoFocus
        required
      />
      <div className="faq-edit-actions">
        <button type="button" className="faq-btn faq-btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="faq-btn faq-btn-primary"
          disabled={saving || !contact.trim()}
        >
          {saving ? "Sending..." : "Check restock"}
        </button>
      </div>
    </form>
  );
};

export default RestockForm;
