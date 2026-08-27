import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, Pencil, Trash2, Download, Plus } from "lucide-react";
import { toast } from "react-toastify";
import jsPDF from "jspdf";
import { supabase } from "./supabase";
import AddFaqForm from "./AddFaqForm";
import "./Faq.css";

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
      <mark key={i}>{part}</mark>
    ) : (
      part
    ),
  );
}

function truncateWords(text, maxWords = 9) {
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

function displayCategory(name, internal) {
  return internal ? `Internal — ${name}` : name;
}

// Builds a simple, readable PDF of every public (non-internal) question and
// answer, grouped by category, and triggers a browser download. Internal /
// team-note content is deliberately left out of this export.
function downloadFaqsPdf(faqs) {
  const groups = groupByCategory(faqs.filter((f) => !f.internal));
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 50;
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  const ensureSpace = (needed) => {
    if (y + needed > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Ware Innovations — FAQs", margin, y);
  y += 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(`Downloaded ${new Date().toLocaleDateString()}`, margin, y);
  doc.setTextColor(0);
  y += 30;

  for (const [category, items] of groups) {
    ensureSpace(28);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(category, margin, y);
    y += 20;

    for (const faq of items) {
      const qLines = doc.splitTextToSize(faq.question, maxWidth);
      const aLines = doc.splitTextToSize(faq.answer, maxWidth);
      ensureSpace(qLines.length * 14 + aLines.length * 13 + 20);

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(qLines, margin, y);
      y += qLines.length * 14 + 4;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(aLines, margin, y);
      y += aLines.length * 13 + 16;
    }
    y += 8;
  }

  doc.save(`ware-faqs-${new Date().toISOString().slice(0, 10)}.pdf`);
}

function CategoryTab({
  name,
  items,
  internal,
  active,
  onSelectCategory,
  activeQuestionId,
  onSelectQuestion,
}) {
  return (
    <div className="faq-category">
      <button
        type="button"
        className={`faq-category-head ${internal ? "faq-internal" : ""} ${active ? "faq-active" : ""}`}
        onClick={onSelectCategory}
      >
        <span className="faq-label">{displayCategory(name, internal)}</span>
        <span className="faq-meta">
          <span className="faq-count">{items.length}</span>
        </span>
      </button>
      {active && (
        <div className="faq-question-list">
          {items.map((faq) => (
            <button
              key={faq.id}
              type="button"
              className={`faq-question-item ${faq.id === activeQuestionId ? "faq-active" : ""}`}
              onClick={() => onSelectQuestion(faq.id)}
            >
              {truncateWords(faq.question)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function QaEntry({ faq, terms, canEdit, isActive, onUpdated, onDeleted }) {
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

  return (
    <section
      data-faq-id={faq.id}
      className={`faq-qa-entry ${isActive ? "faq-highlight" : ""}`}
    >
      <p className="faq-qa-eyebrow">
        {displayCategory(faq.category || "General", faq.internal)}
      </p>

      {editing ? (
        <form onSubmit={handleSave} className="faq-edit-form">
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
            rows={5}
          />
          <div className="faq-edit-actions">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="faq-btn faq-btn-ghost"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="faq-btn faq-btn-primary"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="faq-qa-question">
            <h2>{highlight(faq.question, terms)}</h2>
            {canEdit && (
              <div className="faq-qa-actions">
                <button
                  type="button"
                  onClick={startEdit}
                  className="faq-icon-btn"
                  aria-label="Edit"
                >
                  <Pencil size={15} />
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="faq-icon-btn faq-danger"
                  aria-label="Delete"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            )}
          </div>
          <p className="faq-qa-answer">{highlight(faq.answer, terms)}</p>
        </>
      )}
    </section>
  );
}

const Faq = () => {
  const [query, setQuery] = useState("");
  const [faqs, setFaqs] = useState([]);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [activeCategory, setActiveCategory] = useState(null);
  const [activeQuestionId, setActiveQuestionId] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const canEdit = localStorage.getItem("auth") === "true";
  const contentRef = useRef(null);

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

  const isSearching = terms.length > 0;

  const results = useMemo(() => {
    if (!terms.length) return faqs;
    return faqs.filter((faq) => matches(faq, terms));
  }, [faqs, terms]);

  const publicGroups = groupByCategory(faqs.filter((f) => !f.internal));
  const internalGroups = groupByCategory(faqs.filter((f) => f.internal));
  const allTabs = [...publicGroups, ...internalGroups];

  // Land on the first category once the data arrives, and fall back to it
  // if the active one disappears (e.g. its last question got deleted).
  useEffect(() => {
    if (allTabs.length === 0) return;
    if (!allTabs.some(([name]) => name === activeCategory)) {
      setActiveCategory(allTabs[0][0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faqs]);

  const selectTab = (name) => {
    setQuery("");
    setActiveCategory(name);
    setActiveQuestionId(null);
  };

  // Jumps to a specific question within the current (short) tab's content —
  // since it's scoped to one category, the scroll distance stays small.
  const selectQuestion = (id) => {
    setActiveQuestionId(id);
    const node = contentRef.current?.querySelector(`[data-faq-id="${id}"]`);
    node?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // While searching, show every matching question across all categories at
  // once (the result set is already short). Otherwise, show only the
  // single active category — that's the "tab page" — so scrolling always
  // stays short and local instead of a very long, slow single document.
  const searchGroups = groupByCategory(results);
  const activeGroup = allTabs.find(([name]) => name === activeCategory);
  const visibleEntries = isSearching
    ? results
    : (activeGroup?.[1] ?? []);

  const handleAdded = (row) => setFaqs((prev) => [...prev, row]);
  const handleUpdated = (row) =>
    setFaqs((prev) => prev.map((f) => (f.id === row.id ? row : f)));
  const handleDeleted = (id) => {
    setActiveQuestionId((prev) => (prev === id ? null : prev));
    setFaqs((prev) => prev.filter((f) => f.id !== id));
  };

  return (
    <div className="faq-page">
      <div className="faq-topbar">
        <div className="faq-search">
          <Search size={16} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a question, e.g. shipping, returns, MOQ"
          />
          {query && (
            <button
              type="button"
              className="faq-search-clear"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {faqs.some((f) => !f.internal) && (
          <button
            type="button"
            className="faq-btn"
            onClick={() => downloadFaqsPdf(faqs)}
          >
            <Download size={14} />
            Download all FAQs
          </button>
        )}

        {canEdit && (
          <button
            type="button"
            className="faq-btn faq-btn-primary"
            onClick={() => setShowAddForm((v) => !v)}
          >
            <Plus size={14} />
            Add a question
          </button>
        )}
      </div>

      {canEdit && (
        <AddFaqForm
          open={showAddForm}
          onClose={() => setShowAddForm(false)}
          categories={categoryNames}
          onAdded={handleAdded}
        />
      )}

      {status === "loading" && <p className="faq-empty">Loading FAQs...</p>}

      {status === "error" && (
        <div className="faq-empty">
          <p style={{ fontWeight: 600 }}>Couldn't load the FAQs</p>
          <p>Please refresh the page, or try again shortly.</p>
        </div>
      )}

      {status === "ready" && faqs.length === 0 && (
        <div className="faq-empty">
          <p style={{ fontWeight: 600 }}>No questions yet</p>
        </div>
      )}

      {status === "ready" && faqs.length > 0 && (
        <div className="faq-layout">
          <nav className="faq-sidebar">
            {allTabs.map(([name, items]) => (
              <CategoryTab
                key={name}
                name={name}
                items={items}
                internal={items[0]?.internal}
                active={!isSearching && name === activeCategory}
                onSelectCategory={() => selectTab(name)}
                activeQuestionId={activeQuestionId}
                onSelectQuestion={selectQuestion}
              />
            ))}
          </nav>

          <main className="faq-content" ref={contentRef}>
            <div className="faq-content-header">
              <p>
                {isSearching
                  ? `${results.length} result${results.length === 1 ? "" : "s"} for "${query}"`
                  : (activeCategory ?? "")}
              </p>
            </div>

            {visibleEntries.length === 0 ? (
              <div className="faq-empty">
                <p style={{ fontWeight: 600 }}>
                  {isSearching
                    ? "No matching questions"
                    : "No questions in this category"}
                </p>
                {isSearching && <p>Try a different search term.</p>}
              </div>
            ) : isSearching ? (
              searchGroups.map(([, items]) =>
                items.map((faq) => (
                  <QaEntry
                    key={faq.id}
                    faq={faq}
                    terms={terms}
                    canEdit={canEdit}
                    onUpdated={handleUpdated}
                    onDeleted={handleDeleted}
                  />
                )),
              )
            ) : (
              visibleEntries.map((faq) => (
                <QaEntry
                  key={faq.id}
                  faq={faq}
                  terms={terms}
                  canEdit={canEdit}
                  isActive={faq.id === activeQuestionId}
                  onUpdated={handleUpdated}
                  onDeleted={handleDeleted}
                />
              ))
            )}
          </main>
        </div>
      )}
    </div>
  );
};

export default Faq;
