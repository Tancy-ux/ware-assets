import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { callFunction } from "../lib/askFaq";
import {
  PAGE_KINDS,
  pageKind,
  pageKindLabel,
  pageUrl,
} from "../lib/storePages";

// The Chats page's Results strip: how the store chat did in the chosen date
// range. Orders come from Shopify via chat-admin ("results"): the chat tags
// the shopper's cart, so an order either
//   - came from someone who chatted first ("orders after chatting"), or
//   - has items added with the chat's own + button ("added from chat").

const rupees = (n) =>
  `₹${Math.round(n).toLocaleString("en-IN")}`;

const formatDate = (iso) =>
  new Date(iso).toLocaleString([], {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

// refreshKey: bumped by the page's Refresh button, which also skips the
// server's short cache of Shopify orders.
const ChatResults = ({
  token,
  bounds,
  refreshKey = 0,
  handleResponse,
  onOpenChat,
}) => {
  // Keyed by the range it's for, so a new range shows "…" until it loads.
  const [result, setResult] = useState({ key: null, data: null });
  const [showOrders, setShowOrders] = useState(false);
  const key = JSON.stringify({ ...bounds, refreshKey });

  useEffect(() => {
    let cancelled = false;
    const { refreshKey: refreshed, ...range } = JSON.parse(key);
    callFunction("chat-admin", {
      action: "results",
      token,
      ...range,
      fresh: refreshed > 0,
    }).then((res) => {
      if (cancelled) return;
      // A Shopify problem shouldn't also log them out or toast every time:
      // the strip says it couldn't load instead.
      const data = res.data?.error ? null : handleResponse(res);
      setResult({ key, data, error: res.data?.error ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [token, key, handleResponse]);

  const loading = result.key !== key;
  const data = loading ? null : result.data;
  const value = (v) => (loading ? "…" : data ? v(data) : "–");
  const conversion = (d) =>
    d.chats ? `${Math.round((d.orders / d.chats) * 100)}%` : "0%";

  return (
    <>
    <div className="chats-results">
      <div className="chats-results-stats">
        <Stat label="Chats" value={value((d) => d.chats)} />
        <Stat
          label="Left their number"
          value={value((d) => d.leads)}
        />
        <Stat
          label="Orders after chatting"
          value={value((d) => d.orders)}
          note={value((d) => `${conversion(d)} of chats`)}
        />
        <Stat label="Their order value" value={value((d) => rupees(d.revenue))} />
        <Stat
          label="Added from chat"
          value={value((d) => rupees(d.fromChatRevenue))}
          note={value(
            (d) => `${d.fromChatOrders} order${d.fromChatOrders === 1 ? "" : "s"}`,
          )}
        />
      </div>

      {!loading && result.error && (
        <p className="chats-results-note">{result.error}</p>
      )}
      {!loading && data && (
        <p className="chats-results-note">
          Counted from{" "}
          {new Date(data.trackingFrom).toLocaleDateString([], {
            day: "numeric",
            month: "short",
          })}
          , when the chat started tagging carts. Only orders from the same
          browser they chatted on; calls and WhatsApp orders aren't included.
          {data.list.length > 0 && (
            <>
              {" "}
              <button
                type="button"
                className="chats-results-toggle"
                onClick={() => setShowOrders((v) => !v)}
              >
                {showOrders ? "Hide orders" : "See orders"}
                {showOrders ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            </>
          )}
        </p>
      )}

      {showOrders && data?.list.length > 0 && (
        <table className="chats-results-orders">
          <thead>
            <tr>
              <th>Order</th>
              <th>Date</th>
              <th>Total</th>
              <th>Added from chat</th>
              <th>Chat</th>
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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
    <ChatPages pages={data?.pages} loading={loading} />
    </>
  );
};

// "Pages": where chats come from, like Shopify's sessions by page: the
// messages sent from each page, sorted by the most or A–Z, optionally one
// kind of page only.
const PAGES_SHOWN = 20;
const ChatPages = ({ pages, loading }) => {
  const count = "messages";
  const [sort, setSort] = useState("most");
  const [kind, setKind] = useState("all");
  // Top 20, then "Show more" adds 20 at a time; changing a choice starts
  // over from the top 20.
  const [shown, setShown] = useState(PAGES_SHOWN);
  const choose = (set) => (e) => {
    set(e.target.value);
    setShown(PAGES_SHOWN);
  };

  const rows = (pages ?? [])
    .filter((p) => p[count] > 0 && (kind === "all" || pageKind(p.page) === kind))
    .sort((a, b) =>
      sort === "az"
        ? a.page.localeCompare(b.page)
        : b[count] - a[count] || a.page.localeCompare(b.page),
    );
  // Only the kinds that have something, so the menu stays short.
  const kinds = PAGE_KINDS.filter((k) =>
    (pages ?? []).some((p) => p[count] > 0 && pageKind(p.page) === k.id),
  );

  return (
    <div className="chats-results chats-pages">
      <div className="chats-pages-head">
        <h3>
          Pages <span className="chats-pages-sub">· messages sent from each</span>
        </h3>
        <div className="chats-pages-controls">
          <select
            value={kind}
            onChange={choose(setKind)}
            aria-label="Kind of page"
          >
            <option value="all">All pages</option>
            {kinds.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label === "Homepage" ? "Homepage" : `${k.label}s`}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={choose(setSort)}
            aria-label="Sort"
          >
            <option value="most">Most first</option>
            <option value="az">A–Z</option>
          </select>
        </div>
      </div>
      {loading ? (
        <p className="chats-results-note">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="chats-results-note">
          No pages recorded in this period yet. Pages are saved for messages
          sent after Sep 29.
        </p>
      ) : (
        <>
        <ol className="chats-pages-list">
          {rows.slice(0, shown).map((p) => (
            <li key={p.page}>
              <a href={pageUrl(p.page)} target="_blank" rel="noopener noreferrer">
                {pageKindLabel(p.page)} · {p.page}
              </a>
              <strong>{p[count]}</strong>
            </li>
          ))}
        </ol>
        {rows.length > shown && (
          <button
            type="button"
            className="chats-results-toggle chats-pages-more"
            onClick={() => setShown((n) => n + PAGES_SHOWN)}
          >
            Show more ({rows.length - shown} more)
          </button>
        )}
        </>
      )}
    </div>
  );
};

const Stat = ({ label, value, note }) => (
  <div className="chats-results-stat">
    <span className="chats-results-label">{label}</span>
    <strong>{value}</strong>
    {note && <span className="chats-results-sub">{note}</span>}
  </div>
);

export default ChatResults;
