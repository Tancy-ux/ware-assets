import { useEffect, useMemo, useState } from "react";
import { Search, X, Pencil, Trash2, ChevronRight, ChevronDown } from "lucide-react";
import { toast } from "react-toastify";
import { supabase } from "./supabase";
import AddFaqForm from "./AddFaqForm";

function matches(faq, terms) {
  const haystack = `${faq.question} ${faq.answer}`.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function highlight(text, terms) {
  if (!terms.length) return text;
  const pattern = new RegExp(
    `(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );
  return text.split(pattern).map((part, i) =>
    terms.some((t) => part.toLowerCase() === t) ? (
      <mark key={i} className="bg-[#c9d6b4] text-inherit rounded px-0.5">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function truncateWords(text, maxWords = 8) {
  const words = text.trim().split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ") + "…";
}

function groupByCategory(faqs) {
  const groups = new Map();
  for (const faq of faqs) {
    const key = faq.category || "General";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(faq);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function NavGroup({ name, items, tone, expanded, onToggle, selectedId, onSelect }) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-semibold uppercase tracking-wide hover:opacity-100 transition ${tone}`}
      >
        <span className="text-left wrap-break-word opacity-80">{name}</span>
        <span className="flex items-center gap-1.5 shrink-0 opacity-60">
          {items.length}
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>
      {expanded && (
        <div className="flex flex-col mt-1 mb-2">
          {items.map((faq) => (
            <button
              key={faq.id}
              type="button"
              onClick={() => onSelect(faq.id)}
              className={`text-left px-3 py-2 rounded-lg text-sm transition wrap-break-word ${
                faq.id === selectedId
                  ? "bg-green text-white font-medium"
                  : "text-gray-700 hover:bg-black/5"
              }`}
            >
              {truncateWords(faq.question)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function QuestionDetail({ faq, terms, canEdit, onUpdated, onDeleted }) {
  const [editing, setEditing] = useState(false);
  const [question, setQuestion] = useState(faq.question);
  const [answer, setAnswer] = useState(faq.answer);
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setQuestion(faq.question);
    setAnswer(faq.answer);
    setEditing(true);
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this question? This can't be undone.")) return;

    const { data, error } = await supabase
      .from("faqs")
      .delete()
      .eq("id", faq.id)
      .select();
    if (error || !data?.length) {
      toast.error("Couldn't delete that question. Check the Supabase setup.");
      console.error(
        error ??
          "Delete matched no rows — check the delete policy in Supabase.",
      );
      return;
    }
    toast.success("Question deleted");
    onDeleted(faq.id);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!question.trim() || !answer.trim()) return;

    setSaving(true);
    const { data, error } = await supabase
      .from("faqs")
      .update({
        question: question.trim(),
        answer: answer.trim(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", faq.id)
      .select()
      .single();
    setSaving(false);

    if (error) {
      toast.error("Couldn't save your changes.");
      console.error(error);
      return;
    }
    toast.success("Saved");
    onUpdated(data);
    setEditing(false);
  };

  if (editing) {
    return (
      <form
        onSubmit={handleSave}
        className="bg-white rounded-2xl shadow-sm p-6 sm:p-8 border-2 border-green/30 flex flex-col gap-3"
      >
        <label className="text-xs font-semibold uppercase tracking-wide opacity-60">
          Question
        </label>
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          required
          className="input input-bordered w-full font-medium bg-white text-gray-900"
        />
        <label className="text-xs font-semibold uppercase tracking-wide opacity-60">
          Answer
        </label>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          required
          rows={8}
          className="textarea textarea-bordered w-full text-sm bg-white text-gray-900"
        />
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="btn btn-ghost btn-sm rounded-full"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="btn btn-sm rounded-full bg-green text-white px-6 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-6 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-green mb-2">
        {faq.category || "General"}
      </p>
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-xl font-semibold wrap-break-word">
          {highlight(faq.question, terms)}
        </h2>
        {canEdit && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={startEdit}
              title="Edit this question"
              className="p-2 rounded-full opacity-50 hover:opacity-100 hover:bg-black/5"
            >
              <Pencil size={16} />
            </button>
            <button
              type="button"
              onClick={handleDelete}
              title="Delete this question"
              className="p-2 rounded-full opacity-50 hover:opacity-100 hover:bg-red-100 hover:text-red-600"
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </div>
      <p className="text-gray-700 mt-4 whitespace-pre-line wrap-break-word leading-relaxed">
        {highlight(faq.answer, terms)}
      </p>
    </div>
  );
}

const Faq = () => {
  const [query, setQuery] = useState("");
  const [faqs, setFaqs] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [selectedId, setSelectedId] = useState(null);
  const [expandedCategories, setExpandedCategories] = useState(new Set());
  const canEdit = localStorage.getItem("auth") === "true";

  useEffect(() => {
    supabase
      .from("faqs")
      .select("*")
      .order("category", { ascending: true })
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (error) {
          console.error(error);
          setStatus("error");
          return;
        }
        setFaqs(data ?? []);
        setStatus("ready");
      });
  }, []);

  const categoryNames = useMemo(
    () =>
      [...new Set(faqs.map((f) => f.category || "General"))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [faqs],
  );

  const terms = useMemo(
    () => query.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [query],
  );

  const results = useMemo(() => {
    if (!terms.length) return faqs;
    return faqs.filter((faq) => matches(faq, terms));
  }, [faqs, terms]);

  const publicGroups = groupByCategory(results.filter((f) => !f.internal));
  const internalGroups = groupByCategory(results.filter((f) => f.internal));

  // Searching should surface matches immediately, and picking the first one
  // means the answer shows up on the right without an extra click.
  useEffect(() => {
    if (!terms.length) return;
    if (results.some((f) => f.id === selectedId)) return;
    setSelectedId(results[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terms, results]);

  const toggleCategory = (name) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleAdded = (row) => setFaqs((prev) => [...prev, row]);
  const handleUpdated = (row) =>
    setFaqs((prev) => prev.map((f) => (f.id === row.id ? row : f)));
  const handleDeleted = (id) => {
    setFaqs((prev) => prev.filter((f) => f.id !== id));
    setSelectedId((prev) => (prev === id ? null : prev));
  };

  const selectedFaq = faqs.find((f) => f.id === selectedId) ?? null;
  const isSearching = terms.length > 0;

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-8 max-w-6xl mx-auto text-gray-800">
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-semibold">FAQs</h1>
        <p className="text-sm opacity-70 mt-1 max-w-xl">
          Pick a question on the left to see its answer, or search for a topic.
        </p>
      </div>

      <div className="relative mb-6 max-w-2xl">
        <Search
          size={20}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-green"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a word to search, e.g. shipping, returns, MOQ..."
          className="w-full rounded-full pl-12 pr-12 py-3.5 text-base bg-white border-2 border-gray-200 shadow-sm focus:outline-none focus:border-green focus:ring-4 focus:ring-green/10 transition"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            title="Clear search"
            className="absolute right-4 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {canEdit && (
        <AddFaqForm categories={categoryNames} onAdded={handleAdded} />
      )}

      {status === "loading" && (
        <p className="text-center py-16 text-gray-500">Loading FAQs...</p>
      )}

      {status === "error" && (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg font-medium">Couldn't load the FAQs</p>
          <p className="text-sm mt-1">
            Please refresh the page, or try again shortly.
          </p>
        </div>
      )}

      {status === "ready" && results.length === 0 && (
        <div className="text-center py-16 text-gray-500">
          <p className="text-lg font-medium">No matching questions</p>
          <p className="text-sm mt-1">Try a different search term.</p>
        </div>
      )}

      {status === "ready" && results.length > 0 && (
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <nav className="w-full lg:w-80 lg:shrink-0 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto bg-white rounded-2xl shadow-sm p-3 flex flex-col gap-0.5">
            {publicGroups.map(([name, items]) => (
              <NavGroup
                key={name}
                name={name}
                items={items}
                tone="bg-[#dbe4cd] opacity-90"
                expanded={isSearching || expandedCategories.has(name)}
                onToggle={() => toggleCategory(name)}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            ))}

            {internalGroups.length > 0 && (
              <div className="pt-3 mt-1 border-t border-dashed border-gray-300">
                <p className="text-[11px] uppercase tracking-wide opacity-50 px-3 mb-1">
                  Internal / team notes
                </p>
                {internalGroups.map(([name, items]) => (
                  <NavGroup
                    key={name}
                    name={name}
                    items={items}
                    tone="bg-amber-100/80"
                    expanded={isSearching || expandedCategories.has(name)}
                    onToggle={() => toggleCategory(name)}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                  />
                ))}
              </div>
            )}
          </nav>

          <main className="flex-1 min-w-0 w-full">
            {selectedFaq ? (
              <QuestionDetail
                key={selectedFaq.id}
                faq={selectedFaq}
                terms={terms}
                canEdit={canEdit}
                onUpdated={handleUpdated}
                onDeleted={handleDeleted}
              />
            ) : (
              <div className="bg-white rounded-2xl shadow-sm p-10 text-center text-gray-500">
                <p className="text-lg font-medium">👈 Pick a question</p>
                <p className="text-sm mt-1">
                  Click any question on the left to see its answer here.
                </p>
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
};

export default Faq;
