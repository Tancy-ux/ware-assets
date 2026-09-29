import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BellRing,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  MessagesSquare,
  UserPlus,
  ExternalLink,
  LogOut,
  MoreHorizontal,
  PanelRight,
  Pencil,
  RefreshCw,
  Search,
  Send,
  Trash2,
  UserRound,
  Users,
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
// How often the list checks for new chats and messages ("Live").
const LIST_REFRESH_MS = 30000;
// "Products seen" takes this many from each reply's cards.
const SEEN_PER_REPLY = 2;

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
const formatTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const dayKey = (iso) => new Date(iso).toDateString();
const isToday = (iso) => dayKey(iso) === new Date().toDateString();
// The list: "2:26 PM" today, "28 Sep" before.
const listTime = (iso) =>
  isToday(iso)
    ? formatTime(iso)
    : new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });

// "5 min ago" for the side panel.
const timeAgo = (iso) => {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return formatDate(iso);
};

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

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

// "Flora table mat" for /products/flora-table-mat (no "Product ·").
const shortPage = (path) => {
  const label = pageLabel(path).replace(/^[\w ]+ · /, "");
  return label.charAt(0).toUpperCase() + label.slice(1);
};

// Each chat's coloured circle: its initials (or visitor number), in one
// of these muted colours, picked from the browser's id so a visitor keeps
// theirs.
const AVATAR_COLOURS = [
  "#c0613e", // terracotta
  "#b8862b", // ochre
  "#3f7f86", // teal
  "#5a6fa8", // slate blue
  "#8a5a8f", // plum
  "#5f8a55", // sage
  "#b0566f", // rose
  "#7a6a58", // clay
];
const avatarColour = (id) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length];
};
const initialsOf = (c) => {
  if (isNumberTitle(c)) return String(c.visitorNumber);
  const words = titleOf(c).replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "")).toUpperCase();
};
const Avatar = ({ c, dot }) => (
  <span className="chats-avatar" style={{ "--avatar": avatarColour(c.visitorId) }}>
    {initialsOf(c)}
    {dot && <span className="chats-avatar-dot" aria-label="Needs reply" />}
  </span>
);

// Short, stable tag for grouping anonymous visitors by eye.
const visitorTag = (id) => `#${id.slice(0, 6)}`;

// A lead: someone who left a way to reach them (or is in Zoho already).
const hasContact = (c) => !!(c.visitorPhone || c.visitorEmail);
const isLead = (c) => hasContact(c) || !!c.zohoLeadId;

// Hot / warm / cold: the AI's read of the chat (ask-faq's "interest"),
// nudged up once they've left their details.
const WARMTH = {
  cold: { label: "Cold", width: "22%" },
  warm: { label: "Warm", width: "58%" },
  hot: { label: "Hot", width: "100%" },
};
const warmthOf = (c) => {
  const base = c.interest ?? "cold";
  if (!isLead(c)) return base;
  return base === "cold" ? "warm" : "hot";
};

// Shopify's image CDN resizes on request: small tiles, small files.
const thumb = (url) =>
  url && /cdn\.shopify\.com|\/cdn\/shop\//.test(url)
    ? `${url}${url.includes("?") ? "&" : "?"}width=240`
    : url;

