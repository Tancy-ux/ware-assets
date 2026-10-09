import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, ExternalLink, Minus } from "lucide-react";
import { useStatsData } from "./useStatsData";
import { formatWhen, rupees } from "./chatTableUtils";
import { pageKind, pageKindLabel, pageLabel, pageUrl } from "../lib/storePages";

// Stats → Overview: the period at a glance, top to bottom. Four headline
// numbers with the change from the period before (same length), each with
// the figures that belong to it; one day-by-day chart (week by week for
// long ranges); the orders; where chats start and what people ask about;
// when shoppers write and (owner only) what each team member did. Numbers
// from chat-admin's "dashboard", lists from "results". Carts, Journeys,
// Products, Couldn't answer and AI cost have their own tabs.

// What the day-by-day chart can show.
const MEASURES = [
  { id: "chats", label: "Chats" },
  { id: "leads", label: "Left details" },
  { id: "orders", label: "Orders" },
  { id: "revenue", label: "Order value", money: true },
  { id: "unanswered", label: "AI didn't answer" },
];

const dayLabel = (day, weekly) => {
  const d = new Date(`${day}T00:00:00Z`);
  const text = d.toLocaleDateString([], { day: "numeric", month: "short", timeZone: "UTC" });
  return weekly ? `Week of ${text}` : text;
};
const hourLabel = (h) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;

// A round top for the y-axis: 1, 2, 5, 10, 20, 50…
const niceMax = (n) => {
  if (n <= 4) return Math.max(n, 1);
  const step = 10 ** Math.floor(Math.log10(n));
  return [1, 2, 5, 10].map((m) => m * step).find((v) => v >= n);
};

const Delta = ({ now, before, better = "up" }) => {
  if (before == null) return null;
  if (now === before) {
    return (
      <span className="chats-dash-delta">
        <Minus size={13} /> Same as before
      </span>
    );
  }
  const up = now > before;
  const good = up === (better === "up");
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const change = before ? `${Math.round((Math.abs(now - before) / before) * 100)}%` : "new";
  return (
    <span className={`chats-dash-delta ${good ? "chats-dash-good" : "chats-dash-bad"}`}>
      <Icon size={13} />
      {change} {up ? "up" : "down"}
      <span className="chats-dash-before"> (was {before})</span>
    </span>
  );
};

