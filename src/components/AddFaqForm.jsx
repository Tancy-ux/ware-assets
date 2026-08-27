import { useState } from "react";
import { toast } from "react-toastify";
import { X } from "lucide-react";
import { supabase } from "./supabase";

const AddFaqForm = ({ open, onClose, categories, onAdded }) => {
  const [saving, setSaving] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [category, setCategory] = useState("");
  const [internal, setInternal] = useState(false);

  const reset = () => {
    setQuestion("");
    setAnswer("");
    setCategory("");
    setInternal(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!question.trim() || !answer.trim()) return;

    setSaving(true);
    const { data, error } = await supabase
      .from("faqs")
      .insert({
        question: question.trim(),
        answer: answer.trim(),
        category: category.trim() || "General",
        internal,
      })
      .select()
      .single();
    setSaving(false);

    if (error) {
      toast.error("Couldn't save that question. Check the Supabase setup.");
      console.error(error);
      return;
    }

    toast.success("Question added");
    onAdded(data);
    reset();
    onClose();
  };

  if (!open) return null;

  return (
    <form onSubmit={handleSubmit} className="faq-add-panel">
      <div className="faq-qa-question">
        <h3>Add a new question</h3>
        <button
          type="button"
          onClick={onClose}
          className="faq-icon-btn"
          aria-label="Close"
        >
          <X size={15} />
        </button>
      </div>

      <div className="faq-edit-form">
        <label>Question</label>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          required
        />

        <label>Answer</label>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          required
          rows={3}
        />

        <label>Category</label>
        <input
          type="text"
          list="faq-category-options"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="e.g. Retail Shopping"
        />
        <datalist id="faq-category-options">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>

        <label className="faq-checkbox-row" style={{ textTransform: "none", letterSpacing: 0 }}>
          <input
            type="checkbox"
            checked={internal}
            onChange={(e) => setInternal(e.target.checked)}
            style={{ width: "auto" }}
          />
          Internal / team note (kept separate from customer-facing FAQs)
        </label>

        <div className="faq-edit-actions">
          <button type="button" onClick={onClose} className="faq-btn faq-btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="faq-btn faq-btn-primary">
            {saving ? "Saving..." : "Save question"}
          </button>
        </div>
      </div>
    </form>
  );
};

export default AddFaqForm;
