import { useMemo } from "react";
import { useStatsData } from "./useStatsData";
import { rupees } from "./chatTableUtils";
import { openCartsOf } from "../lib/carts";

// The Today page, where the admin opens: what needs us right now, each
// number a way in (the chats waiting, today's chats, open carts, what the
// bot couldn't answer this week), and the chats waiting on us. Test and
// junk chats are left out.

const DAY_MS = 24 * 60 * 60 * 1000;
const LIST_SHOWN = 5;

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

// What each number asks chat-admin for: since midnight, the last 7 days
// and the last 30.
const requestsFor = (refreshKey) => {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const daysAgo = (n) => new Date(Date.now() - n * DAY_MS).toISOString();
  return {
    todayReq: { since: midnight.toISOString(), refreshKey },
    weekReq: { since: daysAgo(7), refreshKey },
    cartsReq: { since: daysAgo(30), refreshKey },
  };
};

// A tile: the number, a line under it, and the whole tile taps through
// (unless there's nowhere for this login to go).
const Tile = ({ label, value, sub, onClick, alert = false }) => (
  <button
    type="button"
    className={`chats-card chats-dash-tile chats-today-tile${alert ? " chats-today-tile-alert" : ""}`}
    onClick={onClick}
    disabled={!onClick}
  >
    <span className="chats-card-label">{label}</span>
    <strong className="chats-card-big">{value ?? "…"}</strong>
    {sub && <span className="chats-dash-money">{sub}</span>}
  </button>
);

// waiting: the chats that need a reply, newest first ({ id, title,
// preview, ago }). go: { needs, today, carts, gaps } to open each page.
const ChatToday = ({ api, me, canStats, canCarts, waiting, onOpenChat, go, refreshKey = 0 }) => {
  // Fixed once per visit (and Refresh), so they don't reload every render.
  const { todayReq, weekReq, cartsReq } = useMemo(() => requestsFor(refreshKey), [refreshKey]);
  // A login without the permission asks for nothing (null).
  const noop = useMemo(() => async () => null, []);
  const today = useStatsData(canStats ? api : noop, "dashboard", todayReq);
  const week = useStatsData(canStats ? api : noop, "dashboard", weekReq);
  const quietApi = useMemo(() => (body) => api(body, { quiet: true }), [api]);
  const results = useStatsData(canCarts ? quietApi : noop, "results", cartsReq);

  const t = today.data?.totals;
  const unanswered = week.data?.totals?.unanswered;
  const open = openCartsOf(results.data?.carts);
  const openValue = open.reduce((s, c) => s + (c.value ?? 0), 0);

  return (
    <div className="chats-stats-body">
      <p className="chats-today-hello">
        {greeting()}
        {me?.name ? `, ${me.name.split(" ")[0]}` : ""}.{" "}
        <span>
          {waiting.length
            ? `${waiting.length} chat${waiting.length === 1 ? " is" : "s are"} waiting on us.`
            : "Nothing is waiting on us."}
        </span>
      </p>

      <div className="chats-dash-tiles">
        <Tile
          label="Needs reply"
          value={waiting.length}
          sub={waiting.length ? "Waiting on us" : "All caught up"}
          alert={waiting.length > 0}
          onClick={go.needs}
        />
        {canStats && (
          <Tile
            label="Chats today"
            value={today.loading ? null : (t?.chats ?? 0)}
            sub={
              t
                ? [
                    `${t.leads} lead${t.leads === 1 ? "" : "s"}`,
                    t.whatsapp > 0 && `${t.whatsapp} went to WhatsApp`,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : null
            }
            onClick={go.today}
          />
        )}
        {canCarts && (
          <Tile
            label="Open carts"
            value={results.loading ? null : rupees(openValue)}
            sub={results.loading ? null : `${open.length} cart${open.length === 1 ? "" : "s"}, last 30 days`}
            // The carts summary is on Stats → Overview.
            onClick={canStats ? go.carts : undefined}
          />
        )}
        {canStats && (
          <Tile
            label="Couldn't answer"
            value={week.loading ? null : (unanswered ?? 0)}
            sub="Questions this week"
            onClick={go.gaps}
          />
        )}
      </div>

      <section className="chats-card">
        <h3>
          Waiting on us
          <span> · newest first</span>
        </h3>
        {!waiting.length ? (
          <p className="chats-results-note">No chats need a reply.</p>
        ) : (
          <ul className="chats-today-list">
            {waiting.slice(0, LIST_SHOWN).map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onOpenChat(c.id)}>
                  <strong>{c.title}</strong>
                  <small>{c.ago}</small>
                  {c.preview && <span>{c.preview}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
        {waiting.length > LIST_SHOWN && (
          <button type="button" className="chats-card-link" onClick={go.needs}>
            See all {waiting.length}
          </button>
        )}
      </section>
    </div>
  );
};

export default ChatToday;
