import { useEffect, useState } from "react";
import { WandSparkles, Pencil, Trash2 } from "lucide-react";
import { toast } from "react-toastify";
import { supabase } from "./supabase";
import { callAskFaq } from "../lib/askFaq";

// Matches MAX_RULE_CHARS in the ask-faq function, which trims anything
// longer before it reaches the model.
const MAX_RULE_CHARS = 400;

// The "Improve AI" panel inside the Ask AI drawer: standing instructions
// the team writes for the bot. Rough notes get tidied into clear rules by
// the AI first, shown for review, and only saved when approved. Rules can
// be switched off (instant rollback), edited, or deleted.
const AiGuidelines = () => {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [tidying, setTidying] = useState(false);
  // Review step: the tidied rules, still editable, before anything saves.
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null); // { id, text }

  useEffect(() => {
    supabase
      .from("ai_guidelines")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          console.error(error);
          toast.error("Couldn't load AI guidelines. Check the Supabase setup.");
        }
        setRules(data ?? []);
        setLoading(false);
      });
  }, []);

  const tidy = async () => {
    if (!note.trim()) return;
    setTidying(true);
    const { data, error } = await callAskFaq({ mode: "tidy", note });
    setTidying(false);
    // No rules but a note is a real answer ("this is about one customer"),
    // so only treat it as a failure when both are missing.
    if (error || data?.error || (!data?.rules?.length && !data?.note)) {
      console.error(error ?? data?.error);
      toast.error("Couldn't tidy that up just now. Try again, or save it as typed.");
      return;
    }
    setDraft({ rules: data.rules, note: data.note, original: note.trim() });
  };

  const saveRules = async (texts, original) => {
    const rows = texts
      .map((t) => t.trim())
      .filter(Boolean)
      .map((rule) => ({ rule, original }));
    if (!rows.length) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("ai_guidelines")
      .insert(rows)
      .select();
    setSaving(false);
    if (error) {
      console.error(error);
      toast.error("Couldn't save that. Check the Supabase setup.");
      return;
    }
    setRules((prev) => [...data.reverse(), ...prev]);
    setDraft(null);
    setNote("");
    toast.success(
      rows.length === 1 ? "Guideline saved" : `${rows.length} guidelines saved`,
    );
  };

  const updateRule = async (id, patch) => {
    const { data, error } = await supabase
      .from("ai_guidelines")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error) {
      console.error(error);
      toast.error("Couldn't update that guideline.");
      return false;
    }
    setRules((prev) => prev.map((r) => (r.id === id ? data : r)));
    return true;
  };

  const deleteRule = async (rule) => {
    if (!window.confirm(`Delete this guideline?\n\n"${rule.rule}"`)) return;
    const { error } = await supabase
      .from("ai_guidelines")
      .delete()
      .eq("id", rule.id);
    if (error) {
      console.error(error);
      toast.error("Couldn't delete that guideline.");
      return;
    }
    setRules((prev) => prev.filter((r) => r.id !== rule.id));
  };

  const saveEdit = async () => {
    if (!editing.text.trim()) return;
    if (await updateRule(editing.id, { rule: editing.text.trim() })) {
      setEditing(null);
    }
  };

  return (
    <div className="faq-guidelines">
      <p className="faq-guidelines-intro">
        Tell the AI what to do differently. Rough notes are fine: it'll
        tidy them into clear rules for you to check before anything is
        saved. Prices, stock and product links always come live from the
        store, so there's no need to teach those.
      </p>

      {!draft ? (
        <div className="faq-edit-form">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder={`e.g. "for corporate ppl always mention branding needs 100+ units, and dont push marble stuff unless they ask"`}
          />
          <div className="faq-edit-actions">
            <button
              type="button"
              className="faq-btn faq-btn-ghost"
              disabled={
                !note.trim() || saving || note.trim().length > MAX_RULE_CHARS
              }
              onClick={() => saveRules([note], note.trim())}
              title={
                note.trim().length > MAX_RULE_CHARS
                  ? `Too long to save as one rule (max ${MAX_RULE_CHARS} characters). Tidy it up to split it.`
                  : "Skip tidying and save exactly what you typed"
              }
            >
              Save as typed
            </button>
            <button
              type="button"
              className="faq-btn faq-btn-primary"
              disabled={!note.trim() || tidying}
              onClick={tidy}
            >
              <WandSparkles size={14} />
              {tidying ? "Tidying..." : "Tidy up"}
            </button>
          </div>
        </div>
      ) : (
        <div className="faq-edit-form faq-guidelines-draft">
          {draft.rules.length > 0 && (
            <label>
              {draft.rules.length === 1
                ? "Here's how the AI will read it"
                : `Split into ${draft.rules.length} rules`}
            </label>
          )}
          {draft.note && (
            <div className="faq-guidelines-warning">{draft.note}</div>
          )}
          {draft.rules.map((r, i) => (
            <textarea
              key={i}
              value={r}
              maxLength={MAX_RULE_CHARS}
              rows={3}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  rules: d.rules.map((x, j) => (j === i ? e.target.value : x)),
                }))
              }
            />
          ))}
          <div className="faq-edit-actions">
            <button
              type="button"
              className="faq-btn faq-btn-ghost"
              onClick={() => setDraft(null)}
            >
              Back
            </button>
            <button
              type="button"
              className="faq-btn faq-btn-primary"
              disabled={saving || !draft.rules.some((r) => r.trim())}
              onClick={() => saveRules(draft.rules, draft.original)}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}

      <div className="faq-guidelines-list-head">
        Saved guidelines
        {rules.length > 0 &&
          ` · ${rules.filter((r) => r.enabled).length} of ${rules.length} on`}
      </div>

      {loading && <p className="faq-chat-empty">Loading...</p>}
      {!loading && rules.length === 0 && (
        <p className="faq-chat-empty">None yet.</p>
      )}

      {rules.map((r) =>
        editing?.id === r.id ? (
          <div key={r.id} className="faq-guideline faq-edit-form">
            <textarea
              value={editing.text}
              maxLength={MAX_RULE_CHARS}
              rows={3}
              autoFocus
              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
            />
            <div className="faq-edit-actions">
              <button
                type="button"
                className="faq-btn faq-btn-ghost"
                onClick={() => setEditing(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="faq-btn faq-btn-primary"
                onClick={saveEdit}
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <div
            key={r.id}
            className={`faq-guideline${r.enabled ? "" : " faq-guideline-off"}`}
          >
            <label className="faq-guideline-toggle" title="On / off">
              <input
                type="checkbox"
                checked={r.enabled}
                onChange={(e) => updateRule(r.id, { enabled: e.target.checked })}
              />
              <span />
            </label>
            <div className="faq-guideline-body">
              <div className="faq-guideline-text">{r.rule}</div>
              {r.original && r.original !== r.rule && (
                <details className="faq-guideline-original">
                  <summary>What you typed</summary>
                  {r.original}
                </details>
              )}
            </div>
            <div className="faq-guideline-actions">
              <button
                type="button"
                className="faq-icon-btn"
                aria-label="Edit guideline"
                title="Edit"
                onClick={() => setEditing({ id: r.id, text: r.rule })}
              >
                <Pencil size={13} />
              </button>
              <button
                type="button"
                className="faq-icon-btn faq-danger"
                aria-label="Delete guideline"
                title="Delete"
                onClick={() => deleteRule(r)}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ),
      )}
    </div>
  );
};

export default AiGuidelines;
