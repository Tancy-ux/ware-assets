import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Plus, RotateCcw, Send, Trash2 } from "lucide-react";
import { toast } from "react-toastify";

// The Chats page's Bot section (owner login only): the instructions the
// store bot follows on top of its built-in rules. Each add / edit / delete /
// on-off goes live when saved and is kept as a version that can be brought
// back; "Try it" asks the bot with the one being edited, before saving.
// The same rules the "Improve AI" panel edits (the ai_guidelines table).

// An instruction has to say enough to be followed: a few words, not "no".
const MIN_CHARS = 25;
const MIN_WORDS = 5;
const tooShort = (text) => {
  const t = text.trim();
  return t.length < MIN_CHARS || t.split(/\s+/).length < MIN_WORDS;
};
// History shows the latest few; the rest behind "Show all".
const HISTORY_SHOWN = 5;

// What the bot always does (written into ask-faq itself), so nobody has to
// add these as instructions. Keep in step with ask-faq's prompt.
const BUILT_IN = [
  "Only suggests real products from the store, at their real prices.",
  "Never promises stock or delivery dates for orders over 20 pieces: the team confirms those.",
  "Asks for the pincode before giving delivery times or charges.",
  "Ware Atelier pieces: no prices, it offers a call with a designer instead.",
  "Doesn't quote trade prices; resellers are sent to the sales team.",
  "Short, plain replies, using the shopper's name only now and then.",
];

// Starting points for the first instructions: a tap puts one in the box to
// change and save.
const IDEAS = [
  "Only suggest gift wrapping if the customer asks about it.",
  "Mention free shipping on orders of ₹5,000 and above when it helps them decide.",
  "For wedding gifts, suggest pieces that work well as a set for a couple.",
];

// Try it: one tap asks these.
const SAMPLE_QUESTIONS = [
  "Do you ship to Pune?",
  "Gift ideas under ₹2,000",
  "Bulk or corporate gifting",
  "Is it microwave safe?",
];

// "2 days ago", "3 hr ago", "just now".
const ago = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
};

const formatWhen = (iso) =>
  new Date(iso).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

