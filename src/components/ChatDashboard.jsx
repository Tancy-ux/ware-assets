import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { useStatsData } from "./useStatsData";
import { rupees } from "./chatTableUtils";

// Stats → Dashboard (owner only for now): the period at a glance. Tiles
// with the change from the period before (same length), a day-by-day chart
// of one measure at a time (week by week for long ranges), when shoppers
// write by hour, and what each team member did. From chat-admin's
// "dashboard".

// `better`: which way is good news ("down" for messages the AI missed).
const TILES = [
  { id: "chats", label: "New chats" },
  { id: "realChats", label: "Real conversations", sub: "Two or more messages" },
  { id: "leads", label: "Left their details" },
  { id: "carts", label: "Had a cart", money: "cartValue" },
  { id: "orders", label: "Orders", money: "revenue" },
  { id: "zoho", label: "Sent to Zoho" },
  { id: "unanswered", label: "AI didn't answer", better: "down" },
  { id: "replies", label: "Team replies" },
];

// What the day-by-day chart can show.
const MEASURES = [
  { id: "chats", label: "Chats" },
  { id: "messages", label: "Messages" },
  { id: "leads", label: "Left details" },
  { id: "carts", label: "Had a cart" },
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

const ChatDashboard = ({ api, request }) => {
  const { loading, data } = useStatsData(api, "dashboard", request);
  const [measure, setMeasure] = useState("chats");
  const [showTable, setShowTable] = useState(false);
  const m = MEASURES.find((x) => x.id === measure);
  const fmt = (v) => (m.money ? rupees(v) : Math.round(v).toLocaleString("en-IN"));
  const series = data?.series ?? [];
  const total = series.reduce((s, r) => s + r[measure], 0);
  const busiest = data?.hours ? data.hours.indexOf(Math.max(...data.hours)) : -1;

  if (loading) return <p className="chats-results-note">Loading…</p>;
  if (!data) return <p className="chats-results-note">Couldn&apos;t load the dashboard.</p>;

  return (
    <>
      {data.ordersError && (
        <p className="chats-results-note chats-results-warn">
          {data.ordersError} Orders show as 0 until then.
        </p>
      )}

      <div className="chats-dash-tiles">
        {TILES.map((t) => (
          <section key={t.id} className="chats-card chats-dash-tile" title={t.sub}>
            <span className="chats-card-label">{t.label}</span>
            <strong className="chats-card-big">
              {data.totals[t.id].toLocaleString("en-IN")}
            </strong>
            {t.money && data.totals[t.money] > 0 && (
              <span className="chats-dash-money">{rupees(data.totals[t.money])}</span>
            )}
            <Delta now={data.totals[t.id]} before={data.before?.[t.id]} better={t.better} />
          </section>
        ))}
      </div>
      <p className="chats-results-note chats-dash-note">
        {data.before
          ? "Compared with the period just before, of the same length."
          : "Pick a date range to compare with the period before it."}{" "}
        Counts chats that started in the period; orders are from people who
        chatted, from the same browser.
      </p>

      <section className="chats-card">
        <h3>
          {m.label} {data.weekly ? "by week" : "by day"}
          <span>
            {" "}
            · {fmt(total)} in this period
          </span>
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
        <button
          type="button"
          className="chats-card-link"
          onClick={() => setShowTable((v) => !v)}
        >
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
                {data.team.map((t) => (
                  <tr key={t.name}>
                    <td>{t.name}</td>
                    <td>{t.replies}</td>
                    <td>{t.chats}</td>
                    <td>{t.zoho}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
};

export default ChatDashboard;
