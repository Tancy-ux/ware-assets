import { useEffect, useState } from "react";
import { GraduationCap } from "lucide-react";
import { SortHead } from "./chatTable";
import { formatWhen, rupees, sortRows } from "./chatTableUtils";

// Two more Stats tabs, each loaded from chat-admin when opened:
//   - Products: what the bot showed, which pages they chatted on, and what
//     was ordered after being added from a chat card.
//   - Couldn't answer: questions where the bot said it didn't know, or sent
//     them to WhatsApp without them asking for a person.

const STORE = "https://www.wareinnovations.com";
const thumb = (url) => (url ? `${url}${url.includes("?") ? "&" : "?"}width=120` : url);

// Loads `action` for the Stats date range and test-chat switch.
const useStatsData = (api, action, request) => {
  const [result, setResult] = useState({ key: null, data: null });
  const key = JSON.stringify(request);
  useEffect(() => {
    let cancelled = false;
    const { refreshKey: refreshed, ...body } = JSON.parse(key);
    api({ action, ...body, fresh: refreshed > 0 }).then((data) => {
      if (!cancelled) setResult({ key, data });
    });
    return () => {
      cancelled = true;
    };
  }, [api, action, key]);
  return result.key === key ? { loading: false, data: result.data } : { loading: true, data: null };
};

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
