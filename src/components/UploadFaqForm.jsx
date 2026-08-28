import { useState } from "react";
import { toast } from "react-toastify";
import { Upload, X, FileText } from "lucide-react";
import mammoth from "mammoth";
import { supabase } from "./supabase";
import { extractFaqsFromParagraphs, INTERNAL_CATEGORY_PATTERN } from "../lib/parseFaqs";

function filenameToCategory(name) {
  return name.replace(/\.docx$/i, "").replace(/[_-]+/g, " ").trim();
}

const UploadFaqForm = ({ open, onClose, onAdded }) => {
  const [fileName, setFileName] = useState("");
  const [fallbackCategory, setFallbackCategory] = useState("");
  const [forceInternal, setForceInternal] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState(null); // array of { question, answer, category, internal, include }
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setFileName("");
    setFallbackCategory("");
    setForceInternal(false);
    setPreview(null);
  };

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const category = filenameToCategory(file.name);
    setFallbackCategory(category);
    setPreview(null);
    setParsing(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const { value } = await mammoth.extractRawText({ arrayBuffer });
      const paragraphs = value
        .split(/\r?\n/)
        .map((p) => p.trim())
        .filter(Boolean);

      const faqs = extractFaqsFromParagraphs(paragraphs, category, file.name);
      setPreview(
        faqs.map((f) => ({
          ...f,
          internal: INTERNAL_CATEGORY_PATTERN.test(f.category),
          include: true,
        })),
      );
    } catch (err) {
      console.error(err);
      toast.error("Couldn't read that file. Make sure it's a .docx document.");
    } finally {
      setParsing(false);
    }
  };

  const toggleItem = (i) => {
    setPreview((prev) =>
      prev.map((item, idx) => (idx === i ? { ...item, include: !item.include } : item)),
    );
  };

  const toggleAll = (include) => {
    setPreview((prev) => prev.map((item) => ({ ...item, include })));
  };

  const handleConfirm = async () => {
    const selected = preview.filter((item) => item.include);
    if (!selected.length) return;

    setSaving(true);
    const rows = selected.map((item) => ({
      question: item.question,
      answer: item.answer,
      category: item.category,
      internal: forceInternal || item.internal,
      doc_key: `upload:${fileName}::${item.question.trim().toLowerCase()}`,
    }));

    const { data, error } = await supabase
      .from("faqs")
      .upsert(rows, { onConflict: "doc_key", ignoreDuplicates: true })
      .select();
    setSaving(false);

    if (error) {
      toast.error("Couldn't save these questions. Check the Supabase setup.");
      console.error(error);
      return;
    }

    const addedCount = data?.length ?? 0;
    if (addedCount < selected.length) {
      toast.success(
        `Added ${addedCount} new question${addedCount === 1 ? "" : "s"} (${selected.length - addedCount} already existed from this file).`,
      );
    } else {
      toast.success(`Added ${addedCount} new question${addedCount === 1 ? "" : "s"}.`);
    }

    onAdded(data ?? []);
    reset();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="faq-add-panel">
      <div className="faq-qa-question">
        <h3>Upload a document</h3>
        <button type="button" onClick={onClose} className="faq-icon-btn" aria-label="Close">
          <X size={15} />
        </button>
      </div>

      {!preview && (
        <div className="faq-edit-form">
          <label>Word document (.docx)</label>
          <label className="faq-upload-drop">
            <FileText size={18} />
            <span>{fileName || "Choose a file..."}</span>
            <input type="file" accept=".docx" onChange={handleFile} hidden />
          </label>
          {parsing && <p style={{ fontSize: 13, color: "var(--faq-text-muted)" }}>Reading document...</p>}
        </div>
      )}

      {preview && (
        <>
          <div className="faq-edit-form">
            <label>Category for questions without their own section</label>
            <input
              type="text"
              value={fallbackCategory}
              onChange={(e) => setFallbackCategory(e.target.value)}
            />
            <label className="faq-checkbox-row" style={{ textTransform: "none", letterSpacing: 0 }}>
              <input
                type="checkbox"
                checked={forceInternal}
                onChange={(e) => setForceInternal(e.target.checked)}
                style={{ width: "auto" }}
              />
              Mark everything from this file as internal / team notes
            </label>
          </div>

          {preview.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--faq-text-muted)" }}>
              Couldn't find any question-and-answer pairs in this file. It works best with a
              numbered list ("1. Question?") or "Q: ... A: ..." pairs.
            </p>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <p style={{ fontSize: 13, color: "var(--faq-text-secondary)", margin: 0 }}>
                  Found {preview.length} question{preview.length === 1 ? "" : "s"}. Uncheck any you
                  don't want to add.
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="faq-btn faq-btn-ghost" onClick={() => toggleAll(true)}>
                    All
                  </button>
                  <button type="button" className="faq-btn faq-btn-ghost" onClick={() => toggleAll(false)}>
                    None
                  </button>
                </div>
              </div>

              <div className="faq-upload-preview">
                {preview.map((item, i) => (
                  <label key={i} className="faq-upload-preview-item">
                    <input
                      type="checkbox"
                      checked={item.include}
                      onChange={() => toggleItem(i)}
                    />
                    <div>
                      <p className="faq-upload-preview-q">{item.question}</p>
                      <p className="faq-upload-preview-a">{item.answer}</p>
                      <p className="faq-upload-preview-cat">{item.category}</p>
                    </div>
                  </label>
                ))}
              </div>
            </>
          )}

          <div className="faq-edit-actions">
            <button type="button" onClick={reset} className="faq-btn faq-btn-ghost">
              Choose a different file
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={saving || !preview.some((i) => i.include)}
              className="faq-btn faq-btn-primary"
            >
              <Upload size={14} />
              {saving ? "Adding..." : `Add ${preview.filter((i) => i.include).length} question${preview.filter((i) => i.include).length === 1 ? "" : "s"}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default UploadFaqForm;
