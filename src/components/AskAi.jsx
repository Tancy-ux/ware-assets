import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { supabase } from "./supabase";

// Sends the question to the "ask-faq" Supabase Edge Function, which is
// the only place the Gemini API key ever lives — nothing AI-related
// touches the browser except this request/response.
const AskAi = ({ open, onClose }) => {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleAsk = async (e) => {
    e.preventDefault();
    if (!question.trim() || loading) return;

    setLoading(true);
    setError("");
    setAnswer("");

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
        </div>
      )}
    </div>
  );
};

export default AskAi;
