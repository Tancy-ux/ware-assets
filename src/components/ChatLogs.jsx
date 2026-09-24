import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  LogOut,
  MessageSquare,
  Pencil,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { toast } from "react-toastify";
import { callFunction } from "../lib/askFaq";
import "./Chats.css";

// Session token from the chat-admin function. sessionStorage, not
// localStorage: closing the browser logs you out of chat history.
const TOKEN_KEY = "chatsToken";

const readToken = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

const formatDate = (iso) =>
  new Date(iso).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

const titleOf = (c) =>
  c.label || c.visitorName || c.company || "Anonymous visitor";

// Short, stable tag for grouping anonymous visitors by eye.
const visitorTag = (id) => `#${id.slice(0, 6)}`;

// Every Ask AI conversation, behind its own login (separate from the
// site's shared login, checked server-side by the chat-admin function).
const ChatLogs = () => {
  const [token, setToken] = useState(readToken);
  const [conversations, setConversations] = useState([]);
  const [loadingList, setLoadingList] = useState(() => !!readToken());
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [search, setSearch] = useState("");
  const [visitorFilter, setVisitorFilter] = useState(null);
  const [editingLabel, setEditingLabel] = useState(null);

  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // Nothing stored to clear.
    }
    setToken(null);
    setConversations([]);
    setSelectedId(null);
    setMessages([]);
  }, []);

  // Returns the data, or null after showing the error (and logging out if
  // the session has expired).
  const handleResponse = useCallback(
    ({ data, error }) => {
      if (!data?.error && !error) return data;
      if (error?.context?.status === 401 || /log in/i.test(data?.error ?? "")) {
        toast.error("Session expired, please log in again.");
        logout();
      } else {
        toast.error(data?.error ?? "Something went wrong.");
        console.error(error ?? data?.error);
      }
      return null;
    },
    [logout],
  );

  const api = useCallback(
    (body) =>
      callFunction("chat-admin", { ...body, token }).then(handleResponse),
    [token, handleResponse],
  );

  const loadList = useCallback(async () => {
    setLoadingList(true);
    const data = await api({ action: "list" });
    setLoadingList(false);
    if (data) setConversations(data.conversations);
  }, [api]);

  // First load after login / page open. loadingList already starts true
  // in those cases (see its initial state and the login handler).
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    callFunction("chat-admin", { action: "list", token }).then((res) => {
      if (cancelled) return;
      setLoadingList(false);
      const data = handleResponse(res);
      if (data) setConversations(data.conversations);
    });
    return () => {
      cancelled = true;
    };
  }, [token, handleResponse]);

  const open = async (id) => {
    setSelectedId(id);
    setMessages([]);
    setEditingLabel(null);
    setLoadingMessages(true);
    const data = await api({ action: "messages", conversationId: id });
    setLoadingMessages(false);
    if (data) setMessages(data.messages);
  };

  const saveLabel = async () => {
    const data = await api({
      action: "label",
      conversationId: selectedId,
      label: editingLabel,
    });
    if (!data) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, label: data.label } : c)),
    );
    setEditingLabel(null);
  };

  const visitorCounts = useMemo(() => {
    const counts = new Map();
    for (const c of conversations) {
      counts.set(c.visitorId, (counts.get(c.visitorId) ?? 0) + 1);
    }
    return counts;
  }, [conversations]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter(
      (c) =>
        (!visitorFilter || c.visitorId === visitorFilter) &&
        (!q ||
          [c.label, c.visitorName, c.company, c.preview]
            .filter(Boolean)
            .some((s) => s.toLowerCase().includes(q))),
    );
  }, [conversations, search, visitorFilter]);

  const selected = conversations.find((c) => c.id === selectedId);

  if (!token) {
    return (
      <ChatsLogin
        onLogin={(t) => {
          setLoadingList(true);
          setToken(t);
        }}
      />
    );
  }

  return (
    <div className="chats-page">
      <div className="chats-header">
        <div>
          <h1>Chats</h1>
          <p>
            Every conversation with Ask AI. Names and companies are picked up
            when people mention them.
          </p>
        </div>
        <div className="chats-header-actions">
          <button
            type="button"
            className="chats-btn"
            onClick={loadList}
            disabled={loadingList}
          >
            <RefreshCw size={14} className={loadingList ? "chats-spin" : ""} />
            Refresh
          </button>
          <button type="button" className="chats-btn" onClick={logout}>
            <LogOut size={14} />
            Log out
          </button>
        </div>
      </div>

      <div className={`chats-layout${selected ? " chats-has-selection" : ""}`}>
        <aside className="chats-list">
          <div className="chats-search">
            <Search size={15} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, company, or first question"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </div>

          {visitorFilter && (
            <div className="chats-filter-chip">
              Visitor {visitorTag(visitorFilter)}
              <button
                type="button"
                onClick={() => setVisitorFilter(null)}
                aria-label="Show all visitors"
              >
                <X size={12} />
              </button>
            </div>
          )}

          <div className="chats-count">
            {loadingList
              ? "Loading..."
              : `${filtered.length} conversation${filtered.length === 1 ? "" : "s"}`}
          </div>

          {!loadingList && conversations.length === 0 && (
            <p className="chats-empty">
              No chats yet. They'll appear here as people use Ask AI.
            </p>
          )}

          {filtered.map((c) => (
            <button
              type="button"
              key={c.id}
              className={`chats-item${c.id === selectedId ? " chats-item-active" : ""}`}
              onClick={() => open(c.id)}
            >
              <div className="chats-item-top">
                <span className="chats-item-title">{titleOf(c)}</span>
                <span className="chats-item-date">{formatDate(c.lastMessageAt)}</span>
              </div>
              {c.company && titleOf(c) !== c.company && (
                <div className="chats-item-company">{c.company}</div>
              )}
              <div className="chats-item-preview">{c.preview}</div>
              <div className="chats-item-meta">
                <MessageSquare size={11} />
                {c.messageCount}
                <span>·</span>
                {visitorTag(c.visitorId)}
                {visitorCounts.get(c.visitorId) > 1 &&
                  ` (${visitorCounts.get(c.visitorId)} chats)`}
              </div>
            </button>
          ))}
        </aside>

        <section className="chats-detail">
          {!selected ? (
            <p className="chats-empty chats-detail-empty">
              Pick a conversation to read it.
            </p>
          ) : (
            <>
              <div className="chats-detail-header">
                <button
                  type="button"
                  className="chats-icon-btn chats-back"
                  onClick={() => setSelectedId(null)}
                  aria-label="Back to list"
                >
                  <ArrowLeft size={16} />
                </button>
                <div className="chats-detail-heading">
                  {editingLabel !== null ? (
                    <form
                      className="chats-label-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        saveLabel();
                      }}
                    >
                      <input
                        value={editingLabel}
                        onChange={(e) => setEditingLabel(e.target.value)}
                        placeholder={selected.visitorName || "Name this chat"}
                        maxLength={100}
                        autoFocus
                      />
                      <button type="submit" className="chats-btn chats-btn-primary">
                        Save
                      </button>
                      <button
                        type="button"
                        className="chats-btn"
                        onClick={() => setEditingLabel(null)}
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <h2>
                      {titleOf(selected)}
                      <button
                        type="button"
                        className="chats-icon-btn"
                        onClick={() => setEditingLabel(selected.label ?? "")}
                        aria-label="Rename chat"
                        title="Rename"
                      >
                        <Pencil size={13} />
                      </button>
                    </h2>
                  )}
                  <div className="chats-detail-meta">
                    {selected.visitorName && <span>Name: {selected.visitorName}</span>}
                    {selected.company && <span>Company: {selected.company}</span>}
                    <span>Started {formatDate(selected.startedAt)}</span>
                    <button
                      type="button"
                      className="chats-link-btn"
                      onClick={() => setVisitorFilter(selected.visitorId)}
                      title="Show every chat from this browser"
                    >
                      Visitor {visitorTag(selected.visitorId)}
                      {visitorCounts.get(selected.visitorId) > 1 &&
                        ` · ${visitorCounts.get(selected.visitorId)} chats`}
                    </button>
                  </div>
                </div>
              </div>

              <div className="chats-transcript">
                {loadingMessages && <p className="chats-empty">Loading...</p>}
                {messages.map((m) => (
                  <div key={m.id} className="chats-turn">
                    <div className="chats-bubble chats-bubble-user">
                      {m.question}
                      <span className="chats-time">{formatDate(m.created_at)}</span>
                    </div>
                    <div className="chats-bubble chats-bubble-ai">
                      {m.answer}
                      {m.products?.length > 0 && (
                        <div className="chats-products">
                          {m.products.map((p) => (
                            <a
                              key={p.url}
                              href={p.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="chats-product"
                            >
                              {p.title}
                              {!p.available && (
                                <span className="chats-product-soldout">Sold out</span>
                              )}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
};

const ChatsLogin = ({ onLogin }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const { data } = await callFunction("chat-admin", {
      action: "login",
      username,
      password,
    });
    setBusy(false);
    if (!data?.token) {
      toast.error(data?.error ?? "Couldn't log in just now.");
      return;
    }
    try {
      sessionStorage.setItem(TOKEN_KEY, data.token);
    } catch {
      // Still logged in for this page view.
    }
    onLogin(data.token);
  };

  return (
    <div className="chats-page">
      <form className="chats-login" onSubmit={submit}>
        <h1>Chat history</h1>
        <p>This has its own login, separate from the site's.</p>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          autoComplete="username"
          required
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          required
        />
        <button type="submit" className="chats-btn chats-btn-primary" disabled={busy}>
          {busy ? "Checking..." : "Log in"}
        </button>
      </form>
    </div>
  );
};

export default ChatLogs;
