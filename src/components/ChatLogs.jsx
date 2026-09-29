import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  LogOut,
  MessageSquare,
  Pencil,
  RefreshCw,
  Search,
  Send,
  Trash2,
  UserRound,
  Bot,
  X,
} from "lucide-react";
import { toast } from "react-toastify";
import { callFunction } from "../lib/askFaq";
import ChatResults from "./ChatResults";
import LeadCard from "./LeadCard";
import { pageLabel, pageUrl } from "../lib/storePages";
import "./Chats.css";

// Session token from the chat-admin function. sessionStorage, not
// localStorage: closing the browser logs you out of chat history.
const TOKEN_KEY = "chatsToken";

// How often an open, taken-over chat re-fetches its transcript.
const TRANSCRIPT_REFRESH_MS = 5000;

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
  c.label ||
  c.visitorName ||
  c.company ||
  (c.visitorNumber ? `Visitor ${c.visitorNumber}` : "Anonymous visitor");

// Visitor numbers restart every day (chat-admin's dailyNumbers), so an
// unnamed chat's title comes with its day.
const isNumberTitle = (c) =>
  !c.label && !c.visitorName && !c.company && !!c.visitorNumber;
const formatDay = (day) =>
  day
    ? new Date(`${day}T12:00:00`).toLocaleDateString([], {
        day: "numeric",
        month: "short",
      })
    : "";

// Short, stable tag for grouping anonymous visitors by eye.
const visitorTag = (id) => `#${id.slice(0, 6)}`;

// The date filter's choices; the list (and message search) only covers
// conversations active in that window.
const RANGES = [
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom dates" },
];
const DAY_MS = 24 * 60 * 60 * 1000;

// { since, until } for the chat-admin function. Custom dates are whole
// days in the viewer's time zone, "to" included.
const rangeBounds = (range, from, to) => {
  const preset = RANGES.find((r) => r.id === range);
  if (preset?.days) {
    return { since: new Date(Date.now() - preset.days * DAY_MS).toISOString() };
  }
  if (range !== "custom") return {};
  const bounds = {};
  if (from) bounds.since = new Date(`${from}T00:00:00`).toISOString();
  if (to) {
    bounds.until = new Date(
      new Date(`${to}T00:00:00`).getTime() + DAY_MS,
    ).toISOString();
  }
  return bounds;
};

const EMPTY_HITS = new Map();

