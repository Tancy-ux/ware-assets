import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { callFunction } from "../lib/askFaq";
import { ChatGaps, ChatJourneys, ChatProducts, ChatAiCost } from "./ChatInsights";
import ChatDashboard from "./ChatDashboard";

// The Chats page's Stats tab: how the store chat did in the chosen date
// range, as tabs (Overview is ChatDashboard; the rest are below and in
// ChatInsights). chat-admin's "results" is loaded here for every tab: the
// orders (from Shopify; the chat tags the shopper's cart, so an order
// either came from someone who chatted first, or has items added with the
// chat's own + button), pages, topics and carts.

const rupees = (n) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const formatDate = (iso) =>
  new Date(iso).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

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
  // What this login may see: Overview, Products and Couldn't answer with
  // Stats; the Carts tab with Carts.
  canStats = true,
  canCarts = false,
  // For the Products and Couldn't answer tabs.
  api,
  // "Teach the bot" on a question it couldn't answer (owner only).
  onTeach,
  // The AI cost tab (owner only).
  isOwner = false,
}) => {
  const [view, setView] = useState(canStats ? "stats" : "carts");
  // Carts table order: by cart value or last chatted, either way (newest
  // first to start with).
  const [cartSort, setCartSort] = useState({ by: "date", desc: true });
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
  // What's sitting in carts that hasn't been ordered (from the carts list).
  const openCarts = Array.isArray(data?.carts)
    ? data.carts.filter((c) => !c.ordered)
    : [];
  const openCartsValue = openCarts.reduce((s, c) => s + (c.value ?? 0), 0);
  const sortedCarts = Array.isArray(data?.carts)
    ? [...data.carts].sort((a, b) => {
        const diff =
          cartSort.by === "value"
            ? (a.value ?? 0) - (b.value ?? 0)
            : String(a.lastAt).localeCompare(String(b.lastAt));
        return cartSort.desc ? -diff : diff;
      })
    : [];
  // A column heading that sorts the carts table (tap again to flip).
  const sortHead = (by, label) => {
    const on = cartSort.by === by;
    const Icon = on ? (cartSort.desc ? ArrowDown : ArrowUp) : ArrowUpDown;
    return (
      <th aria-sort={on ? (cartSort.desc ? "descending" : "ascending") : "none"}>
        <button
          type="button"
          className={`chats-sort${on ? " chats-sort-on" : ""}`}
          onClick={() =>
            setCartSort({ by, desc: on ? !cartSort.desc : true })
          }
        >
          {label}
          <Icon size={13} />
        </button>
      </th>
    );
  };

  const tabs = [
    canStats && ["stats", "Overview"],
    canCarts && ["carts", "Carts"],
    canStats && ["journeys", "Journeys"],
    canStats && ["products", "Products"],
    canStats && ["gaps", "Couldn't answer"],
    isOwner && ["cost", "AI cost"],
  ].filter(Boolean);
  const request = { ...bounds, hideTest, refreshKey };

  return (
    <div className="chats-stats-body">
      {tabs.length > 1 && (
        <div className="chats-stats-tabs" role="tablist">
          {tabs.map(([id, label]) => (
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
      )}
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

      {/* The Carts tab; only for logins allowed to see carts (the server
          leaves it out otherwise). */}
      {view === "carts" && Array.isArray(data?.carts) && (
        <section className="chats-card chats-orders-card">
          {openCarts.length > 0 && (
            <p className="chats-carts-headline">
              <strong>{rupees(openCartsValue)}</strong> in{" "}
              {openCarts.length} cart{openCarts.length === 1 ? "" : "s"}, no
              order since
            </p>
          )}
          <p className="chats-card-sub">
            What was in their cart the last time they chatted, newest first
            (sort by cart value or date from the column headings).
            The chat only sees the cart while they're chatting, so they may
            have changed or emptied it since. <strong>Ordered</strong> means
            Shopify has an order from the same browser after they chatted.
          </p>
          {data.carts.length === 0 ? (
            <p className="chats-results-note">Nobody in this period.</p>
          ) : (
            <table className="chats-results-orders">
              <thead>
                <tr>
                  <th>Chat</th>
                  {sortHead("value", "Cart when they last chatted")}
                  {sortHead("date", "Last chatted")}
                  <th>Since then</th>
                </tr>
              </thead>
              <tbody>
                {sortedCarts.map((c) => (
                  <tr key={c.conversationId}>
                    <td>
                      <button
                        type="button"
                        className="chats-results-chat"
                        onClick={() => onOpenChat(c.conversationId)}
                      >
                        {c.title}
                      </button>
                      {/^Visitor /.test(c.title) && (
                        <small className="chats-carts-tag">{c.tag}</small>
                      )}
                      {/* They left a phone or email: someone to follow up. */}
                      {c.lead && (
                        <span className="chats-tag chats-tag-lead chats-carts-lead">
                          Lead
                        </span>
                      )}
                    </td>
                    <td>{c.cart}</td>
                    <td>{formatDate(c.lastAt)}</td>
                    <td>
                      {/* Blank: no order from them yet. */}
                      {c.ordered && (
                        <span className="chats-tag chats-tag-lead">Ordered</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
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