// draft: an instruction to start writing (from "Teach the bot" in Stats),
// cleared with onDraftUsed once it's in the box.
const ChatBot = ({ api, draft, onDraftUsed }) => {
  const [rules, setRules] = useState(null);
  // The instruction being written: { id } for an edit, no id for a new one.
  const [editing, setEditing] = useState(() => (draft ? { text: draft } : null));
  // Used once: coming back to Bot later starts empty.
  useEffect(() => {
    if (draft) onDraftUsed?.();
  }, [draft, onDraftUsed]);
  const [versions, setVersions] = useState(null);
  const [limits, setLimits] = useState({ rules: 60, chars: 400 });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [openVersion, setOpenVersion] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyAll, setHistoryAll] = useState(false);
  const [builtInOpen, setBuiltInOpen] = useState(false);

  // "Try it": a throwaway chat with the draft.
  const [tryTurns, setTryTurns] = useState([]);
  const [tryText, setTryText] = useState("");
  const [trying, setTrying] = useState(false);
  const tryBox = useRef(null);

  const apply = useCallback((res) => {
    setRules(res.rules);
    setVersions(res.versions);
    setLimits(res.limits);
    setError(null);
  }, []);

  const load = useCallback(async () => {
    const res = await api({ action: "bot-get" });
    if (res) apply(res);
    else setError("Couldn't load the bot's instructions.");
  }, [api, apply]);

  useEffect(() => {
    let cancelled = false;
    api({ action: "bot-get" }).then((res) => {
      if (cancelled) return;
      if (res) apply(res);
      else setError("Couldn't load the bot's instructions.");
    });
    return () => {
      cancelled = true;
    };
  }, [api, apply]);

  // Keeps the newest answer in view (inside the box, not the page).
  useEffect(() => {
    const box = tryBox.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [tryTurns, trying]);

  // The list with the open edit applied (for saving it, and for Try it).
  const withEdit = () => {
    if (!editing?.text.trim()) return rules;
    const rule = editing.text.trim();
    return editing.id
      ? rules.map((r) => (r.id === editing.id ? { ...r, rule } : r))
      : [...rules, { rule, enabled: true }];
  };

  // Every change goes live straight away (and into History).
  const saveList = async (list, done) => {
    setSaving(true);
    const res = await api({ action: "bot-save", rules: list });
    setSaving(false);
    if (!res) return false;
    toast.success(`${done} The bot follows this from its next answer.`);
    await load();
    return true;
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    if (tooShort(editing.text)) return;
    if (await saveList(withEdit(), editing.id ? "Instruction updated." : "Instruction added.")) {
      setEditing(null);
    }
  };

  const remove = async (r) => {
    if (!window.confirm(`Delete this instruction?\n\n"${r.rule}"\n\n(You can bring it back from History.)`)) {
      return;
    }
    if (editing?.id === r.id) setEditing(null);
    await saveList(rules.filter((x) => x.id !== r.id), "Instruction deleted.");
  };

  const toggle = (r) =>
    saveList(
      rules.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)),
      r.enabled ? "Instruction switched off." : "Instruction switched on.",
    );

  const restore = async (v) => {
    if (
      !window.confirm(
        `Go back to the version from ${formatWhen(v.at)}? It goes live straight away (you can undo this too).`,
      )
    ) {
      return;
    }
    const res = await api({ action: "bot-restore", id: v.id });
    if (!res) return;
    toast.success("Brought back that version");
    setOpenVersion(null);
    load();
  };

  // From the box, or a sample question's chip.
  const ask = async (e, sample) => {
    e?.preventDefault();
    const question = (sample ?? tryText).trim();
    if (!question || trying) return;
    setTryText("");
    setTryTurns((prev) => [...prev, { question, answer: null }]);
    setTrying(true);
    const res = await api({
      action: "bot-try",
      question,
      history: tryTurns.filter((t) => t.answer),
      rules: withEdit(),
    });
    setTrying(false);
    setTryTurns((prev) =>
      prev.map((t, i) =>
        i === prev.length - 1
          ? res
            ? { question, answer: res.answer, products: res.products }
            : { question, answer: "Couldn't get an answer. Try again.", failed: true }
          : t,
      ),
    );
  };

  const editor = (
      <form className="chats-bot-form" onSubmit={saveEdit}>
        <textarea
          value={editing?.text ?? ""}
          onChange={(e) => setEditing((prev) => ({ ...prev, text: e.target.value }))}
          maxLength={limits.chars}
          rows={3}
          placeholder="e.g. Always mention free shipping on orders above Rs 5,000."
          autoFocus
        />
        <div className="chats-bot-row">
          <small>
            {editing && tooShort(editing.text)
              ? `Write it in full: at least ${MIN_WORDS} words and ${MIN_CHARS} characters`
              : `${editing?.text.length ?? 0}/${limits.chars} · Test it in Try it before saving`}
          </small>
          <button type="button" className="chats-btn" onClick={() => setEditing(null)}>
            Cancel
          </button>
          <button
            type="submit"
            className="chats-btn chats-btn-primary"
            disabled={saving || !editing || tooShort(editing.text)}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
  );

  if (error) return <p className="chats-results-note chats-results-warn">{error}</p>;
  if (!rules) return <p className="chats-results-note">Loading…</p>;

  return (
    <div className="chats-bot">
      <section className="chats-card chats-bot-rules">
        <div className="chats-team-head">
          <div>
            <h3>Instructions</h3>
            <p className="chats-card-sub">
              Tell the bot what to do or say, one point at a time. Changes go
              live when you save.
            </p>
          </div>
        </div>

        {/* What it does anyway, so it needn't be written here. */}
        <div className="chats-bot-builtin">
          <button
            type="button"
            onClick={() => setBuiltInOpen((o) => !o)}
            aria-expanded={builtInOpen}
          >
            {builtInOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Always on
            <small>{BUILT_IN.length} built-in rules you don't need to write</small>
          </button>
          {builtInOpen && (
            <ul>
              {BUILT_IN.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="chats-bot-scroll">

        <ol className="chats-bot-list">
          {rules.map((r, i) => (
            <li key={r.id} className={r.enabled ? "" : "chats-bot-off"}>
              <span className="chats-bot-num">{i + 1}</span>
              {editing?.id === r.id ? (
                editor
              ) : (
                <div className="chats-bot-item">
                  <p>
                    {r.rule}
                    {!r.enabled && <em> (off)</em>}
                  </p>
                  <div className="chats-bot-actions">
                    <label className="chats-bot-switch" title="Switch off to pause it without deleting">
                      <input
                        type="checkbox"
                        checked={r.enabled}
                        disabled={saving}
                        onChange={() => toggle(r)}
                      />
                      {r.enabled ? "On" : "Off"}
                    </label>
                    <button
                      type="button"
                      className="chats-btn"
                      onClick={() => setEditing({ id: r.id, text: r.rule })}
                      disabled={saving}
                    >
                      <Pencil size={13} /> Edit
                    </button>
                    <button
                      type="button"
                      className="chats-btn chats-bot-delete"
                      onClick={() => remove(r)}
                      disabled={saving}
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
          {editing && !editing.id && (
            <li>
              <span className="chats-bot-num">{rules.length + 1}</span>
              {editor}
            </li>
          )}
        </ol>
        {rules.length === 0 && !editing && (
          <div className="chats-bot-ideas">
            <p>No instructions yet. Some ideas to start from (tap one to edit it):</p>
            {IDEAS.map((idea) => (
              <button
                key={idea}
                type="button"
                className="chats-bot-chip"
                onClick={() => setEditing({ text: idea })}
              >
                <Plus size={13} /> {idea}
              </button>
            ))}
          </div>
        )}
        </div>

        {!editing && (
          <div className="chats-bot-foot">
            <button
              type="button"
              className="chats-btn chats-btn-primary"
              onClick={() => setEditing({ text: "" })}
              disabled={rules.length >= limits.rules}
            >
              <Plus size={14} /> Add instruction
            </button>
          </div>
        )}
      </section>

      <section className="chats-card chats-bot-try">
        <div className="chats-team-head">
          <div>
            <h3>Try it</h3>
            <p className="chats-card-sub">
              Test the bot as a shopper would. Includes unsaved changes.
            </p>
          </div>
          {tryTurns.length > 0 && (
            <button type="button" className="chats-btn" onClick={() => setTryTurns([])}>
              Clear
            </button>
          )}
        </div>
        <div className="chats-bot-chat" ref={tryBox}>
          {tryTurns.length === 0 && (
            <div className="chats-bot-samples">
              <p>Try one:</p>
              <div>
                {SAMPLE_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="chats-bot-chip"
                    onClick={() => ask(null, q)}
                    disabled={trying}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {tryTurns.map((t, i) => (
            <div key={i} className="chats-bot-turn">
              <div className="chats-bot-q">{t.question}</div>
              {t.answer ? (
                <div className={`chats-bot-a${t.failed ? " chats-bot-a-failed" : ""}`}>
                  {t.answer}
                  {t.products?.length > 0 && (
                    <small>Shows: {t.products.map((p) => p.title).join(", ")}</small>
                  )}
                </div>
              ) : (
                <div className="chats-bot-a chats-bot-a-wait">Thinking…</div>
              )}
            </div>
          ))}
        </div>
        <form className="chats-bot-ask" onSubmit={ask}>
          <input
            value={tryText}
            onChange={(e) => setTryText(e.target.value)}
            placeholder="Type a question…"
            maxLength={500}
          />
          <button
            type="submit"
            className="chats-btn chats-btn-primary"
            disabled={!tryText.trim() || trying}
            aria-label="Ask"
          >
            <Send size={14} />
          </button>
        </form>
      </section>

      <section className="chats-card chats-bot-history">
        <button
          type="button"
          className="chats-bot-history-toggle"
          onClick={() => setHistoryOpen((o) => !o)}
          aria-expanded={historyOpen}
        >
          {historyOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <h3>History</h3>
          <small>
            {versions?.length > 0
              ? `Last changed ${ago(versions[0].at)}${
                  versions[0].by ? ` by ${versions[0].by}` : ""
                } · ${versions.length} change${versions.length === 1 ? "" : "s"}`
              : "No changes yet"}
          </small>
        </button>
        {!historyOpen ? null : versions === null ? (
          <p className="chats-results-note chats-results-warn">
            Run scripts/supabase-bot-versions.sql in Supabase to keep a history
            you can go back to.
          </p>
        ) : versions.length === 0 ? (
          <p className="chats-results-note">Each change is kept here.</p>
        ) : (
          <>
            <ul className="chats-bot-versions">
            {(historyAll ? versions : versions.slice(0, HISTORY_SHOWN)).map((v, i) => (
              <li key={v.id}>
                <button
                  type="button"
                  className="chats-bot-version"
                  onClick={() => setOpenVersion(openVersion === v.id ? null : v.id)}
                >
                  {openVersion === v.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <strong>{formatWhen(v.at)}</strong>
                  <span>{v.note}</span>
                  <small>
                    {v.by} · {v.rules.length} instruction{v.rules.length === 1 ? "" : "s"}
                  </small>
                  {i === 0 && <span className="chats-tag chats-tag-lead">Current</span>}
                </button>
                {openVersion === v.id && (
                  <div className="chats-bot-version-body">
                    <ol>
                      {v.rules.map((r, j) => (
                        <li key={j} className={r.enabled ? "" : "chats-bot-off"}>
                          {r.rule}
                          {!r.enabled && <em> (off)</em>}
                        </li>
                      ))}
                    </ol>
                    {i > 0 && (
                      <button type="button" className="chats-btn" onClick={() => restore(v)}>
                        <RotateCcw size={13} /> Bring this back
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
            {versions.length > HISTORY_SHOWN && (
              <button
                type="button"
                className="chats-bot-more"
                onClick={() => setHistoryAll((a) => !a)}
              >
                {historyAll ? "Show fewer" : `Show all ${versions.length}`}
              </button>
            )}
          </>
        )}
      </section>
    </div>
  );
};

export default ChatBot;
