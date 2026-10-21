import { useEffect, useState } from "react";
import { callFunction } from "../lib/askFaq";
import { ChatGaps, ChatJourneys, ChatProducts, ChatAiCost } from "./ChatInsights";
import ChatDashboard from "./ChatDashboard";

// The Chats page's Stats tab: how the store chat did in the chosen date
// range, as tabs (Overview is ChatDashboard; the rest are below and in
// ChatInsights), in two groups: Sales and the bot. chat-admin's "results"
// is loaded here for every tab: the orders (from Shopify; the chat tags
// the shopper's cart, so an order either came from someone who chatted
// first, or has items added with the chat's own + button), pages and
// topics, and the carts (on Overview).

// How often the open Stats tab reloads by itself.
const STATS_REFRESH_MS = 2 * 60 * 1000;

// "Hide test and junk chats" is remembered in this browser only.
const HIDE_TEST_KEY = "chatsHideTest";
const readHideTest = () => {
  try {
    return localStorage.getItem(HIDE_TEST_KEY) !== "0";
  } catch {
    return true;
  }
};

// refreshKey: bumped by the page's Refresh button, which also skips the
// server's short cache of Shopify orders.
const ChatResults = ({
  token,
  bounds,
  refreshKey = 0,
  handleResponse,
  onOpenChat,
  toolbar,
  // The tab to open on (Today's "Couldn't answer" opens on "gaps").
  initialView = "stats",
  // For the Products and Couldn't answer tabs.
  api,
  // "Teach the bot" on a question it couldn't answer (owner only).
  onTeach,
  // The AI cost tab (owner only).
  isOwner = false,
}) => {
  const [view, setView] = useState(initialView);
  const [hideTest, setHideTest] = useState(readHideTest);
  // Keyed by what it's for, so a new choice shows "…" until it loads.
  const [result, setResult] = useState({ key: null, data: null });
  const key = JSON.stringify({ ...bounds, refreshKey, hideTest });

  useEffect(() => {
    let cancelled = false;
    const { refreshKey: refreshed, ...request } = JSON.parse(key);
    callFunction("chat-admin", {
      action: "results",
      token,
      ...request,
      fresh: refreshed > 0,
    }).then((res) => {
      if (cancelled) return;
      // A Shopify problem shouldn't also log them out or toast every time:
      // the tab says it couldn't load instead.
      const data = res.data?.error ? null : handleResponse(res);
      setResult({ key, data, error: res.data?.error ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [token, key, handleResponse]);

  // Quietly reloads while the tab is open and in view (no "…" flash).
  // Shopify's orders come from the server's 5-minute cache in between.
  useEffect(() => {
    const timer = setInterval(async () => {
      if (document.hidden) return;
      const { refreshKey: _refreshed, ...request } = JSON.parse(key);
      const { data: fresh } = await callFunction("chat-admin", {
        action: "results",
        token,
        ...request,
      });
      if (fresh && !fresh.error) {
        setResult((prev) => (prev.key === key ? { key, data: fresh, error: null } : prev));
      }
    }, STATS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [token, key]);

  const toggleHideTest = () => {
    const next = !hideTest;
    setHideTest(next);
    try {
      localStorage.setItem(HIDE_TEST_KEY, next ? "1" : "0");
    } catch {
      // Just for this visit then.
    }
  };

  const loading = result.key !== key;
  const data = loading ? null : result.data;

  // Sales: how the chat sells. Bot: how well it answers, and what it costs.
  const TAB_GROUPS = [
    {
      label: "Sales",
      tabs: [
        ["stats", "Overview"],
        ["journeys", "Journeys"],
        ["products", "Products"],
      ],
    },
    {
      label: "Bot",
      tabs: [["gaps", "Couldn't answer"], isOwner && ["cost", "AI cost"]].filter(Boolean),
    },
  ];
  const request = { ...bounds, hideTest, refreshKey };

  return (
    <div className="chats-stats-body">
      <div className="chats-stats-tabs" role="tablist">
        {TAB_GROUPS.map((g) => (
          <div key={g.label} className="chats-stats-tab-group">
            <span className="chats-stats-tab-group-label">{g.label}</span>
            <div className="chats-stats-tab-row">
              {g.tabs.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={view === id}
                  className={`chats-stats-tab${view === id ? " chats-stats-tab-active" : ""}`}
                  onClick={() => setView(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="chats-stats-toolbar">
        {toolbar}
        <label className="chats-switch">
          <input type="checkbox" checked={hideTest} onChange={toggleHideTest} />
          <span className="chats-switch-track" aria-hidden="true" />
          Hide test and junk chats
          {hideTest && data?.hiddenTest > 0 && (
            <span className="chats-switch-note">({data.hiddenTest} hidden)</span>
          )}
        </label>
      </div>

      {result.error && !loading && (
        <p className="chats-results-note chats-results-warn">{result.error}</p>
      )}

      {view === "stats" && (
        <ChatDashboard
          api={api}
          request={request}
          results={data}
          resultsLoading={loading}
          onOpenChat={onOpenChat}
          onShowGaps={() => setView("gaps")}
        />
      )}

      {view === "journeys" && (
        <ChatJourneys api={api} request={request} onOpenChat={onOpenChat} />
      )}
      {view === "products" && <ChatProducts api={api} request={request} />}
      {view === "cost" && isOwner && <ChatAiCost api={api} request={request} />}
      {view === "gaps" && (
        <ChatGaps api={api} request={request} onOpenChat={onOpenChat} onTeach={onTeach} />
      )}

    </div>
  );
};

export default ChatResults;
