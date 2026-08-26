import { useState } from "react";
import { toast } from "react-toastify";
import { Plus, X } from "lucide-react";
import { supabase } from "./supabase";

const AddFaqForm = ({ categories, onAdded }) => {
  const [open, setOpen] = useState(false);
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
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="btn btn-outline btn-sm rounded-full flex items-center gap-2 mb-8"
      >
        <Plus size={15} />
        Add a question
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-[#eef2e8] rounded-xl shadow-sm p-5 mb-8 flex flex-col gap-3"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Add a new question</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="opacity-60 hover:opacity-100"
        >
          <X size={18} />
        </button>
      </div>

      <input
        type="text"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Question"
        required
        className="input input-bordered w-full bg-white/60"
      />

      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        placeholder="Answer"
        required
        rows={3}
        className="textarea textarea-bordered w-full bg-white/60"
      />

      <input
        type="text"
        list="faq-category-options"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        placeholder="Category (e.g. Retail Shopping)"
        className="input input-bordered w-full bg-white/60"
      />
      <datalist id="faq-category-options">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <label className="flex items-center gap-2 text-sm opacity-80">
        <input
          type="checkbox"
          checked={internal}
          onChange={(e) => setInternal(e.target.checked)}
          className="checkbox checkbox-sm"
        />
        Internal / team note (kept separate from customer-facing FAQs)
      </label>

      <button
        type="submit"
        disabled={saving}
        className="btn btn-sm rounded-full bg-green text-white self-start px-6 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save question"}
      </button>
    </form>
  );
};

export default AddFaqForm;
