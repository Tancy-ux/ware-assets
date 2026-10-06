import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  BellRing,
  BookOpen,
  Bot,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  Contact,
  ExternalLink,
  House,
  Image as ImageIcon,
  LogOut,
  MapPin,
  RotateCcw,
  MessageCircle,
  MessagesSquare,
  MoreHorizontal,
  PanelRight,
  Pencil,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Trash2,
  UserPlus,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { toast } from "react-toastify";
import { Link } from "react-router-dom";
import { callFunction } from "../lib/askFaq";
import ChatResults from "./ChatResults";
import LeadCard from "./LeadCard";
import ChatTeam from "./ChatTeam";
import ChatBot from "./ChatBot";
import ChatQuickReplies from "./ChatQuickReplies";
import ChatContacts from "./ChatContacts";
import ChatProductPicker from "./ChatProductPicker";
import { pageLabel, pageUrl } from "../lib/storePages";
import { GOOGLE_CLIENT_ID } from "../lib/googleConfig";
import { TEXTS, fillText } from "../lib/chatTexts";
import "./Chats.css";

// Session token from the chat-admin function, kept in localStorage so
// closing the tab doesn't sign you out; the token itself expires after 7
// days (chat-admin's SESSION_HOURS), and Log out clears it.
const TOKEN_KEY = "chatsToken";

// How often an open, taken-over chat re-fetches its transcript.
const TRANSCRIPT_REFRESH_MS = 5000;
// How often the list checks for new chats and messages ("Live").
const LIST_REFRESH_MS = 30000;
// "Products seen" takes this many from each reply's cards, and shows this
// many before "Show all".
const SEEN_PER_REPLY = 1;
const SEEN_SHOWN = 6;

const readToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);
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

const msgCount = (n) => `${n} msg${n === 1 ? "" : "s"}`;

// Whether a re-fetched transcript is the same as the one showing (so a
// refresh with nothing new doesn't redraw it).
const sameMessages = (a, b) =>
  a.length === b.length &&
  a.at(-1)?.id === b.at(-1)?.id &&
  a.at(-1)?.answer === b.at(-1)?.answer;

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
// (hasContact comes from the server too, for logins that can't see them.)
const hasContact = (c) => !!(c.hasContact || c.visitorPhone || c.visitorEmail);
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
// Each with its icon and (muted) colour, see .chats-view-<id>.
// Chats from the team's own site (Ask AI there) only show under
// "Internal", so they're never mistaken for store visitors.
const external = (test) => (c) => !c.internal && test(c);
const VIEWS = [
  { id: "all", label: "All", icon: MessagesSquare, test: external(() => true) },
  { id: "needs", label: "Needs reply", icon: BellRing, test: external((c) => c.needsReply) },
  { id: "leads", label: "Leads", icon: UserPlus, test: external(isLead) },
  { id: "takeover", label: "Taken over", icon: UserRound, test: external((c) => c.takeover) },
  { id: "zoho", label: "In Zoho", icon: CircleCheck, test: external((c) => !!c.zohoLeadId) },
  { id: "internal", label: "Internal", icon: Building2, test: (c) => !!c.internal },
];