const ChatLogs = () => {
  const [token, setToken] = useState(readToken);
  const [conversations, setConversations] = useState([]);
  const [loadingList, setLoadingList] = useState(() => !!readToken());
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [search, setSearch] = useState("");
  // Conversations whose messages match the search (from the server), each
  // with the matching line (conversation id -> text), and which search
  // they're for.
  const [messageSearch, setMessageSearch] = useState({
    query: "",
    hits: new Map(),
  });
  const [visitorFilter, setVisitorFilter] = useState(null);
  // Date filter: one of RANGES' ids; "custom" uses the two dates.
  const [range, setRange] = useState("7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [editingLabel, setEditingLabel] = useState(null);
  const [reply, setReply] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  // The open chat's transcript scrolls inside its own box: kept at the
  // newest message.
  const transcriptRef = useRef(null);
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);
  // "conversations" or "stats" (the Results panel).
  const [tab, setTab] = useState("conversations");
  // Bumped by Refresh so the stats reload too.
  const [statsRefresh, setStatsRefresh] = useState(0);

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
    const data = await api({
      action: "list",
      ...rangeBounds(range, customFrom, customTo),
    });
    setLoadingList(false);
    if (data) setConversations(data.conversations);
  }, [api, range, customFrom, customTo]);

  // Loads the list after login / page open, and again whenever the date
  // range changes. loadingList is already true then (see its initial
  // state, the login handler and changeRange).
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    callFunction("chat-admin", {
      action: "list",
      token,
      ...rangeBounds(range, customFrom, customTo),
    }).then((res) => {
      if (cancelled) return;
      setLoadingList(false);
      const data = handleResponse(res);
      if (data) setConversations(data.conversations);
    });
    return () => {
      cancelled = true;
    };
  }, [token, handleResponse, range, customFrom, customTo]);

  const changeRange = (patch) => {
    setLoadingList(true);
    if ("range" in patch) setRange(patch.range);
    if ("from" in patch) setCustomFrom(patch.from);
    if ("to" in patch) setCustomTo(patch.to);
  };

  const setTakeoverFlag = (id, takeover) =>
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, takeover } : c)),
    );

  const open = async (id) => {
    setSelectedId(id);
    setMessages([]);
    setEditingLabel(null);
    setReply("");
    setLoadingMessages(true);
    const data = await api({ action: "messages", conversationId: id });
    setLoadingMessages(false);
    if (data) {
      setMessages(data.messages);
      setTakeoverFlag(id, data.takeover);
    }
  };

  const toggleTakeover = async () => {
    const on = !conversations.find((c) => c.id === selectedId)?.takeover;
    const data = await api({
      action: "takeover",
      conversationId: selectedId,
      on,
    });
    if (!data) return;
    setTakeoverFlag(selectedId, data.takeover);
    toast.success(
      on
        ? "You've taken over. The AI won't reply until you hand back."
        : "Handed back to the AI.",
    );
  };

  const sendReply = async (e) => {
    e.preventDefault();
    const text = reply.trim();
    if (!text || sendingReply) return;
    setSendingReply(true);
    const data = await api({
      action: "reply",
      conversationId: selectedId,
      text,
    });
    setSendingReply(false);
    if (!data) return;
    setReply("");
    setMessages((prev) => [...prev, data.message]);
  };

  // While the team is handling the open chat, keep the transcript fresh so
  // new customer messages show up without clicking Refresh.
  const selectedTakeover = conversations.find(
    (c) => c.id === selectedId,
  )?.takeover;
  useEffect(() => {
    if (!selectedId || !selectedTakeover) return;
    const timer = setInterval(async () => {
      const res = await callFunction("chat-admin", {
        action: "messages",
        conversationId: selectedId,
        token,
      });
      const data = handleResponse(res);
      if (!data) return;
      setMessages(data.messages);
      setTakeoverFlag(selectedId, data.takeover);
    }, TRANSCRIPT_REFRESH_MS);
    return () => clearInterval(timer);
  }, [selectedId, selectedTakeover, token, handleResponse]);

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

  const deleteConversation = async () => {
    const convo = conversations.find((c) => c.id === selectedId);
    if (
      !convo ||
      !window.confirm(
        `Delete this chat with ${titleOf(convo)}?\n\nAll ${convo.messageCount} messages and their saved details (name, phone) will be permanently removed.`,
      )
    ) {
      return;
    }
    const data = await api({ action: "delete", conversationId: convo.id });
    if (!data) return;
    setConversations((prev) => prev.filter((c) => c.id !== convo.id));
    setSelectedId(null);
    setMessages([]);
    toast.success("Chat deleted");
  };

  const visitorCounts = useMemo(() => {
    const counts = new Map();
    for (const c of conversations) {
      counts.set(c.visitorId, (counts.get(c.visitorId) ?? 0) + 1);
    }
    return counts;
  }, [conversations]);

  // Searching message text happens on the server (the list only has each
  // chat's latest question), a moment after typing stops.
  const searchQuery = search.trim();
  const searchesMessages = searchQuery.length >= 2;
  // A search result belongs to this text and date range.
  const searchKey = [searchQuery, range, customFrom, customTo].join("|");
  useEffect(() => {
    if (!token || !searchesMessages) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const res = await callFunction("chat-admin", {
        action: "search",
        query: searchQuery,
        token,
        ...rangeBounds(range, customFrom, customTo),
      });
      if (cancelled) return;
      const data = handleResponse(res);
      setMessageSearch({
        query: searchKey,
        hits: new Map(
          (data?.matches ?? []).map((m) => [m.conversationId, m.text]),
        ),
      });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    searchQuery,
    searchesMessages,
    searchKey,
    range,
    customFrom,
    customTo,
    token,
    handleResponse,
  ]);
  // Only results for what's in the box now (not a previous search).
  const messageHits =
    searchesMessages && messageSearch.query === searchKey
      ? messageSearch.hits
      : EMPTY_HITS;
  const searchingMessages =
    searchesMessages && messageSearch.query !== searchKey;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // "98765 43210", "+91-9876543210" and "9876543210" all find the same
    // number.
    const digits = q.replace(/\D/g, "");
    const phoneQuery = digits.length >= 4 && /^[\d\s()+-]+$/.test(q);
    return conversations.filter(
      (c) =>
        (!visitorFilter || c.visitorId === visitorFilter) &&
        (!q ||
          messageHits.has(c.id) ||
          (phoneQuery &&
            (c.visitorPhone ?? "").replace(/\D/g, "").includes(digits)) ||
          [
            c.label,
            c.visitorName,
            c.company,
            c.visitorPhone,
            c.preview,
            c.visitorNumber && `visitor ${c.visitorNumber}`,
            c.firstPage && pageLabel(c.firstPage),
          ]
            .filter(Boolean)
            .some((s) => s.toLowerCase().includes(q))),
    );
  }, [conversations, search, visitorFilter, messageHits]);

  const selected = conversations.find((c) => c.id === selectedId);

  // The Results strip's range. Fixed per choice (not re-computed every
  // render, which would move "last 7 days" along and reload it).
  const bounds = useMemo(
    () => rangeBounds(range, customFrom, customTo),
    [range, customFrom, customTo],
  );

  // An order's chat may be older than the range shown: widen it first.
  const openFromResults = (id) => {
    if (!conversations.some((c) => c.id === id)) changeRange({ range: "all" });
    setTab("conversations");
    open(id);
  };

  const refresh = () => {
    loadList();
    setStatsRefresh((n) => n + 1);
  };

  // The date filter, shared by both tabs (same range in each).
  const dateFilter = (
    <>
      <div className="chats-range">
        <CalendarDays size={14} />
        <select
          value={range}
          onChange={(e) => changeRange({ range: e.target.value })}
          aria-label="Show chats from"
        >
          {RANGES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      {range === "custom" && (
        <div className="chats-range-custom">
          <label>
            From
            <input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => changeRange({ from: e.target.value })}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => changeRange({ to: e.target.value })}
            />
          </label>
        </div>
      )}
    </>
  );

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
            onClick={refresh}
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

      <div className="chats-tabs" role="tablist">
        {[
          ["conversations", "Conversations"],
          ["stats", "Stats"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`chats-tab${tab === id ? " chats-tab-active" : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "stats" ? (
        <div className="chats-stats">
          <div className="chats-stats-filter">{dateFilter}</div>
          <ChatResults
            token={token}
            bounds={bounds}
            refreshKey={statsRefresh}
            handleResponse={handleResponse}
            onOpenChat={openFromResults}
          />
        </div>
      ) : (
      <div className={`chats-layout${selected ? " chats-has-selection" : ""}`}>
        <aside className="chats-list">
          <div className="chats-search">
            <Search size={15} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search names, numbers or any message"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")} aria-label="Clear search">
                <X size={14} />
              </button>
            )}
          </div>

          {dateFilter}

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
              : `${filtered.length} conversation${filtered.length === 1 ? "" : "s"}${
                  searchingMessages ? " · searching messages…" : ""
                }`}
          </div>

          {/* Only this part scrolls; search and dates stay put. */}
          <div className="chats-items">
            {!loadingList && conversations.length === 0 && (
              <p className="chats-empty">
                {range === "all"
                  ? "No chats yet. They'll appear here as people use Ask AI."
                  : "No chats in this period. Try a longer range, or All time."}
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
                  <span className="chats-item-title">
                    <span className="chats-item-name">
                      {titleOf(c)}
                      {/* Visitor numbers restart daily: which day's. */}
                      {isNumberTitle(c) && (
                        <small className="chats-item-day">
                          {formatDay(c.visitorDay)}
                        </small>
                      )}
                    </span>
                    {c.takeover && <span className="chats-team-badge">Team</span>}
                  </span>
                  <span className="chats-item-date">{formatDate(c.lastMessageAt)}</span>
                </div>
                {(c.company && titleOf(c) !== c.company) || c.visitorPhone ? (
                  <div className="chats-item-company">
                    {[titleOf(c) !== c.company && c.company, c.visitorPhone]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                ) : null}
                {/* While searching, the line that matched (if it's in a
                    message) instead of the latest question. */}
                {messageHits.has(c.id) ? (
                  <div className="chats-item-preview chats-item-match">
                    {messageHits.get(c.id)}
                  </div>
                ) : (
                  <div className="chats-item-preview">{c.preview}</div>
                )}
                <div className="chats-item-meta">
                  <MessageSquare size={11} />
                  {c.messageCount}
                  <span>·</span>
                  {visitorTag(c.visitorId)}
                  {visitorCounts.get(c.visitorId) > 1 &&
                    ` (${visitorCounts.get(c.visitorId)} chats)`}
                  {c.firstPage && (
                    <>
                      <span>·</span>
                      <span className="chats-item-page">{pageLabel(c.firstPage)}</span>
                    </>
                  )}
                </div>
              </button>
            ))}
          </div>
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
                    {selected.visitorPhone && (
                      <span>
                        Phone:{" "}
                        <a
                          className="chats-link-btn"
                          href={`https://wa.me/${selected.visitorPhone.replace(/\D/g, "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open in WhatsApp"
                        >
                          {selected.visitorPhone}
                        </a>
                      </span>
                    )}
                    <span>
                      Started {formatDate(selected.startedAt)}
                      {selected.firstPage && (
                        <>
                          {" on "}
                          <a
                            className="chats-link-btn"
                            href={pageUrl(selected.firstPage)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {pageLabel(selected.firstPage)}
                          </a>
                        </>
                      )}
                    </span>
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
                <button
                  type="button"
                  className={`chats-btn${selected.takeover ? "" : " chats-btn-primary"}`}
                  onClick={toggleTakeover}
                  title={
                    selected.takeover
                      ? "Let the AI answer this chat again"
                      : "Stop the AI and reply yourself (for up to 24 hours)"
                  }
                >
                  {selected.takeover ? <Bot size={14} /> : <UserRound size={14} />}
                  {selected.takeover ? "Hand back to AI" : "Take over"}
                </button>
                <button
                  type="button"
                  className="chats-icon-btn chats-delete"
                  onClick={deleteConversation}
                  aria-label="Delete chat"
                  title="Delete chat"
                >
                  <Trash2 size={15} />
                </button>
              </div>

              <LeadCard
                key={selected.id}
                conversation={selected}
                api={api}
                onUpdated={(patch) =>
                  setConversations((prev) =>
                    prev.map((c) => (c.id === selected.id ? { ...c, ...patch } : c)),
                  )
                }
              />

              <div className="chats-transcript" ref={transcriptRef}>
                {loadingMessages && <p className="chats-empty">Loading...</p>}
                {messages.map((m, i) => m.sender === "system" ? (
                  <div key={m.id} className="chats-system-note">
                    {m.answer} · {formatDate(m.created_at)}
                  </div>
                ) : (
                  <div key={m.id} className="chats-turn">
                    {/* Which page they were on, whenever it changes. */}
                    {m.page &&
                      m.page !== messages.slice(0, i).findLast((x) => x.page)?.page && (
                        <div className="chats-page-note">
                          on{" "}
                          <a href={pageUrl(m.page)} target="_blank" rel="noopener noreferrer">
                            {pageLabel(m.page)}
                          </a>
                        </div>
                      )}
                    {m.question && (
                      <div className="chats-bubble chats-bubble-user">
                        {m.question}
                        <span className="chats-time">{formatDate(m.created_at)}</span>
                      </div>
                    )}
                    {m.sender === "agent" && (
                      <div className="chats-bubble chats-bubble-team">
                        <span className="chats-bubble-label">Ware team</span>
                        {m.answer}
                        <span className="chats-time">{formatDate(m.created_at)}</span>
                      </div>
                    )}
                    {m.answer && m.sender !== "agent" && (
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
                    )}
                  </div>
                ))}
              </div>

              {selected.takeover && (
                <form className="chats-reply" onSubmit={sendReply}>
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendReply(e);
                      }
                    }}
                    placeholder="Reply as the Ware team… (Enter to send, Shift+Enter for a new line)"
                    rows={2}
                    maxLength={2000}
                  />
                  <button
                    type="submit"
                    className="chats-btn chats-btn-primary"
                    disabled={!reply.trim() || sendingReply}
                  >
                    <Send size={14} />
                    Send
                  </button>
                </form>
              )}
            </>
          )}
        </section>
      </div>
      )}
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
