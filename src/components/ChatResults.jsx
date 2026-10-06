import { Fragment, useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  ExternalLink,
} from "lucide-react";
import { callFunction } from "../lib/askFaq";
import { ChatGaps, ChatProducts, ChatAiCost } from "./ChatInsights";
import { pageKind, pageKindLabel, pageLabel, pageUrl } from "../lib/storePages";

// The Chats page's Stats tab: how the store chat did in the chosen date
// range. Orders come from Shopify via chat-admin ("results"): the chat tags
// the shopper's cart, so an order either
//   - came from someone who chatted first ("orders from people who
//     chatted"), or
//   - has items added with the chat's own + button ("added in chat").

const rupees = (n) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const percent = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : "0%");

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

// Shopify's image CDN resizes on request.
const thumb = (url) =>
  url ? `${url}${url.includes("?") ? "&" : "?"}width=120` : url;

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
  const [showOrders, setShowOrders] = useState(false);
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
  const show = (v) => (loading ? "…" : data ? v(data) : "–");

  // Each step is a share of the one before. "Ordered" sits apart: people
  // can order without leaving a number, so it isn't a fourth step.
  const steps = [
    { label: "Chatted", n: (d) => d.chats },
    {
      label: "Had a real conversation",
      n: (d) => d.realChats,
      title: "Two or more messages",
    },
    { label: "Left their number", n: (d) => d.leads },
  ];
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
      <>
      <section className="chats-card">
        <h3>
          From chat to order
          <span> · how many people make it to each step</span>
        </h3>
        <div className="chats-funnel">
          {steps.map((s, i) => (
            <Fragment key={s.label}>
              {i > 0 && (
                <span className="chats-funnel-arrow" aria-hidden="true">
                  <ArrowRight size={16} />
                </span>
              )}
              <div className="chats-funnel-step" title={s.title}>
                <span className="chats-funnel-label">{s.label}</span>
                <strong>{show(s.n)}</strong>
                {i > 0 && (
                  <span className="chats-funnel-sub">
                    {show((d) => `${percent(s.n(d), d.chats)} of chats`)}
                  </span>
                )}
              </div>
            </Fragment>
          ))}
          <div
            className={`chats-funnel-step chats-funnel-apart${
              data?.ordered > 0 ? " chats-funnel-good" : ""
            }`}
          >
            <span className="chats-funnel-label">Ordered</span>
            <strong>{show((d) => d.ordered)}</strong>
            <span className="chats-funnel-sub">
              {show((d) => `${percent(d.ordered, d.chats)} of chats, at any step`)}
            </span>
          </div>
        </div>
      </section>

      {data?.ordersError && (
        <p className="chats-results-note chats-results-warn">
          {data.ordersError} Order numbers show as 0 until then.
        </p>
      )}

      <div className="chats-stats-pair">
        <section className="chats-card">
          <span className="chats-card-label">Orders from people who chatted</span>
          <strong className="chats-card-big">{show((d) => rupees(d.revenue))}</strong>
          <p className="chats-card-sub">
            {show(
              (d) =>
                `${d.orders} order${d.orders === 1 ? "" : "s"}. They chatted, then bought on their own.`,
            )}
          </p>
          {data?.list.length > 0 && (
            <button
              type="button"
              className="chats-card-link"
              onClick={() => setShowOrders((v) => !v)}
            >
              {showOrders ? "Hide orders" : "See orders"}
              {showOrders ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>
          )}
        </section>
        <section className="chats-card">
          <span className="chats-card-label">Orders from items added in chat</span>
          <strong className="chats-card-big">
            {show((d) => rupees(d.fromChatRevenue))}
          </strong>
          <p className="chats-card-sub">
            {show(
              (d) =>
                `${d.fromChatOrders} order${d.fromChatOrders === 1 ? "" : "s"}. Items added to cart straight from a product card in chat.`,
            )}
          </p>
        </section>
      </div>

      {showOrders && data?.list.length > 0 && (
        <section className="chats-card chats-orders-card">
          <table className="chats-results-orders">
            <thead>
              <tr>
                <th>Order</th>
                <th>Date</th>
                <th>Total</th>
                <th>Added from chat</th>
                <th>Chat</th>
                <th>Visitor</th>
              </tr>
            </thead>
            <tbody>
              {data.list.map((o) => (
                <tr key={o.id} className={o.cancelled ? "chats-results-cancelled" : ""}>
                  <td>
                    <a href={o.adminUrl} target="_blank" rel="noopener noreferrer">
                      {o.name}
                      <ExternalLink size={11} />
                    </a>
                    {o.cancelled && " (cancelled)"}
                  </td>
                  <td>{formatDate(o.createdAt)}</td>
                  <td>{rupees(o.total)}</td>
                  <td>{o.fromChatTotal ? rupees(o.fromChatTotal) : "–"}</td>
                  <td>
                    {o.conversationId ? (
                      <button
                        type="button"
                        className="chats-results-chat"
                        onClick={() => onOpenChat(o.conversationId)}
                      >
                        {o.chatTitle}
                      </button>
                    ) : (
                      "–"
                    )}
                  </td>
                  {/* The browser's tag, as in Conversations ("#04174e"). */}
                  <td>
                    {o.visitorId ? (
                      <span className="chats-carts-tag">#{o.visitorId.slice(0, 6)}</span>
                    ) : (
                      "–"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      </>
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

      {view === "products" && <ChatProducts api={api} request={request} />}
      {view === "cost" && isOwner && <ChatAiCost api={api} request={request} />}
      {view === "gaps" && (
        <ChatGaps api={api} request={request} onOpenChat={onOpenChat} onTeach={onTeach} />
      )}

      {view === "stats" && (
      <div className="chats-stats-pair chats-stats-pair-wide">
        <ChatPages pages={data?.pages} loading={loading} />
        <section className="chats-card">
          <h3>What people ask about</h3>
          {loading ? (
            <p className="chats-results-note">Loading…</p>
          ) : !data?.askedAbout?.length ? (
            <p className="chats-results-note">No chats in this period.</p>
          ) : (
            <ul className="chats-asks">
              {data.askedAbout.map((a) => (
                <li key={a.label}>
                  <span>{a.label}</span>
                  <strong>{a.chats}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      )}

      {data && view === "stats" && (
        <p className="chats-results-note chats-stats-foot">
          Orders counted from{" "}
          {new Date(data.trackingFrom).toLocaleDateString([], {
            day: "numeric",
            month: "short",
          })}
          . Only orders from the same browser they chatted on; calls and
          WhatsApp orders aren&apos;t included.
        </p>
      )}
    </div>
  );
};

// "Where chats start": chats per store page they started on, most first,
// optionally one kind of page. Top 6, then all.
const PAGES_SHOWN = 6;
const PAGE_FILTERS = [
  { id: "all", label: "All" },
  { id: "products", label: "Products" },
  { id: "collections", label: "Collections" },
  { id: "pages", label: "Pages" },
  { id: "home", label: "Home" },
];

const ChatPages = ({ pages, loading }) => {
  const [kind, setKind] = useState("all");
  const [showAll, setShowAll] = useState(false);

  const all = (pages ?? []).filter((p) => p.chats > 0);
  const rows = all
    .filter((p) => kind === "all" || pageKind(p.page) === kind)
    .sort((a, b) => b.chats - a.chats || a.page.localeCompare(b.page));
  const most = rows[0]?.chats ?? 1;
  // Only the kinds that have something.
  const filters = PAGE_FILTERS.filter(
    (f) => f.id === "all" || all.some((p) => pageKind(p.page) === f.id),
  );

  return (
    <section className="chats-card">
      <h3>Where chats start</h3>
      {filters.length > 2 && (
        <div className="chats-views chats-page-filters">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`chats-view${kind === f.id ? " chats-view-active" : ""}`}
              onClick={() => {
                setKind(f.id);
                setShowAll(false);
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
      {loading ? (
        <p className="chats-results-note">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="chats-results-note">
          No pages recorded in this period yet. Pages are saved for chats
          from Sep 29.
        </p>
      ) : (
        <>
          <ol className="chats-starts">
            {rows.slice(0, showAll ? rows.length : PAGES_SHOWN).map((p) => (
              <li key={p.page}>
                <span className="chats-start-img">
                  {p.image && <img src={thumb(p.image)} alt="" loading="lazy" />}
                </span>
                <span className="chats-start-name">
                  <a href={pageUrl(p.page)} target="_blank" rel="noopener noreferrer">
                    {p.title || pageLabel(p.page).replace(/^[\w ]+ · /, "")}
                  </a>
                  <small>{pageKindLabel(p.page)}</small>
                </span>
                <span className="chats-start-bar" aria-hidden="true">
                  <span style={{ width: `${(p.chats / most) * 100}%` }} />
                </span>
                <strong>{p.chats}</strong>
              </li>
            ))}
          </ol>
          {rows.length > PAGES_SHOWN && (
            <button
              type="button"
              className="chats-card-link"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? "Show top 6" : `Show all ${rows.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
};

export default ChatResults;