// The date filter's choices; the list (and message search) only covers
// conversations active in that window.
const RANGES = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
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
  // Whole days in the viewer's time zone.
  if (range === "today" || range === "yesterday") {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    if (range === "today") return { since: midnight.toISOString() };
    const dayBefore = new Date(midnight);
    dayBefore.setDate(dayBefore.getDate() - 1);
    return { since: dayBefore.toISOString(), until: midnight.toISOString() };
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
  // "AI reply": the products it picked that go with the reply (the team
  // member can remove any), and whether it's still writing.
  const [replyProducts, setReplyProducts] = useState([]);
  const [drafting, setDrafting] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  // The open chat's "..." menu, its Zoho lead form, and (on narrower
  // screens) the side panel.
  const [menuOpen, setMenuOpen] = useState(false);
  const [leadOpen, setLeadOpen] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  // The side panel's "Right now" (page, cart, device…): folded by default.
  const [visitorOpen, setVisitorOpen] = useState(false);
  // "Products seen" past the first SEEN_SHOWN (closed again per chat).
  const [allSeen, setAllSeen] = useState(false);
  // "Products seen" in the side panel: open while the AI has the chat,
  // folded once the team takes over ("Send a product" lists them then).
  // null = that default; a click overrides it for this chat.
  const [seenOpen, setSeenOpen] = useState(null);
  // The open chat's transcript scrolls inside its own box: kept at the
  // newest message, unless they've scrolled up to read (then it stays put
  // while new messages come in).
  const transcriptRef = useRef(null);
  const stickToBottom = useRef(true);
  useEffect(() => {
    const el = transcriptRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  // "conversations", "contacts", "stats", "team" or "bot".
  const [tab, setTab] = useState("conversations");
  // "Teach the bot" from Stats: the instruction to start on the Bot page.
  const [botDraft, setBotDraft] = useState(null);
  const clearBotDraft = useCallback(() => setBotDraft(null), []);
  // The logged-in person: { name, username, owner, permissions }. Every
  // action is also checked on the server; this only hides what they can't
  // use.
  const [me, setMe] = useState(null);
  const can = (perm) => !!me?.permissions?.[perm];
  // Bumped by Refresh so the stats reload too.
  const [statsRefresh, setStatsRefresh] = useState(0);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      // Nothing stored to clear.
    }
    setToken(null);
    setMe(null);
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

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    callFunction("chat-admin", { action: "me", token }).then((res) => {
      if (cancelled) return;
      const data = handleResponse(res);
      if (data) setMe(data);
    });
    return () => {
      cancelled = true;
    };
  }, [token, handleResponse]);

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

  const openingId = useRef(null);
  const open = async (id) => {
    openingId.current = id;
    stickToBottom.current = true;
    setSelectedId(id);
    setMessages([]);
    setEditingLabel(null);
    setReply("");
    setReplyProducts([]);
    setMenuOpen(false);
    setAllSeen(false);
    setSeenOpen(null);
    // The contact form starts collapsed while there's nothing in it.
    const conv = conversations.find((c) => c.id === id);
    setLeadOpen(
      !!conv && (hasContact(conv) || !!conv.zohoLeadId || !!conv.accountPhone),
    );
    setLoadingMessages(true);
    loadedAt.current = conversations.find((c) => c.id === id)?.lastMessageAt;
    const data = await api({ action: "messages", conversationId: id });
    if (openingId.current !== id) return; // they've opened another since
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

  // Saved messages replace the box (or go at the end if something's
  // typed); emojis go in at the cursor.
  const replyBox = useRef(null);
  const insertReply = (text, atCursor = false) => {
    const el = replyBox.current;
    if (atCursor && el) {
      const start = el.selectionStart ?? reply.length;
      const end = el.selectionEnd ?? reply.length;
      const next = reply.slice(0, start) + text + reply.slice(end);
      setReply(next);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + text.length, start + text.length);
      });
      return;
    }
    setReply((prev) => (prev.trim() ? `${prev.trimEnd()} ${text}` : text));
    requestAnimationFrame(() => el?.focus());
  };

  // What the bot would have said to their latest message, put in the box
  // (with its product picks above it) to edit and send, or not. One AI
  // answer's cost per click; nothing reaches the shopper until Send.
  const aiReply = async () => {
    if (drafting) return;
    if (
      reply.trim() &&
      !window.confirm("Replace what you've typed with the AI's reply?")
    ) {
      return;
    }
    const forId = selectedId;
    setDrafting(true);
    const data = await api({ action: "ai-reply", conversationId: forId });
    setDrafting(false);
    if (!data || openingId.current !== forId) return;
    setReply(data.answer);
    setReplyProducts(data.products ?? []);
    requestAnimationFrame(() => replyBox.current?.focus());
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
      products: replyProducts,
    });
    setSendingReply(false);
    if (!data) return;
    setReply("");
    setReplyProducts([]);
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
      if (openingId.current !== selectedId) return;
      // A signed-out session still says so; other hiccups wait for the
      // next check rather than popping an error every 5 seconds.
      if (res.error || res.data?.error) {
        if (res.error?.context?.status === 401) handleResponse(res);
        return;
      }
      const data = res.data;
      setMessages((prev) => (sameMessages(prev, data.messages) ? prev : data.messages));
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
      if (data?.messages && openingId.current === selectedId) {
        setMessages(data.messages);
      }
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

  // ⋯ menu: Mark as internal / Not internal (a real customer).
  const toggleInternal = async () => {
    setMenuOpen(false);
    const data = await api({
      action: "internal",
      conversationId: selectedId,
      internal: !selected?.internal,
    });
    if (data) patchConversation(selectedId, { internal: data.internal });
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

  // How many chats each quick filter has.
  const counts = useMemo(() => {
    const byView = Object.fromEntries(
      VIEWS.map((v) => [v.id, conversations.filter(v.test).length]),
    );
    return byView;
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

  // How many different days they've messaged in this chat: "1 day", or
  // "3 days (first 29 Sep)" for someone who keeps coming back.
  const daysChatted = useMemo(() => {
    const days = [
      ...new Set(
        messages.filter((m) => m.question).map((m) => dayKey(m.created_at)),
      ),
    ];
    if (!days.length) return null;
    if (days.length === 1) return "1 day";
    const first = messages.find((m) => m.question).created_at;
    return `${days.length} days (first ${new Date(first).toLocaleDateString([], {
      day: "numeric",
      month: "short",
    })})`;
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

  const refreshButton = (
    <button
      type="button"
      className="chats-btn chats-titlebar-refresh"
      onClick={refresh}
      disabled={loadingList}
      title="Refresh now"
      aria-label="Refresh now"
    >
      <RefreshCw size={15} className={loadingList ? "chats-spin" : ""} />
      <span>Refresh</span>
    </button>
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

  const warmth = selected && warmthOf(selected);
  const seenShown = seenOpen ?? !selected?.takeover;

  const NAV = [
    { id: "conversations", label: "Conversations", icon: MessagesSquare, show: true },
    // One row per person who left a phone or email.
    { id: "contacts", label: "Contacts", icon: Contact, show: can("people") },
    // Stats has an Overview tab and a Carts tab; either tick opens it.
    { id: "stats", label: "Stats", icon: BarChart3, show: can("stats") || can("carts") },
    { id: "team", label: "Team", icon: Users, show: can("users") },
    // The bot's instructions: the owner login only.
    { id: "bot", label: "Bot", icon: Bot, show: !!me?.owner },
  ];

  return (
    // On phones an open chat takes the whole screen (chats-chat-open).
    <div
      className={`chats-page chats-shell${
        selected && tab === "conversations" ? " chats-chat-open" : ""
      }`}
    >
      {/* Left menu: overview, sections, and who's logged in. */}
      <nav className="chats-nav" aria-label="Chats">
        {/* "Chats" with a small Live pill on the same line. */}
        <div className="chats-nav-head">
          <h1>WareBot</h1>
          <div className="chats-nav-live">
            <span className="chats-live" title="Checks for new chats every 30 seconds">
              <span className="chats-live-dot" />
              Live
            </span>
          </div>
        </div>

        <div className="chats-nav-section">
          {NAV.filter((n) => n.show).map((n) => (
            <button
              key={n.id}
              type="button"
              className={`chats-nav-item${tab === n.id ? " chats-nav-item-active" : ""}`}
              aria-current={tab === n.id ? "page" : undefined}
              title={n.label}
              onClick={() => setTab(n.id)}
            >
              <n.icon size={17} />
              {n.label}
              {/* Chats waiting on the team (hidden at 0). */}
              {n.id === "conversations" && counts.needs > 0 && (
                <span className="chats-nav-badge" aria-label={`${counts.needs} need a reply`}>
                  {counts.needs}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="chats-nav-foot">
          {/* Back to the rest of the site (WareBot has no site header). */}
          <Link to="/" className="chats-home" title="Ware brand assets home">
            <House size={14} />
            Ware assets home
          </Link>
          {me && (
            <div className="chats-nav-me">
              <span className="chats-avatar" style={{ "--avatar": "#3f7f86" }}>
                {(me.name || "?").charAt(0).toUpperCase()}
              </span>
              <span>
                <strong>{me.name}</strong>
                <small>{me.owner ? "Owner" : me.username}</small>
              </span>
            </div>
          )}
          <button type="button" className="chats-btn chats-logout" onClick={logout}>
            <LogOut size={14} />
            Log out
          </button>
        </div>
      </nav>

      <main className="chats-main">
      {/* The section's title, and the search for conversations. */}
      <header
        className={`chats-titlebar${tab === "conversations" ? " chats-titlebar-convos" : ""}`}
      >
        <h2>
          {(() => {
            const current = NAV.find((n) => n.id === tab) ?? NAV[0];
            return (
              <>
                <current.icon size={18} />
                {current.label}
              </>
            );
          })()}
        </h2>
        {["conversations", "contacts", "stats"].includes(tab) && refreshButton}
      </header>
      {tab === "bot" && me?.owner ? (
        <div className="chats-stats">
          <ChatBot api={api} draft={botDraft} onDraftUsed={clearBotDraft} />
        </div>
      ) : tab === "team" && can("users") ? (
        <div className="chats-stats">
          <ChatTeam api={api} me={me} />
        </div>
      ) : tab === "contacts" && can("people") ? (
        <div className="chats-stats">
          <ChatContacts
            api={api}
            bounds={bounds}
            refreshKey={statsRefresh}
            toolbar={<div className="chats-stats-filter">{dateFilter}</div>}
            onOpenChat={openFromResults}
          />
        </div>
      ) : tab === "stats" && (can("stats") || can("carts")) ? (
        <div className="chats-stats">
          <ChatResults
            isOwner={!!me?.owner}
            canStats={can("stats")}
            canCarts={can("carts")}
            toolbar={<div className="chats-stats-filter">{dateFilter}</div>}
            token={token}
            bounds={bounds}
            refreshKey={statsRefresh}
            handleResponse={handleResponse}
            onOpenChat={openFromResults}
            api={api}
            onTeach={(text) => {
              setBotDraft(text);
              setTab("bot");
            }}
          />
        </div>
      ) : (
      <div
        className={`chats-layout${selected ? " chats-has-selection" : ""}${
          infoOpen ? " chats-show-info" : ""
        }`}
      >
        <aside className="chats-list">
          {/* Searching the list, so it sits on top of it. */}
          <div className="chats-list-search">
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
            {/* Phones have no title bar here: Refresh comes along. */}
            <span className="chats-list-refresh">{refreshButton}</span>
          </div>
          <div className="chats-list-head">
            <span>
              {filtered.length} conversation{filtered.length === 1 ? "" : "s"}
            </span>
            {dateFilter}
          </div>

          <div className="chats-views">
            {/* "Internal" only shows when there are some (or it's open). */}
            {VIEWS.filter(
              (v) => v.id !== "internal" || counts.internal > 0 || view === "internal",
            ).map((v) => (
              <button
                key={v.id}
                type="button"
                className={`chats-view chats-view-${v.id}${
                  view === v.id ? " chats-view-active" : ""
                }`}
                onClick={() => setView(v.id)}
              >
                <span className="chats-view-icon" aria-hidden="true">
                  <v.icon size={12} />
                </span>
                {v.label}
                {counts[v.id] > 0 && <span>{counts[v.id]}</span>}
              </button>
            ))}
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
                {/* 1: name (plus what tells same-numbered visitors
                    apart), status tags, time. */}
                <div className="chats-item-top">
                  <span className="chats-item-title">
                    <span className="chats-item-name">{titleOf(c)}</span>
                    {/* Visitor numbers restart daily: which day's, and the
                        browser's short id. */}
                    {isNumberTitle(c) && (
                      <small className="chats-item-day">
                        {!isToday(c.startedAt) && `${formatDay(c.visitorDay)} · `}
                        {visitorTag(c.visitorId)}
                      </small>
                    )}
                    {c.needsReply && <span className="chats-tag chats-tag-alert">Needs reply</span>}
                    {isLead(c) && <span className="chats-tag chats-tag-lead">Lead</span>}
                    {c.zohoLeadId && (
                      <span className="chats-tag chats-tag-zoho" title="Lead in Zoho">
                        Zoho ✓
                      </span>
                    )}
                    {c.internal && (
                      <span className="chats-tag chats-tag-internal" title="From the team's own site">
                        Internal
                      </span>
                    )}
                  </span>
                  <span className="chats-item-date">{listTime(c.lastMessageAt)}</span>
                </div>
                {/* 2: what they're after. */}
                {c.topic && <div className="chats-item-topic">{c.topic}</div>}
                {/* 3: the latest message (or, while searching, the line that
                    matched), with who's handling it and the count. */}
                <div className="chats-item-last">
                  <span
                    className={`chats-item-preview${
                      messageHits.has(c.id) ? " chats-item-match" : ""
                    }`}
                  >
                    {messageHits.has(c.id) ? messageHits.get(c.id) : c.preview}
                  </span>
                  <small className="chats-item-count">
                    {c.takeover ? "Team" : "AI handled"} · {msgCount(c.messageCount)}
                  </small>
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
                      {can("edit") && (
                        <button
                          type="button"
                          className="chats-icon-btn"
                          onClick={() => setEditingLabel(selected.label ?? "")}
                          aria-label="Rename chat"
                          title="Rename"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      {selected.internal && (
                        <span className="chats-tag chats-tag-internal" title="From the team's own site">
                          Internal
                        </span>
                      )}
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
                  {can("reply") && (
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
                  )}
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
                        {can("edit") && (
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
                        )}
                        {can("edit") && (
                          <button type="button" role="menuitem" onClick={toggleInternal}>
                            <Building2 size={14} />
                            {selected.internal ? "Not internal (a real customer)" : "Mark as internal"}
                          </button>
                        )}
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
                        {can("delete") && (
                          <button
                            type="button"
                            role="menuitem"
                            className="chats-menu-danger"
                            onClick={deleteConversation}
                          >
                            <Trash2 size={14} /> Delete chat
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div
                className="chats-transcript"
                ref={transcriptRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  stickToBottom.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                }}
              >
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
                              {fromTeam ? m.agentName || "Ware team" : "AI"}
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
                              {linkify(m.answer)}
                            </div>
                          )}
                          {products.length > 0 && (
                            <ProductRow products={products} />
                          )}
                          <ReplyExtras extras={m.extras} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {selected.takeover && can("reply") ? (
                <>
                {/* Above the box: AI reply and the products going with the
                    reply as cards (from AI reply or the side panel's "Send a
                    product"; ✕ leaves one out). Nothing when there's neither. */}
                {(can("aireply") || replyProducts.length > 0) && (
                <div className="chats-reply-tools">
                  {/* Its own tick (one AI answer per click). */}
                  {can("aireply") && (
                    <button
                      type="button"
                      className="chats-btn chats-ai-reply"
                      onClick={aiReply}
                      disabled={drafting}
                      title="Write the reply the AI would give (you can edit it before sending)"
                    >
                      <Sparkles size={14} className={drafting ? "chats-pulse" : ""} />
                      <span>{drafting ? "Writing…" : "AI reply"}</span>
                    </button>
                  )}
                  {replyProducts.map((p) => (
                    <span key={p.url} className="chats-reply-pick">
                      {p.image && <img src={`${p.image}${p.image.includes("?") ? "&" : "?"}width=80`} alt="" />}
                      <span>
                        {p.title}
                        {p.price && <small>{p.price}</small>}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setReplyProducts((prev) => prev.filter((x) => x.url !== p.url))
                        }
                        aria-label={`Don't send ${p.title}`}
                        title="Don't send this one"
                      >
                        <X size={13} />
                      </button>
                    </span>
                  ))}
                </div>
                )}
                <form className="chats-reply" onSubmit={sendReply}>
                  <ChatQuickReplies
                    api={api}
                    visitorName={selected.visitorName}
                    onInsert={insertReply}
                  />
                  <textarea
                    ref={replyBox}
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
                </>
              ) : (
                <div className="chats-ai-note">
                  <span>
                    {selected.takeover
                      ? "The team has taken over this chat."
                      : can("reply")
                        ? "Ask AI is replying to this visitor. Take over to reply yourself."
                        : "Ask AI is replying to this visitor."}
                  </span>
                  {can("reply") && (
                    <button type="button" className="chats-btn" onClick={toggleTakeover}>
                      Take over
                    </button>
                  )}
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

            <div className="chats-info-section chats-lead">
              <button
                type="button"
                className="chats-lead-bar"
                onClick={() => setVisitorOpen((o) => !o)}
                aria-expanded={visitorOpen}
              >
                <span className="chats-info-title">Right now</span>
                {/* Folded: their cart, if there's something in it. */}
                {!visitorOpen && selected.cart && !/^empty$/i.test(selected.cart) && (
                  <span className="chats-lead-status">Cart {selected.cart}</span>
                )}
                {visitorOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
              {visitorOpen && (
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
                {selected.shopifyCustomerId && (
                  <InfoRow
                    label="Store account"
                    value={
                      <a
                        href={`https://admin.shopify.com/store/ware-innovations-mumbai/customers/${selected.shopifyCustomerId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {[selected.accountName, selected.accountEmail, selected.accountPhone]
                          .filter(Boolean)
                          .join(" · ") || "Logged in"}
                      </a>
                    }
                  />
                )}
                {/* "Empty": nothing in their cart the last time they chatted. */}
                <InfoRow
                  label="Cart"
                  value={selected.cart}
                  strong={!/^empty$/i.test(selected.cart ?? "")}
                />
                <InfoRow label="Device" value={selected.device} />
                <InfoRow label="Days chatted" value={daysChatted} />
                <InfoRow label="Last active" value={timeAgo(selected.lastMessageAt)} />
              </dl>
              )}
            </div>

            <LeadCard
              key={selected.id}
              conversation={selected}
              api={api}
              canEdit={can("edit")}
              canPush={can("zoho")}
              canDraft={can("draft")}
              canSeeContacts={can("contacts")}
              open={leadOpen}
              onOpenChange={setLeadOpen}
              onUpdated={(patch) => patchConversation(selected.id, patch)}
            />

            {productsSeen.length > 0 && (
              <div className="chats-info-section chats-lead">
                <button
                  type="button"
                  className="chats-lead-bar"
                  onClick={() => setSeenOpen(!seenShown)}
                  aria-expanded={seenShown}
                >
                  <span className="chats-info-title">
                    Products seen <span className="chats-seen-count">{productsSeen.length}</span>
                  </span>
                  {seenShown ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                </button>
                {seenShown && (
                <>
                <ul className="chats-seen">
                  {(allSeen ? productsSeen : productsSeen.slice(0, SEEN_SHOWN)).map((p) => (
                    <li key={p.url}>
                      <a href={p.url} target="_blank" rel="noopener noreferrer">
                        <span className="chats-product-img">
                          {p.image && <img src={thumb(p.image)} alt="" loading="lazy" />}
                        </span>
                        <span>
                          {p.title}
                          <small>
                            Shown in chat
                            {p.price ? ` · ${p.price.replace(/^Rs\.?\s*/, "₹")}` : ""}
                            {!p.available ? " · Sold out" : ""}
                          </small>
                        </span>
                        <ExternalLink size={12} />
                      </a>
                    </li>
                  ))}
                </ul>
                {productsSeen.length > SEEN_SHOWN && (
                  <button
                    type="button"
                    className="chats-card-link"
                    onClick={() => setAllSeen((v) => !v)}
                  >
                    {allSeen ? "Show fewer" : `Show all ${productsSeen.length}`}
                    {allSeen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                )}
                </>
                )}
              </div>
            )}

            {/* While replying: products to send with the reply. Before a
                search, the ones they've been shown in this chat (newest
                first, in stock). */}
            {selected.takeover && can("reply") && (
              <ChatProductPicker
                // Its own key: the LeadCard beside it is keyed by the chat id.
                key={`picker-${selected.id}`}
                api={api}
                picked={replyProducts}
                suggestions={[...productsSeen]
                  .reverse()
                  .filter((p) => p.available !== false)
                  .slice(0, 5)
                  .map((p) => ({
                    ...p,
                    price: p.price ? p.price.replace(/^Rs\.?\s*/, "₹") : null,
                  }))}
                onPick={(p) =>
                  setReplyProducts((prev) =>
                    prev.some((x) => x.url === p.url) ? prev : [...prev, p].slice(0, 6),
                  )
                }
              />
            )}
          </aside>
        )}
      </div>
      )}
      </main>
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
const InfoRow = ({ label, value, missing, clamp, strong }) => (
  <div className={`chats-info-row${strong && value ? " chats-info-strong" : ""}`}>
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

// Google's sign-in script, loaded once when the login shows.
const GOOGLE_SCRIPT = "https://accounts.google.com/gsi/client";
let googleScript = null;
const loadGoogle = () => {
  googleScript ??= new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = GOOGLE_SCRIPT;
    el.async = true;
    el.onload = () => resolve(window.google);
    el.onerror = () => {
      googleScript = null;
      reject(new Error("Google sign-in didn't load"));
    };
    document.head.appendChild(el);
  });
  return googleScript;
};

// Links in a reply, clickable (the store chat does the same).
const URL_PATTERN = /(https?:\/\/[^\s)]+)/g;
const linkify = (text) =>
  text.split(URL_PATTERN).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  );

// What the store chat showed under an AI reply besides its text and
// cards, drawn the way the shopper saw it (links work; buttons and forms
// are only pictures of them). Saved since scripts/supabase-chat-extras.sql.
const ReplyExtras = ({ extras }) => {
  if (!extras?.length) return null;
  const has = (x) => extras.includes(x);
  const link = (href, label) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="chats-extra-link">
      <BookOpen size={13} />
      {label}
      <ArrowUpRight size={12} />
    </a>
  );
  return (
    <div className="chats-extras" aria-label="Also shown to the shopper">
      {has("atelier_catalog") && link(TEXTS.atelierCatalogUrl, TEXTS.bespokeCatalog)}
      {has("horeca_catalog") && link(TEXTS.horecaCatalogUrl, TEXTS.horecaCatalog)}
      {has("store_map") && (
        <a href={TEXTS.storeMapUrl} target="_blank" rel="noopener noreferrer" className="chats-extra-link">
          <MapPin size={13} />
          {TEXTS.storeMapLabel}
          <ArrowUpRight size={12} />
        </a>
      )}
      {has("returns_link") && (
        <a href={TEXTS.returnsUrl} target="_blank" rel="noopener noreferrer" className="chats-extra-link">
          <RotateCcw size={13} />
          {TEXTS.returnsLabel}
          <ArrowUpRight size={12} />
          {TEXTS.returnsNote && <small>&nbsp;· {TEXTS.returnsNote}</small>}
        </a>
      )}
      {has("bespoke_call") && (
        <div className="chats-extra-buttons">
          <span className="chats-extra-pill chats-extra-pill-main">{TEXTS.bespokeYes}</span>
          <span className="chats-extra-pill">Not now</span>
        </div>
      )}
      {has("whatsapp") && (
        <div className="chats-extra-card">
          <MessageCircle size={15} />
          <span>
            <strong>{TEXTS.whatsappTitle}</strong>
            <small>{fillText(TEXTS.whatsappSubtitle, { hours: TEXTS.teamHours })}</small>
          </span>
        </div>
      )}
      {(has("details_form") || has("details_prompt")) && (
        <div className="chats-extra-note">
          <UserPlus size={13} /> Details asked
        </div>
      )}
      {has("gift_photos") && (
        <div className="chats-extra-note">
          <ImageIcon size={13} /> Gift packaging photos
        </div>
      )}
    </div>
  );
};

const ChatsLogin = ({ onLogin }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  // The owner's username / password, tucked away as a backup.
  const [showBackup, setShowBackup] = useState(!GOOGLE_CLIENT_ID);
  const [googleError, setGoogleError] = useState(null);
  const googleButton = useRef(null);

  const finish = useCallback(
    (data) => {
      if (!data?.token) {
        toast.error(data?.error ?? "Couldn't log in just now.");
        return;
      }
      try {
        localStorage.setItem(TOKEN_KEY, data.token);
      } catch {
        // Still logged in for this page view.
      }
      onLogin(data.token);
    },
    [onLogin],
  );

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;
    loadGoogle()
      .then((google) => {
        if (cancelled || !googleButton.current) return;
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          // Suggests the work account when several are signed in.
          hd: "wareinnovations.com",
          callback: async ({ credential }) => {
            setBusy(true);
            const { data } = await callFunction("chat-admin", {
              action: "google-login",
              credential,
            });
            setBusy(false);
            finish(data);
          },
        });
        google.accounts.id.renderButton(googleButton.current, {
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "pill",
          width: 280,
        });
      })
      .catch(() => {
        if (!cancelled) setGoogleError("Google sign-in didn't load. Check your connection and refresh.");
      });
    return () => {
      cancelled = true;
    };
  }, [finish]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const { data } = await callFunction("chat-admin", {
      action: "login",
      username,
      password,
    });
    setBusy(false);
    finish(data);
  };

  return (
    <div className="chats-page">
      <div className="chats-login">
        <h1>WareBot</h1>
        {GOOGLE_CLIENT_ID ? (
          <>
            <p>Sign in with your @wareinnovations.com Google account.</p>
            <div className="chats-login-google" ref={googleButton} />
            {busy && !showBackup && <p className="chats-login-note">Checking…</p>}
            {googleError && <p className="chats-login-note">{googleError}</p>}
          </>
        ) : (
          <p>Google sign-in isn't set up yet: use the owner login.</p>
        )}
        {showBackup ? (
          <form className="chats-login-backup" onSubmit={submit}>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Owner username"
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
        ) : (
          <button
            type="button"
            className="chats-login-link"
            onClick={() => setShowBackup(true)}
          >
            Owner backup login
          </button>
        )}
      </div>
    </div>
  );
};

export default ChatLogs;
