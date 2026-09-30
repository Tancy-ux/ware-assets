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

const formatWhen = (iso) =>
  new Date(iso).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

const ChatBot = ({ api }) => {
  const [rules, setRules] = useState(null);
  // The instruction being written: { id } for an edit, no id for a new one.
  const [editing, setEditing] = useState(null);
  const [versions, setVersions] = useState(null);
  const [limits, setLimits] = useState({ rules: 60, chars: 400 });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [openVersion, setOpenVersion] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyAll, setHistoryAll] = useState(false);

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

  const ask = async (e) => {
    e.preventDefault();
    const question = tryText.trim();
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
              What the store bot should do or say, one point each. They sit on
              top of its built-in rules (only real products and prices, no
              promises about stock, the team handles Zoho), which these can't
              switch off. Changes go live when you save. Only your login sees
              this.
            </p>
          </div>
        </div>

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
          <p className="chats-results-note">
            No instructions yet: the bot follows only its built-in rules.
          </p>
        )}

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
              Ask like a shopper would. Uses your instructions, including one
              you're writing and haven't saved yet. Not saved, not in Chats;
              each answer is one AI reply.
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
            <p className="chats-results-note">e.g. "Do you ship to Pune?" or "Gift ideas under 2000"</p>
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
          {versions?.length > 0 && (
            <small>
              {versions.length} change{versions.length === 1 ? "" : "s"} · last{" "}
              {formatWhen(versions[0].at)}
            </small>
          )}
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