// One series of bars with a hover tooltip, a recessive grid and a few
// x labels: about seven, or whichever ones xLabel gives when `allLabels`.
const Bars = ({ rows, value, label, format, xLabel, ariaLabel, allLabels = false }) => {
  const [hover, setHover] = useState(null);
  const max = niceMax(Math.max(0, ...rows.map(value)));
  const every = allLabels ? 1 : Math.max(1, Math.ceil(rows.length / 7));
  return (
    <div className="chats-dash-chart" role="img" aria-label={ariaLabel}>
      {/* Each label centred on its grid line. */}
      <div className="chats-dash-yaxis" aria-hidden="true">
        <span style={{ top: "0%" }}>{format(max)}</span>
        <span style={{ top: "50%" }}>{format(max / 2)}</span>
        <span style={{ top: "100%" }}>0</span>
      </div>
      <div className="chats-dash-plot" onMouseLeave={() => setHover(null)}>
        <div className="chats-dash-grid" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="chats-dash-bars" style={{ "--n": rows.length }}>
          {rows.map((r, i) => {
            const v = value(r);
            return (
              <div
                key={i}
                className={`chats-dash-col${hover === i ? " chats-dash-col-on" : ""}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`${label(r)}: ${format(v)}`}
              >
                <span className="chats-dash-bar" style={{ height: `${(v / max) * 100}%` }} />
                {hover === i && (
                  <span
                    className={`chats-dash-tip${
                      i > rows.length * 0.66 ? " chats-dash-tip-left" : ""
                    }`}
                  >
                    <small>{label(r)}</small>
                    <strong>{format(v)}</strong>
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div className="chats-dash-xaxis" style={{ "--n": rows.length }} aria-hidden="true">
          {rows.map((r, i) => (
            <span key={i}>
              {i % every === 0 || i === rows.length - 1 ? xLabel(r, i) : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

// Stats → Overview. `results` is chat-admin's "results" (loaded by
// ChatResults for every tab): the orders list, pages and topics.
const ChatDashboard = ({ api, request, results, resultsLoading, onOpenChat, onShowGaps }) => {
  const { loading, data } = useStatsData(api, "dashboard", request);
  const [measure, setMeasure] = useState("chats");
  const [showTable, setShowTable] = useState(false);
  const [showOrders, setShowOrders] = useState(false);
  const m = MEASURES.find((x) => x.id === measure);
  const fmt = (v) => (m.money ? rupees(v) : Math.round(v).toLocaleString("en-IN"));
  const series = data?.series ?? [];
  const total = series.reduce((s, r) => s + r[measure], 0);
  const busiest = data?.hours ? data.hours.indexOf(Math.max(...data.hours)) : -1;

  if (loading) return <p className="chats-results-note">Loading…</p>;
  if (!data) return <p className="chats-results-note">Couldn&apos;t load the overview.</p>;

  const t = data.totals;
  const orderList = results?.list ?? [];
  // The four headline numbers; each folds in the figures that belong to it.
  const tiles = [
    {
      id: "chats",
      label: "Chats",
      sub: `${t.realChats} real conversation${t.realChats === 1 ? "" : "s"} (2+ messages)`,
    },
    {
      id: "leads",
      label: "Left their details",
      sub: t.zoho ? `${t.zoho} sent to Zoho` : "None sent to Zoho yet",
    },
    {
      id: "orders",
      label: "Orders from chats",
      sub: [
        t.revenue > 0 && rupees(t.revenue),
        results?.fromChatOrders > 0 && `${rupees(results.fromChatRevenue)} added from chat cards`,
      ]
        .filter(Boolean)
        .join(" · "),
      action: orderList.length > 0 && {
        label: showOrders ? "Hide orders" : "See orders",
        onClick: () => setShowOrders((v) => !v),
      },
    },
    {
      id: "unanswered",
      label: "AI didn't answer",
      better: "down",
      action: t.unanswered > 0 && { label: "See the questions", onClick: onShowGaps },
    },
  ];

  return (
    <>
      {data.ordersError && (
        <p className="chats-results-note chats-results-warn">
          {data.ordersError} Orders show as 0 until then.
        </p>
      )}

      <div className="chats-dash-tiles">
        {tiles.map((tile) => (
          <section key={tile.id} className="chats-card chats-dash-tile">
            <span className="chats-card-label">{tile.label}</span>
            <strong className="chats-card-big">{t[tile.id].toLocaleString("en-IN")}</strong>
            {tile.sub && <span className="chats-dash-money">{tile.sub}</span>}
            <Delta now={t[tile.id]} before={data.before?.[tile.id]} better={tile.better} />
            {tile.action && (
              <button type="button" className="chats-card-link" onClick={tile.action.onClick}>
                {tile.action.label}
              </button>
            )}
          </section>
        ))}
      </div>

      {showOrders && orderList.length > 0 && (
        <OrdersTable orders={orderList} onOpenChat={onOpenChat} />
      )}

      <section className="chats-card">
        <h3>
          {m.label} {data.weekly ? "by week" : "by day"}
          <span> · {fmt(total)} in this period</span>
        </h3>
        <div className="chats-views chats-dash-measures" role="tablist">
          {MEASURES.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={measure === x.id}
              className={`chats-view${measure === x.id ? " chats-view-active" : ""}`}
              onClick={() => setMeasure(x.id)}
            >
              {x.label}
            </button>
          ))}
        </div>
        {series.length ? (
          <Bars
            rows={series}
            value={(r) => r[measure]}
            label={(r) => dayLabel(r.day, data.weekly)}
            format={fmt}
            xLabel={(r) => dayLabel(r.day, false)}
            ariaLabel={`${m.label} ${data.weekly ? "by week" : "by day"}`}
          />
        ) : (
          <p className="chats-results-note">Nothing in this period.</p>
        )}
        <button type="button" className="chats-card-link" onClick={() => setShowTable((v) => !v)}>
          {showTable ? "Hide the numbers" : "See the numbers"}
        </button>
        {showTable && (
          <div className="chats-table-scroll">
            <table className="chats-results-orders chats-dash-table">
              <thead>
                <tr>
                  <th>{data.weekly ? "Week of" : "Day"}</th>
                  {MEASURES.map((x) => (
                    <th key={x.id}>{x.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...series].reverse().map((r) => (
                  <tr key={r.day}>
                    <td className="chats-nowrap">{dayLabel(r.day, false)}</td>
                    {MEASURES.map((x) => (
                      <td key={x.id}>{x.money ? (r[x.id] ? rupees(r[x.id]) : "–") : r[x.id] || "–"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="chats-stats-pair chats-stats-pair-wide">
        <ChatPages pages={results?.pages} loading={resultsLoading} />
        <section className="chats-card">
          <h3>What people ask about</h3>
          {resultsLoading ? (
            <p className="chats-results-note">Loading…</p>
          ) : !results?.askedAbout?.length ? (
            <p className="chats-results-note">No chats in this period.</p>
          ) : (
            <ul className="chats-asks">
              {results.askedAbout.map((a) => (
                <li key={a.label}>
                  <span>{a.label}</span>
                  <strong>{a.chats}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className={`chats-stats-pair${data.team ? " chats-stats-pair-wide" : ""}`}>
        <section className="chats-card">
          <h3>
            When shoppers write
            <span>
              {" "}
              · messages by hour (India time)
              {busiest >= 0 && data.hours[busiest] > 0 && `, busiest ${hourLabel(busiest)}`}
            </span>
          </h3>
          <Bars
            rows={data.hours.map((n, h) => ({ h, n }))}
            value={(r) => r.n}
            label={(r) => `${hourLabel(r.h)}–${hourLabel((r.h + 1) % 24)}`}
            format={(v) => Math.round(v).toLocaleString("en-IN")}
            xLabel={(r) => (r.h % 6 === 0 ? hourLabel(r.h) : "")}
            allLabels
            ariaLabel="Shopper messages by hour of the day"
          />
        </section>

        {/* Owner only (the server leaves it out for everyone else). */}
        {data.team && (
          <section className="chats-card">
            <h3>
              The team
              <span> · in this period</span>
            </h3>
            {!data.team.length ? (
              <p className="chats-results-note">No replies or Zoho leads from the team yet.</p>
            ) : (
              <table className="chats-results-orders">
                <thead>
                  <tr>
                    <th>Who</th>
                    <th>Replies</th>
                    <th>Chats</th>
                    <th>Sent to Zoho</th>
                  </tr>
                </thead>
                <tbody>
                  {data.team.map((m) => (
                    <tr key={m.name}>
                      <td>{m.name}</td>
                      <td>{m.replies}</td>
                      <td>{m.chats}</td>
                      <td>{m.zoho}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>

      <p className="chats-results-note chats-stats-foot">
        {data.before
          ? "Changes are against the period just before, of the same length. "
          : "Pick a date range to see the change from the period before. "}
        Orders are from the same browser they chatted on (cancelled ones
        don&apos;t count); calls and WhatsApp orders aren&apos;t included.
        {results?.trackingFrom &&
          ` Orders counted from ${new Date(results.trackingFrom).toLocaleDateString([], {
            day: "numeric",
            month: "short",
          })}.`}
      </p>
    </>
  );
};

// The orders behind "Orders from chats", newest first.
const OrdersTable = ({ orders, onOpenChat }) => (
  <section className="chats-card chats-orders-card">
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
        {orders.map((o) => (
          <tr key={o.id} className={o.cancelled ? "chats-results-cancelled" : ""}>
            <td>
              <a href={o.adminUrl} target="_blank" rel="noopener noreferrer">
                {o.name}
                <ExternalLink size={11} />
              </a>
              {o.cancelled && " (cancelled)"}
            </td>
            <td>{formatWhen(o.createdAt)}</td>
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
              ) : o.visitorId ? (
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
);

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
// Shopify's image CDN resizes on request.
const thumb = (url) => (url ? `${url}${url.includes("?") ? "&" : "?"}width=120` : url);

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
        <p className="chats-results-note">No pages recorded in this period.</p>
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
            <button type="button" className="chats-card-link" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show top 6" : `Show all ${rows.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
};

export default ChatDashboard;
