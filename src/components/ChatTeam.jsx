import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "react-toastify";

// The Chats page's Team section: who may sign in (with their
// @wareinnovations.com Google account) and what each may do. Checked on the
// server (chat-admin) for every action, so hiding a button here is only
// for tidiness. The owner (the CHATS_OWNER_EMAIL secret) always has
// everything and can't be changed here.

const PERMISSION_LABELS = {
  contacts: "See phone numbers & emails",
  reply: "Take over & reply to chats",
  edit: "Edit contact & lead details, rename chats",
  zoho: "Send leads to Zoho",
  stats: "See Stats (orders, revenue)",
  delete: "Delete chats",
  users: "Manage team logins",
};
const PERMISSION_KEYS = Object.keys(PERMISSION_LABELS);

// Quick starting points; each box can still be changed.
const PRESETS = [
  { label: "Sales", perms: ["contacts", "reply", "edit"] },
  {
    label: "Manager",
    perms: ["contacts", "reply", "edit", "zoho", "stats", "delete"],
  },
  { label: "View only", perms: [] },
];

const permsFrom = (list) =>
  Object.fromEntries(PERMISSION_KEYS.map((k) => [k, list.includes(k)]));

const formatWhen = (iso) =>
  iso
    ? new Date(iso).toLocaleString([], {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Never";

const EMPTY_FORM = {
  id: null,
  name: "",
  email: "",
  permissions: permsFrom(PRESETS[0].perms),
  active: true,
};

const ChatTeam = ({ api, me }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  // The login being added or changed (null: none).
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await api({ action: "users-list" });
    if (res) {
      setData(res);
      setError(null);
    } else {
      setError("Couldn't load the team logins.");
    }
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    api({ action: "users-list" }).then((res) => {
      if (cancelled) return;
      if (res) setData(res);
      else setError("Couldn't load the team logins.");
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const togglePerm = (key) =>
    set({ permissions: { ...form.permissions, [key]: !form.permissions[key] } });

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const res = await api({ action: "user-save", user: form });
    setSaving(false);
    if (!res) return;
    toast.success(form.id ? "Login updated" : "Login added");
    setForm(null);
    load();
  };

  const setActive = async (u, active) => {
    const res = await api({ action: "user-save", user: { ...u, active } });
    if (!res) return;
    toast.success(active ? `${u.name || u.email} can sign in again` : `${u.name || u.email} is turned off`);
    load();
  };

  const remove = async (u) => {
    if (!window.confirm(`Remove ${u.name || u.email} from the team? They won't be able to sign in.`)) {
      return;
    }
    const res = await api({ action: "user-delete", id: u.id });
    if (!res) return;
    toast.success("Login deleted");
    load();
  };

  // Only what the person managing has themselves can be handed out.
  const canGive = (key) => me.owner || me.permissions[key];

  return (
    <div className="chats-team">
      <section className="chats-card">
        <div className="chats-team-head">
          <div>
            <h3>Team</h3>
            <p className="chats-card-sub">
              Add someone's name and @wareinnovations.com email: they sign in
              with that Google account and only see and do what you tick.
              Changes apply straight away, even if they're signed in.
            </p>
          </div>
          {!form && (
            <button
              type="button"
              className="chats-btn chats-btn-primary"
              onClick={() => setForm(EMPTY_FORM)}
            >
              <Plus size={14} /> Add person
            </button>
          )}
        </div>

        {form && (
          <form className="chats-team-form" onSubmit={save}>
            <h4>{form.id ? `Change ${form.name || form.email || "login"}` : "Add a person"}</h4>
            <div className="chats-team-fields">
              <label>
                Name
                <input
                  value={form.name}
                  onChange={(e) => set({ name: e.target.value })}
                  placeholder="Priyal"
                  maxLength={80}
                />
              </label>
              <label>
                Google email
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => set({ email: e.target.value })}
                  placeholder="priyal@wareinnovations.com"
                  pattern="[^@\s]+@wareinnovations\.com"
                  title="Their @wareinnovations.com email"
                  maxLength={120}
                  required
                  autoComplete="off"
                />
              </label>
            </div>

            <div className="chats-team-presets">
              <span>Start from:</span>
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className="chats-view"
                  onClick={() =>
                    set({ permissions: permsFrom(p.perms.filter(canGive)) })
                  }
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="chats-team-perms">
              <span className="chats-team-perm chats-team-perm-fixed">
                <input type="checkbox" checked disabled />
                Read conversations (always)
              </span>
              {PERMISSION_KEYS.map((key) => (
                <label
                  key={key}
                  className={`chats-team-perm${canGive(key) ? "" : " chats-team-perm-fixed"}`}
                  title={canGive(key) ? "" : "You don't have this yourself"}
                >
                  <input
                    type="checkbox"
                    checked={!!form.permissions[key]}
                    disabled={!canGive(key)}
                    onChange={() => togglePerm(key)}
                  />
                  {PERMISSION_LABELS[key]}
                </label>
              ))}
            </div>

            <div className="chats-lead-actions">
              <button type="button" className="chats-btn" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button type="submit" className="chats-btn chats-btn-primary" disabled={saving}>
                {saving ? "Saving…" : form.id ? "Save changes" : "Add person"}
              </button>
            </div>
          </form>
        )}

        {error && <p className="chats-results-note chats-results-warn">{error}</p>}
        {!data && !error && <p className="chats-results-note">Loading…</p>}

        {data && (
          <ul className="chats-team-list">
            <li>
              <div className="chats-team-who">
                <strong>{data.owner.name}</strong>
                <small>{data.owner.emails.join(", ") || "Owner"}</small>
              </div>
              <div className="chats-team-tags">
                <span className="chats-tag chats-tag-lead">Everything</span>
              </div>
              <div className="chats-team-meta">Owner · set in Supabase secrets</div>
              <div />
            </li>
            {data.users.map((u) => (
              <li key={u.id} className={u.active ? "" : "chats-team-off"}>
                <div className="chats-team-who">
                  <strong>{u.name || u.email}</strong>
                  <small>{u.email || "No email yet: edit to add one"}</small>
                </div>
                <div className="chats-team-tags">
                  {!u.active && <span className="chats-tag chats-tag-alert">Turned off</span>}
                  {PERMISSION_KEYS.filter((k) => u.permissions[k]).map((k) => (
                    <span key={k} className="chats-tag">
                      {PERMISSION_LABELS[k]}
                    </span>
                  ))}
                  {!PERMISSION_KEYS.some((k) => u.permissions[k]) && (
                    <span className="chats-tag">Read only</span>
                  )}
                </div>
                <div className="chats-team-meta">Last login: {formatWhen(u.lastLoginAt)}</div>
                <div className="chats-team-actions">
                  <button
                    type="button"
                    className="chats-btn"
                    onClick={() => setForm({ ...u })}
                  >
                    <Pencil size={13} /> Edit
                  </button>
                  {u.id !== me.id && (
                    <>
                      <button
                        type="button"
                        className="chats-btn"
                        onClick={() => setActive(u, !u.active)}
                      >
                        {u.active ? "Turn off" : "Turn on"}
                      </button>
                      <button
                        type="button"
                        className="chats-icon-btn chats-delete"
                        onClick={() => remove(u)}
                        aria-label={`Remove ${u.name || u.email}`}
                        title="Remove from team"
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
            {data.users.length === 0 && (
              <li className="chats-team-empty">
                Nobody else yet. Add each person who needs the
                Chats page.
              </li>
            )}
          </ul>
        )}
      </section>
    </div>
  );
};

export default ChatTeam;