// The list's quick filters.
const VIEWS = [
  { id: "needs", label: "Needs reply", test: (c) => c.needsReply },
  { id: "leads", label: "Leads", test: isLead },
  { id: "takeover", label: "Taken over", test: (c) => c.takeover },
  { id: "zoho", label: "In Zoho", test: (c) => !!c.zohoLeadId },
  { id: "all", label: "All", test: () => true },
];

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
  // One of VIEWS' ids.
  const [view, setView] = useState("all");
  // Date filter: one of RANGES' ids; "custom" uses the two dates.
  const [range, setRange] = useState("7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [editingLabel, setEditingLabel] = useState(null);
  const [reply, setReply] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  // The open chat's "..." menu, its Zoho lead form, and (on narrower
  // screens) the side panel.
  const [menuOpen, setMenuOpen] = useState(false);
  const [leadOpen, setLeadOpen] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
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

  // "Live": quietly re-checks the list while the page is in view. Errors
  // are left for the next manual Refresh to show.
  useEffect(() => {
    if (!token) return;
    const timer = setInterval(async () => {
      if (document.hidden) return;
      const { data } = await callFunction("chat-admin", {
        action: "list",
        token,
        ...rangeBounds(range, customFrom, customTo),
      });
      if (data?.conversations) setConversations(data.conversations);
    }, LIST_REFRESH_MS);
    return () => clearInterval(timer);
  }, [token, range, customFrom, customTo]);

  const changeRange = (patch) => {
    setLoadingList(true);
    if ("range" in patch) setRange(patch.range);
    if ("from" in patch) setCustomFrom(patch.from);
    if ("to" in patch) setCustomTo(patch.to);
  };

  const patchConversation = (id, patch) =>
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );

  // The open chat's latest message time, as of its transcript: when the
  // list shows a newer one, the transcript reloads.
  const loadedAt = useRef(null);

  const open = async (id) => {
    setSelectedId(id);
    setMessages([]);
    setEditingLabel(null);
    setReply("");
    setMenuOpen(false);
    setLeadOpen(true);
    setLoadingMessages(true);
    loadedAt.current = conversations.find((c) => c.id === id)?.lastMessageAt;
    const data = await api({ action: "messages", conversationId: id });
    setLoadingMessages(false);
    if (data) {
      setMessages(data.messages);
      patchConversation(id, { takeover: data.takeover });
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
    patchConversation(selectedId, {
      takeover: data.takeover,
      ...(data.takeover ? {} : { needsReply: false }),
    });
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
    patchConversation(selectedId, { needsReply: false });
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
      patchConversation(selectedId, { takeover: data.takeover });
    }, TRANSCRIPT_REFRESH_MS);
    return () => clearInterval(timer);
  }, [selectedId, selectedTakeover, token, handleResponse]);

  // An AI-handled chat that's open: reload it when the live list shows a
  // new message in it.
  const selectedLastAt = conversations.find(
    (c) => c.id === selectedId,
  )?.lastMessageAt;
  useEffect(() => {
    if (!selectedId || !selectedLastAt || selectedTakeover) return;
    if (!loadedAt.current || selectedLastAt === loadedAt.current) return;
    loadedAt.current = selectedLastAt;
    callFunction("chat-admin", {
      action: "messages",
      conversationId: selectedId,
      token,
    }).then(({ data }) => {
      if (data?.messages) setMessages(data.messages);
    });
  }, [selectedId, selectedLastAt, selectedTakeover, token]);

  // Closes the "..." menu on any click outside it.
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => {
      if (!e.target.closest?.(".chats-menu")) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  const saveLabel = async () => {
    const data = await api({
      action: "label",
      conversationId: selectedId,
      label: editingLabel,
    });
    if (!data) return;
    patchConversation(selectedId, { label: data.label });
    setEditingLabel(null);
  };

  const deleteConversation = async () => {
    setMenuOpen(false);
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

  // How many chats each quick filter has, and the summary cards' numbers.
  const counts = useMemo(() => {
    const byView = Object.fromEntries(
      VIEWS.map((v) => [v.id, conversations.filter(v.test).length]),
    );
    const newLeadsToday = conversations.filter(
      (c) => isLead(c) && isToday(c.startedAt),
    ).length;
    return { ...byView, newLeadsToday };
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
    const inView = VIEWS.find((v) => v.id === view)?.test ?? (() => true);
    // "98765 43210", "+91-9876543210" and "9876543210" all find the same
    // number.
    const digits = q.replace(/\D/g, "");
    const phoneQuery = digits.length >= 4 && /^[\d\s()+-]+$/.test(q);
    return conversations.filter(
      (c) =>
        inView(c) &&
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
            c.visitorEmail,
            c.preview,
            c.topic,
            c.visitorNumber && `visitor ${c.visitorNumber}`,
            c.firstPage && pageLabel(c.firstPage),
            c.zohoLeadId && "in zoho",
          ]
            .filter(Boolean)
            .some((s) => s.toLowerCase().includes(q))),
    );
  }, [conversations, search, view, visitorFilter, messageHits]);

  const selected = conversations.find((c) => c.id === selectedId);

  // The products the open chat was about: the first two of each reply
  // (the best picks), once each (newest last).
  const productsSeen = useMemo(() => {
    const seen = new Map();
    for (const m of messages) {
      for (const p of (m.products ?? []).slice(0, SEEN_PER_REPLY)) {
        if (p?.url && !seen.has(p.url)) seen.set(p.url, p);
      }
    }
    return [...seen.values()];
  }, [messages]);

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
    setView("all");
    open(id);
  };

  const refresh = () => {
    loadList();
    setStatsRefresh((n) => n + 1);
  };

  // A summary card: shows that filter's chats.
  const showView = (id) => {
    setTab("conversations");
    setView(id);
  };

  const rangeLabel = (RANGES.find((r) => r.id === range)?.label ?? "").replace(
    /^Last/,
    "last",
  );

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

  const summary = [
    { id: "needs", n: counts.needs, label: "need reply", icon: BellRing, tone: "alert" },
    { id: "leads", n: counts.newLeadsToday, label: "new leads today", icon: UserPlus, tone: "lead" },
    { id: "all", n: counts.all, label: `chats · ${rangeLabel}`, icon: MessagesSquare, tone: "chats" },
    { id: "zoho", n: counts.zoho, label: "in Zoho", icon: CircleCheck, tone: "zoho" },
  ];

  const warmth = selected && warmthOf(selected);

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
          <span className="chats-live" title="Checks for new chats every 30 seconds">
            <span className="chats-live-dot" />
            Live
          </span>
          <button
            type="button"
            className="chats-btn"
            onClick={refresh}
            disabled={loadingList}
          >
            <RefreshCw size={14} className={loadingList ? "chats-spin" : ""} />
            Refresh
          </button>
          {/* Kept apart from Refresh so it isn't hit by mistake. */}
          <span className="chats-header-divider" aria-hidden="true" />
          <button type="button" className="chats-btn chats-logout" onClick={logout}>
            <LogOut size={14} />
            Log out
          </button>
        </div>
      </div>

      <div className="chats-topbar">
        <div className="chats-summary">
          {summary.map((s) => (
            <button
              key={s.id + s.label}
              type="button"
              className={`chats-summary-card chats-summary-${s.tone}`}
              onClick={() => showView(s.id)}
            >
              <span className="chats-summary-icon">
                <s.icon size={15} />
              </span>
              <strong className={s.tone === "alert" && s.n > 0 ? "chats-summary-alert" : ""}>
                {loadingList && !conversations.length ? "–" : s.n}
              </strong>
              {s.label}
            </button>
          ))}
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
      </div>

      {tab === "stats" ? (
        <div className="chats-stats">
          <ChatResults
            toolbar={<div className="chats-stats-filter">{dateFilter}</div>}
            token={token}
            bounds={bounds}
            refreshKey={statsRefresh}
            handleResponse={handleResponse}
            onOpenChat={openFromResults}
          />
        </div>
      ) : (
      <div
        className={`chats-layout${selected ? " chats-has-selection" : ""}${
          infoOpen ? " chats-show-info" : ""
        }`}
      >
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

          <div className="chats-views">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`chats-view${view === v.id ? " chats-view-active" : ""}`}
                onClick={() => setView(v.id)}
              >
                {v.label}
                {counts[v.id] > 0 && <span>{counts[v.id]}</span>}
              </button>
            ))}
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

          {(loadingList || searchingMessages) && (
            <div className="chats-count">
              {loadingList ? "Loading…" : "Searching messages…"}
            </div>
          )}

          {/* Only this part scrolls; search and filters stay put. */}
          <div className="chats-items">
            {!loadingList && conversations.length === 0 && (
              <p className="chats-empty">
                {range === "all"
                  ? "No chats yet. They'll appear here as people use Ask AI."
                  : "No chats in this period. Try a longer range, or All time."}
              </p>
            )}
            {!loadingList && conversations.length > 0 && filtered.length === 0 && (
              <p className="chats-empty">
                {view === "needs" && !search
                  ? "All caught up. Nobody's waiting on the team."
                  : "No chats match."}
              </p>
            )}

            {filtered.map((c) => (
              <button
                type="button"
                key={c.id}
                className={`chats-item${c.id === selectedId ? " chats-item-active" : ""}`}
                onClick={() => open(c.id)}
              >
                <Avatar c={c} dot={c.needsReply} />
                <div className="chats-item-body">
                <div className="chats-item-top">
                  <span className="chats-item-title">
                    <span className="chats-item-name">
                      {titleOf(c)}
                      {/* Visitor numbers restart daily: which day's. */}
                      {isNumberTitle(c) && !isToday(c.startedAt) && (
                        <small className="chats-item-day">
                          {formatDay(c.visitorDay)}
                        </small>
                      )}
                    </span>
                  </span>
                  <span className="chats-item-date">{listTime(c.lastMessageAt)}</span>
                </div>
                {c.topic && <div className="chats-item-topic">{c.topic}</div>}
                {/* While searching, the line that matched (if it's in a
                    message) instead of the latest question. */}
                {messageHits.has(c.id) ? (
                  <div className="chats-item-preview chats-item-match">
                    {messageHits.get(c.id)}
                  </div>
                ) : (
                  c.preview && <div className="chats-item-preview">{c.preview}</div>
                )}
                <div className="chats-item-tags">
                  {c.needsReply && <span className="chats-tag chats-tag-alert">Needs reply</span>}
                  {isLead(c) && <span className="chats-tag chats-tag-lead">Lead</span>}
                  {c.zohoLeadId && (
                    <span className="chats-tag chats-tag-zoho" title="Lead in Zoho">
                      Zoho ✓
                    </span>
                  )}
                  {c.takeover ? (
                    !c.needsReply && <span className="chats-tag chats-tag-team">Team</span>
                  ) : (
                    <span className="chats-tag">AI handled</span>
                  )}
                  <span className="chats-item-count">{c.messageCount} msgs</span>
                </div>
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
                <Avatar c={selected} />
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
                      {selected.needsReply && (
                        <span className="chats-tag chats-tag-alert">Needs reply</span>
                      )}
                      {selected.zohoLeadId && (
                        <span className="chats-tag chats-tag-zoho">Zoho ✓</span>
                      )}
                    </h2>
                  )}
                  <div className="chats-detail-meta">
                    <span>Started {formatDate(selected.startedAt)}</span>
                    {selected.firstPage && (
                      <span className="chats-meta-page">
                        On:{" "}
                        <a
                          href={pageUrl(selected.firstPage)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {shortPage(selected.firstPage)}
                        </a>
                      </span>
                    )}
                    <button
                      type="button"
                      className="chats-meta-btn"
                      onClick={() => setVisitorFilter(selected.visitorId)}
                      title="Show every chat from this browser"
                    >
                      {visitorTag(selected.visitorId)}
                    </button>
                  </div>
                </div>
                <div className="chats-detail-actions">
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
                    className="chats-btn chats-info-toggle"
                    onClick={() => setInfoOpen((o) => !o)}
                    aria-label="Visitor details"
                    title="Visitor details"
                  >
                    <PanelRight size={15} />
                  </button>
                  <div className="chats-menu">
                    <button
                      type="button"
                      className="chats-btn chats-menu-btn"
                      onClick={() => setMenuOpen((o) => !o)}
                      aria-label="More"
                      aria-expanded={menuOpen}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                    {menuOpen && (
                      <div className="chats-menu-list" role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuOpen(false);
                            setEditingLabel(selected.label ?? "");
                          }}
                        >
                          <Pencil size={14} /> Rename chat
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setMenuOpen(false);
                            setVisitorFilter(selected.visitorId);
                          }}
                        >
                          <Users size={14} /> All chats from this visitor
                          {visitorCounts.get(selected.visitorId) > 1 &&
                            ` (${visitorCounts.get(selected.visitorId)})`}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="chats-menu-danger"
                          onClick={deleteConversation}
                        >
                          <Trash2 size={14} /> Delete chat
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="chats-transcript" ref={transcriptRef}>
                {loadingMessages && <p className="chats-empty">Loading...</p>}
                {messages.map((m, i) => {
                  const prev = messages[i - 1];
                  // A date marker at the start of each day.
                  const newDay =
                    !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
                  const dateMarker = newDay && (
                    <div className="chats-date-pill">
                      {new Date(m.created_at).toLocaleDateString([], {
                        day: "numeric",
                        month: "short",
                      })}{" "}
                      · {formatTime(m.created_at)}
                    </div>
                  );
                  if (m.sender === "system") {
                    return (
                      <div key={m.id} className="chats-turn">
                        {dateMarker}
                        <div className="chats-system-note">
                          {m.answer} · {formatTime(m.created_at)}
                        </div>
                      </div>
                    );
                  }
                  const products = m.products ?? [];
                  const fromTeam = m.sender === "agent";
                  return (
                    <div key={m.id} className="chats-turn">
                      {dateMarker}
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
                        <div
                          className="chats-bubble chats-bubble-user"
                          title={formatDate(m.created_at)}
                        >
                          {m.question}
                        </div>
                      )}
                      {m.question && !m.answer && (
                        <span className="chats-bubble-time">
                          {formatTime(m.created_at)}
                        </span>
                      )}
                      {(m.answer || fromTeam) && (
                        <div className="chats-reply-block">
                          <div className="chats-sender">
                            <span
                              className={`chats-sender-chip${fromTeam ? " chats-sender-team" : ""}`}
                            >
                              {fromTeam ? "Ware team" : "AI"}
                            </span>
                            {products.length > 0 &&
                              `Shown ${products.length} product${products.length === 1 ? "" : "s"}`}
                            <span className="chats-sender-time">
                              {formatTime(m.created_at)}
                            </span>
                          </div>
                          {m.answer && (
                            <div
                              className={`chats-bubble ${fromTeam ? "chats-bubble-team" : "chats-bubble-ai"}`}
                            >
                              {m.answer}
                            </div>
                          )}
                          {products.length > 0 && (
                            <ProductRow products={products} />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {selected.takeover ? (
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
              ) : (
                <div className="chats-ai-note">
                  <span>Ask AI is replying to this visitor. Take over to reply yourself.</span>
                  <button type="button" className="chats-btn" onClick={toggleTakeover}>
                    Take over
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {selected && (
          <aside className="chats-info" aria-label="Visitor details">
            <button
              type="button"
              className="chats-icon-btn chats-info-close"
              onClick={() => setInfoOpen(false)}
              aria-label="Close details"
            >
              <X size={16} />
            </button>

            <div className="chats-info-section">
              <div className="chats-info-title">Lead</div>
              <div className="chats-warmth">
                <div className={`chats-warmth-bar chats-warmth-${warmth}`}>
                  <span style={{ width: WARMTH[warmth].width }} />
                </div>
                <span className={`chats-warmth-label chats-warmth-${warmth}`}>
                  {WARMTH[warmth].label}
                </span>
              </div>
              <p className="chats-info-note">
                {selected.topic ? `${selected.topic}. ` : ""}
                {hasContact(selected)
                  ? "Contact details shared."
                  : "No contact details yet."}
              </p>
            </div>

            <LeadCard
              key={selected.id}
              conversation={selected}
              api={api}
              open={leadOpen}
              onOpenChange={setLeadOpen}
              onUpdated={(patch) => patchConversation(selected.id, patch)}
            />

            <div className="chats-info-section">
              <div className="chats-info-title">Right now</div>
              <dl className="chats-info-rows">
                <InfoRow
                  label="Page"
                  clamp
                  value={
                    (selected.lastPage || selected.firstPage) && (
                      <a
                        href={pageUrl(selected.lastPage || selected.firstPage)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {shortPage(selected.lastPage || selected.firstPage)}
                      </a>
                    )
                  }
                />
                <InfoRow label="Cart" value={selected.cart} />
                <InfoRow label="Device" value={selected.device} />
                <InfoRow
                  label="Visits"
                  value={
                    selected.visits > 1
                      ? `${ordinal(selected.visit)} of ${selected.visits}`
                      : "First visit"
                  }
                />
                <InfoRow label="Last active" value={timeAgo(selected.lastMessageAt)} />
              </dl>
            </div>

            {productsSeen.length > 0 && (
              <div className="chats-info-section">
                <div className="chats-info-title">Products seen</div>
                <ul className="chats-seen">
                  {productsSeen.map((p) => (
                    <li key={p.url}>
                      <a href={p.url} target="_blank" rel="noopener noreferrer">
                        <span className="chats-product-img">
                          {p.image && <img src={thumb(p.image)} alt="" loading="lazy" />}
                        </span>
                        <span>
                          {p.title}
                          <small>
                            Shown in chat
                            {p.price ? ` · ${p.price}` : ""}
                            {!p.available ? " · Sold out" : ""}
                          </small>
                        </span>
                        <ExternalLink size={12} />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        )}
      </div>
      )}
    </div>
  );
};

// A reply's products: one row, no scrollbar; arrows scroll it when it's
// wider than the chat.
const ProductRow = ({ products }) => {
  const rowRef = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    setEdges({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, products]);

  const scroll = (dir) => {
    const el = rowRef.current;
    el?.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <div className="chats-product-row">
      {edges.left && (
        <button
          type="button"
          className="chats-row-arrow chats-row-arrow-left"
          onClick={() => scroll(-1)}
          aria-label="Earlier products"
        >
          <ChevronLeft size={16} />
        </button>
      )}
      <div className="chats-product-tiles" ref={rowRef} onScroll={measure}>
        {products.map((p) => (
          <a
            key={p.url}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className="chats-product-tile"
          >
            <span className="chats-product-img">
              {p.image && <img src={thumb(p.image)} alt="" loading="lazy" />}
            </span>
            <span className="chats-product-name">{p.title}</span>
            {!p.available && <span className="chats-product-soldout">Sold out</span>}
          </a>
        ))}
      </div>
      {edges.right && (
        <button
          type="button"
          className="chats-row-arrow chats-row-arrow-right"
          onClick={() => scroll(1)}
          aria-label="More products"
        >
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  );
};

// One "Label   value" line in the side panel; `missing` (orange) or a
// dash when there's no value.
const InfoRow = ({ label, value, missing, clamp }) => (
  <div className="chats-info-row">
    <dt>{label}</dt>
    <dd
      className={
        value
          ? clamp
            ? "chats-info-clamp"
            : ""
          : missing
            ? "chats-info-missing"
            : "chats-info-none"
      }
    >
      {value || missing || "—"}
    </dd>
  </div>
);

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
