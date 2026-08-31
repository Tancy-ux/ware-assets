import { useState } from "react";
import { Sparkles, X, Pencil } from "lucide-react";
import { toast } from "react-toastify";
import { supabase } from "./supabase";

// Corrections get saved as real rows in this category, so they're easy to
// find and re-file later, and — since the ask-faq function reads straight
// from the faqs table — they immediately improve future AI answers too.
const CORRECTIONS_CATEGORY = "AI Corrections";

// Sends the question to the "ask-faq" Supabase Edge Function, which is
// the only place the Gemini API key ever lives — nothing AI-related
// touches the browser except this request/response.
const AskAi = ({ open, onClose, onSaved }) => {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [correcting, setCorrecting] = useState(false);
  const [correctedAnswer, setCorrectedAnswer] = useState("");
  const [saving, setSaving] = useState(false);

  const handleAsk = async (e) => {
    e.preventDefault();
    if (!question.trim() || loading) return;

    setLoading(true);
    setError("");
    setAnswer("");
    setCorrecting(false);

    const { data, error: fnError } = await supabase.functions.invoke(
      "ask-faq",
      { body: { question: question.trim() } },
    );
    setLoading(false);

    if (fnError || data?.error) {
      setError("Couldn't get an answer just now. Try again in a moment.");
      console.error(fnError ?? data?.error);
      return;
    }
    setAnswer(data.answer);
  };

  const startCorrection = () => {
    setCorrectedAnswer(answer);
    setCorrecting(true);
  };

  const handleSaveCorrection = async (e) => {
    e.preventDefault();
    if (!correctedAnswer.trim()) return;

    setSaving(true);
    const { data, error } = await supabase
      .from("faqs")
      .insert({
        question: question.trim(),
        answer: correctedAnswer.trim(),
        category: CORRECTIONS_CATEGORY,
      })
      .select()
      .single();
    setSaving(false);

    if (error) {
      toast.error("Couldn't save that correction. Check the Supabase setup.");
      console.error(error);
      return;
    }

    toast.success('Saved under "AI Corrections" — it\'ll also improve future answers.');
    onSaved?.(data);
    setCorrecting(false);
  };

  if (!open) return null;

  return (
    <div className="faq-add-panel">
      <div className="faq-qa-question">
        <h3 className="faq-ask-ai-title">
          <Sparkles size={15} />
          Ask AI
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="faq-icon-btn"
          aria-label="Close"
        >
          <X size={15} />
        </button>
      </div>

      <form onSubmit={handleAsk} className="faq-edit-form">
        <label>Ask anything covered in the FAQs</label>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. do you ship internationally?"
        />
        <div className="faq-edit-actions">
          <button
            type="submit"
            disabled={loading}
            className="faq-btn faq-btn-primary"
          >
            {loading ? "Thinking..." : "Ask"}
          </button>
        </div>
      </form>

      {error && <p className="faq-ask-ai-error">{error}</p>}

      {answer && (
        <div className="faq-ask-ai-answer">
          <p className="faq-qa-answer">{answer}</p>
          <p className="faq-ask-ai-disclaimer">
            AI-generated from our FAQ content. Always double check anything
            important.
          </p>

          {!correcting && (
            <button
              type="button"
              className="faq-btn faq-ask-ai-correct-btn"
              onClick={startCorrection}
            >
              <Pencil size={13} />
              Not quite right? Correct it
            </button>
          )}

          {correcting && (
            <form
              onSubmit={handleSaveCorrection}
              className="faq-edit-form faq-ask-ai-correct-form"
            >
              <label>Corrected answer</label>
              <textarea
                value={correctedAnswer}
                onChange={(e) => setCorrectedAnswer(e.target.value)}
                rows={4}
                required
              />
              <div className="faq-edit-actions">
                <button
                  type="button"
                  onClick={() => setCorrecting(false)}
                  className="faq-btn faq-btn-ghost"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="faq-btn faq-btn-primary"
                >
                  {saving ? "Saving..." : "Save as FAQ"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
};

export default AskAi;
