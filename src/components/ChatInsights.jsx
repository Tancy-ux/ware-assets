import { Fragment, useState } from "react";
import { ArrowRight, ChevronDown, ChevronUp, GraduationCap } from "lucide-react";
import { SortHead } from "./chatTable";
import { useStatsData } from "./useStatsData";
import { formatDay, formatWhen, rupees, sortRows } from "./chatTableUtils";
import { pageLabel, pageUrl } from "../lib/storePages";

// Two more Stats tabs, each loaded from chat-admin when opened:
//   - Products: what the bot showed, which pages they chatted on, and what
//     was ordered after being added from a chat card.
//   - Couldn't answer: questions where the bot said it didn't know, or sent
//     them to WhatsApp without them asking for a person.
//   - Journeys: where people went after tapping the chat button, and
//     whether they got to the cart and checkout.

const STORE = "https://www.wareinnovations.com";
const thumb = (url) => (url ? `${url}${url.includes("?") ? "&" : "?"}width=120` : url);

const PRODUCT_GET = {
  title: (p) => p.title.toLowerCase(),
  shown: (p) => p.shown,
  onPage: (p) => p.onPage,
  ordered: (p) => p.orderedValue,
};

export const ChatProducts = ({ api, request }) => {
  const { loading, data } = useStatsData(api, "products", request);
  const [sort, setSort] = useState({ by: "shown", desc: true });
  const rows = sortRows(data?.products ?? [], sort, PRODUCT_GET);
  const head = (by, label) => <SortHead by={by} label={label} sort={sort} setSort={setSort} />;

  return (
    <section className="chats-card chats-orders-card">
      <p className="chats-card-sub">
        Each product&apos;s chats in this period: how many times the bot showed
        it, how many people chatted while on its page, and what was ordered
        after being added from a product card in the chat.
      </p>
      {data?.ordersError && (
        <p className="chats-results-note chats-results-warn">{data.ordersError}</p>
      )}
      {loading ? (
        <p className="chats-results-note">Loading…</p>
      ) : !rows.length ? (
        <p className="chats-results-note">No products in this period.</p>
      ) : (
        <div className="chats-table-scroll">
          <table className="chats-results-orders chats-products-table">
            <thead>
              <tr>
                {head("title", "Product")}
                {head("shown", "Bot showed it")}
                {head("onPage", "Chatted on its page")}
                {head("ordered", "Ordered from chat")}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.handle ?? p.title}>
                  <td>
                    <span className="chats-product-cell">
                      <span className="chats-start-img">
                        {p.image && <img src={thumb(p.image)} alt="" loading="lazy" />}
                      </span>
                      <span>
                        {p.handle ? (
                          <a
                            href={`${STORE}/products/${p.handle}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {p.title}
                          </a>
                        ) : (
                          p.title
                        )}
                        {p.price && <small>{p.price}</small>}
                      </span>
                    </span>
                  </td>
                  <td>{p.shown ? `${p.shown} chat${p.shown === 1 ? "" : "s"}` : "–"}</td>
                  <td>{p.onPage ? `${p.onPage} chat${p.onPage === 1 ? "" : "s"}` : "–"}</td>
                  <td>
                    {p.ordered
                      ? `${p.ordered} pc${p.ordered === 1 ? "" : "s"} · ${rupees(p.orderedValue)}`
                      : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export const ChatGaps = ({ api, request, onOpenChat, onTeach }) => {
  const { loading, data } = useStatsData(api, "gaps", request);
  const gaps = data?.gaps ?? [];

  return (
    <section className="chats-card chats-orders-card">
      <p className="chats-card-sub">
        Questions where the bot said it didn&apos;t know, or sent them to
        WhatsApp without them asking for a person. The same question asked
        again is one row.
        {data?.canTeach && " Teach the bot turns one into an instruction on the Bot page."}
      </p>
      {loading ? (
        <p className="chats-results-note">Loading…</p>
      ) : !gaps.length ? (
        <p className="chats-results-note">Nothing in this period. 🎉</p>
      ) : (
        <ul className="chats-gaps">
          {gaps.map((g) => (
            <li key={`${g.conversationId}-${g.lastAt}`}>
              <div className="chats-gap-head">
                <strong>{g.question}</strong>
                <span className={`chats-tag${g.why === "Didn't know" ? " chats-tag-alert" : ""}`}>
                  {g.why}
                </span>
              </div>
              <p className="chats-gap-answer">{g.answer}</p>
              <div className="chats-gap-foot">
                <small>
                  {formatWhen(g.lastAt)}
                  {g.count > 1 && ` · asked ${g.count} times`}
                  {g.chats > 1 && ` in ${g.chats} chats`}
                </small>
                <button
                  type="button"
                  className="chats-results-chat"
                  onClick={() => onOpenChat(g.conversationId)}
                >
                  Open chat
                </button>
                {data.canTeach && (
                  <button
                    type="button"
                    className="chats-btn chats-gap-teach"
                    onClick={() => onTeach(`When someone asks "${g.question}", `)}
                  >
                    <GraduationCap size={14} /> Teach the bot
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

// Stats → AI cost (owner only): what the AI (Gemini) cost, from chat-admin's
// "ai-costs". Real customers apart from tests / internal chats and the
// team's own AI tools (AI reply, Draft from chat, Bot Try, Improve AI).
const COST_GROUPS = [
  { id: "customers", label: "Real customers", sub: "Shoppers' typed questions" },
  { id: "tests", label: "Tests & internal", sub: "Test-named and internal chats" },
  { id: "team", label: "Team tools", sub: "AI reply, Draft from chat, Bot Try, Improve AI" },
];
const inr = (n) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n < 10 ? 2 : 0, maximumFractionDigits: n < 10 ? 2 : 0 })}`;

export const ChatAiCost = ({ api, request }) => {
  const { loading, data } = useStatsData(api, "ai-costs", request);
  if (loading) return <p className="chats-results-note">Loading…</p>;
  if (data?.missingTable) {
    return (
      <p className="chats-results-note chats-results-warn">
        Run scripts/supabase-ai-costs.sql in Supabase → SQL Editor to start
        tracking the AI&apos;s cost.
      </p>
    );
  }
  if (!data) return null;
  const monthTotal = COST_GROUPS.reduce((sum, g) => sum + data.month[g.id].rupees, 0);
  const perReply = data.range.customers.calls
    ? data.range.customers.rupees / data.range.customers.calls
    : null;
  return (
    <section className="chats-card">
      <h3>
        AI cost
        <span> · in this period</span>
      </h3>
      <div className="chats-funnel">
        {COST_GROUPS.map((g) => (
          <div
            key={g.id}
            className={`chats-funnel-step${g.id === "customers" ? " chats-funnel-good" : ""}`}
            title={g.sub}
          >
            <span className="chats-funnel-label">{g.label}</span>
            <strong>{inr(data.range[g.id].rupees)}</strong>
            <span className="chats-funnel-sub">
              {data.range[g.id].calls} AI {data.range[g.id].calls === 1 ? "call" : "calls"}
            </span>
          </div>
        ))}
      </div>
      <p className="chats-card-sub chats-cost-notes">
        {perReply != null && <>About {inr(perReply)} per customer reply. </>}
        This month so far: {inr(monthTotal)} of the {inr(data.monthCap)} cap
        ({Math.round((monthTotal / data.monthCap) * 100)}%).
        {data.trackedSince && <> Counted since {formatWhen(data.trackedSince)}.</>}{" "}
        Estimated from Gemini&apos;s token prices at ₹{data.usdToInr} to the dollar;
        Google AI Studio&apos;s billing has the exact amount.
      </p>
    </section>
  );
};

// Stats -> Journeys, from chat-admin's "journeys" (the store chat records
// pages only for people who tapped its button; widget/src/track.js).
const percent = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : "–");
const formatTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const WHO = [
  { id: "all", label: "Everyone" },
  { id: "chatted", label: "Chatted" },
  { id: "tappedOnly", label: "Didn't chat" },
];

// One step of their journey, as a line of the timeline.
const JourneyStep = ({ e }) => {
  const page = e.page && (
    <a href={pageUrl(e.page)} target="_blank" rel="noopener noreferrer">
      {pageLabel(e.page)}
    </a>
  );
  if (e.kind === "open") return <>Tapped the chat button{page && <> on {page}</>}</>;
  if (e.kind === "cart") {
    return (
      <strong>
        Added to cart
        {e.items != null && ` (${e.items} item${e.items === 1 ? "" : "s"} in cart)`}
      </strong>
    );
  }
  if (e.kind === "checkout") return <strong>Tapped checkout{page && <> on {page}</>}</strong>;
  return page;
};

const Journey = ({ events }) => (
  <ol className="chats-journey">
    {events.map((e, i) => (
      <Fragment key={i}>
        {(i === 0 || formatDay(e.at) !== formatDay(events[i - 1].at)) && (
          <li className="chats-journey-day">{formatDay(e.at)}</li>
        )}
        <li className={`chats-journey-step chats-journey-${e.kind}`}>
          <time>{formatTime(e.at)}</time>
          <span>
            <JourneyStep e={e} />
          </span>
        </li>
      </Fragment>
    ))}
  </ol>
);

export const ChatJourneys = ({ api, request, onOpenChat }) => {
  const { loading, data } = useStatsData(api, "journeys", request);
  const [who, setWho] = useState("all");
  const [openId, setOpenId] = useState(null);

  if (loading) return <p className="chats-results-note">Loading…</p>;
  if (data?.missingTable) {
    return (
      <p className="chats-results-note chats-results-warn">
        Run scripts/supabase-chat-visits.sql in Supabase → SQL Editor to start
        recording journeys.
      </p>
    );
  }
  if (!data) return null;

  const { chatted, tappedOnly } = data.groups;
  const all = {
    people: chatted.people + tappedOnly.people,
    cart: chatted.cart + tappedOnly.cart,
    checkout: chatted.checkout + tappedOnly.checkout,
  };
  const steps = [
    { label: "Tapped the chat button", n: all.people },
    {
      label: "Got to the cart",
      n: all.cart,
      title: "Added something, opened the cart, or had items in it",
    },
    { label: "Tapped checkout", n: all.checkout },
  ];
  const people = data.people.filter(
    (p) => who === "all" || (who === "chatted") === !!p.conversationId,
  );

  return (
    <>
      <section className="chats-card">
        <h3>
          After tapping the chat button
          <span> · how many people get to each step</span>
        </h3>
        <div className="chats-funnel">
          {steps.map((s, i) => (
            <Fragment key={s.label}>
              {i > 0 && (
                <span className="chats-funnel-arrow" aria-hidden="true">
                  <ArrowRight size={16} />
                </span>
              )}
              <div
                className={`chats-funnel-step${i === 2 && s.n > 0 ? " chats-funnel-good" : ""}`}
                title={s.title}
              >
                <span className="chats-funnel-label">{s.label}</span>
                <strong>{s.n}</strong>
                {i > 0 && (
                  <span className="chats-funnel-sub">{percent(s.n, all.people)} of them</span>
                )}
              </div>
            </Fragment>
          ))}
        </div>
        <div className="chats-table-scroll">
          <table className="chats-results-orders chats-journey-compare">
            <thead>
              <tr>
                <th />
                <th>People</th>
                <th>Got to the cart</th>
                <th>Tapped checkout</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Tapped and chatted", chatted],
                ["Tapped but didn't chat", tappedOnly],
              ].map(([label, g]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td>{g.people}</td>
                  <td>
                    {g.cart} <small>({percent(g.cart, g.people)})</small>
                  </td>
                  <td>
                    {g.checkout} <small>({percent(g.checkout, g.people)})</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="chats-card chats-orders-card">
        <h3>
          Each person&apos;s journey
          <span> · newest first, tap a row to see the pages</span>
        </h3>
        <div className="chats-views chats-page-filters">
          {WHO.map((w) => (
            <button
              key={w.id}
              type="button"
              className={`chats-view${who === w.id ? " chats-view-active" : ""}`}
              onClick={() => setWho(w.id)}
            >
              {w.label}
            </button>
          ))}
        </div>
        {!people.length ? (
          <p className="chats-results-note">Nobody in this period.</p>
        ) : (
          <div className="chats-table-scroll">
            <table className="chats-results-orders">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Pages</th>
                  <th>Cart</th>
                  <th>Checkout</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const shown = openId === p.visitorId;
                  const Chevron = shown ? ChevronUp : ChevronDown;
                  return (
                    <Fragment key={p.visitorId}>
                      <tr
                        className="chats-journey-row"
                        onClick={() => setOpenId(shown ? null : p.visitorId)}
                      >
                        <td>
                          <button
                            type="button"
                            className="chats-journey-toggle"
                            aria-expanded={shown}
                          >
                            <Chevron size={14} />
                            {p.title ?? "Didn't chat"}
                          </button>{" "}
                          <span className="chats-carts-tag">#{p.visitorId.slice(0, 6)}</span>
                          {p.device && <small className="chats-journey-device">{p.device}</small>}
                        </td>
                        <td>{p.pages}</td>
                        <td>
                          {p.cart ? (
                            <span className="chats-tag chats-tag-lead">
                              Yes{p.cartValue ? ` · ${rupees(p.cartValue)}` : ""}
                            </span>
                          ) : (
                            "–"
                          )}
                        </td>
                        <td>
                          {p.checkout ? <span className="chats-tag chats-tag-lead">Yes</span> : "–"}
                        </td>
                        <td className="chats-nowrap">{formatWhen(p.lastAt)}</td>
                      </tr>
                      {shown && (
                        <tr className="chats-journey-detail">
                          <td colSpan={5}>
                            <Journey events={p.events} />
                            {p.conversationId && (
                              <button
                                type="button"
                                className="chats-results-chat"
                                onClick={() => onOpenChat(p.conversationId)}
                              >
                                Open their chat
                              </button>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="chats-results-note">
          {data.total > data.people.length &&
            `Showing the latest ${data.people.length} of ${data.total}. `}
          Recorded only for people who tapped the chat button, for 30 days
          after their last tap, on the browser they tapped it on. Checkout
          means they tapped a checkout or Buy it now button; Stats → Overview
          has the orders.
        </p>
      </section>
    </>
  );
};
