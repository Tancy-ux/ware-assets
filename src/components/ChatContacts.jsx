import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, Search, X } from "lucide-react";
import { SortHead } from "./chatTable";
import { formatDay, rupees, sortRows } from "./chatTableUtils";

// The Contacts section: one row per person who left a phone number or
// email (in the chat, the Ware Atelier form, or their store account).
// Chats with the same phone or email are one person. From chat-admin's
// "contacts"; only for logins with the Contacts permission.

// Nobody from the team has replied, it isn't in Zoho, and they haven't
// ordered: someone to get back to.
const toFollowUp = (p) => !p.replied && !p.zohoUrl && p.ordered !== true;

const FILTERS = [
  { id: "all", label: "All", test: () => true },
  { id: "follow", label: "To follow up", test: toFollowUp },
  { id: "nozoho", label: "Not in Zoho", test: (p) => !p.zohoUrl },
  { id: "cart", label: "Has a cart", test: (p) => p.cartValue > 0 },
  { id: "ordered", label: "Ordered", test: (p) => p.ordered === true },
];

const GET = {
  name: (p) => (p.name ?? p.email ?? p.phone ?? "").toLowerCase(),
  last: (p) => p.lastAt,
  chats: (p) => p.chats,
  cart: (p) => p.cartValue,
};

// A CSV cell: quoted when it needs to be.
const cell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const ChatContacts = ({ api, bounds, refreshKey, toolbar, onOpenChat }) => {
  const [result, setResult] = useState({ key: null, data: null });
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ by: "last", desc: true });
  const key = JSON.stringify({ ...bounds, refreshKey });

  useEffect(() => {
    let cancelled = false;
    const { refreshKey: refreshed, ...request } = JSON.parse(key);
    api({ action: "contacts", ...request, fresh: refreshed > 0 }).then((data) => {
      if (!cancelled) setResult({ key, data });
    });
    return () => {
      cancelled = true;
    };
  }, [api, key]);

  const loading = result.key !== key;
  const people = useMemo(
    () => (loading ? [] : result.data?.contacts ?? []),
    [loading, result.data],
  );
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.id, people.filter(f.test).length])),
    [people],
  );
  const needle = search.trim().toLowerCase();
  const digits = needle.replace(/\D/g, "");
  const shown = sortRows(
    people.filter(
      (p) =>
        FILTERS.find((f) => f.id === filter).test(p) &&
        (!needle ||
          [p.name, p.email, p.company].some((v) => v?.toLowerCase().includes(needle)) ||
          (digits.length >= 3 && p.phone?.replace(/\D/g, "").includes(digits))),
    ),
    sort,
    GET,
  );

  // What's on screen (this filter and search), as a spreadsheet.
  const download = () => {
    const head = ["Name", "Company", "Phone", "Email", "From", "Chats", "First chatted",
      "Last chatted", "Asked about", "Cart", "Ordered", "In Zoho", "Team replied"];
    const lines = shown.map((p) =>
      [p.name, p.company, p.phone, p.email, p.from.join(" + "), p.chats,
        p.firstAt.slice(0, 10), p.lastAt.slice(0, 10), p.topic ?? p.askedAbout,
        p.cart, p.ordered ? "Yes" : "", p.zohoUrl ? "Yes" : "", p.replied ? "Yes" : ""]
        .map(cell)
        .join(","),
    );
    // The BOM makes Excel read ₹ and names correctly.
    const blob = new Blob([`${String.fromCharCode(0xfeff)}${[head.join(","), ...lines].join("\n")}`], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `warebot-contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="chats-stats-body">
      <div className="chats-stats-toolbar">
        {toolbar}
        <div className="chats-search chats-contacts-search">
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, number, email or company"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label="Clear search">
              <X size={14} />
            </button>
          )}
        </div>
        {result.data?.canDownload && (
          <button
            type="button"
            className="chats-btn chats-contacts-download"
            onClick={download}
            disabled={!shown.length}
            title="Download these contacts as a CSV file"
          >
            <Download size={14} /> Download CSV
          </button>
        )}
      </div>

      <div className="chats-views">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`chats-view${filter === f.id ? " chats-view-active" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
            {counts[f.id] > 0 && <span>{counts[f.id]}</span>}
          </button>
        ))}
      </div>

      {result.data?.ordersError && (
        <p className="chats-results-note chats-results-warn">
          {result.data.ordersError} &quot;Ordered&quot; is left blank until then.
        </p>
      )}

      <section className="chats-card chats-orders-card">
        <p className="chats-card-sub">
          {filter === "follow"
            ? "Left their details, but nobody has replied, it isn't in Zoho and they haven't ordered."
            : "Everyone who left a phone number or email, last chatted in this period. Chats with the same number or email are one person."}
        </p>
        {loading ? (
          <p className="chats-results-note">Loading…</p>
        ) : !shown.length ? (
          <p className="chats-results-note">
            {people.length ? "Nobody matches." : "Nobody in this period."}
          </p>
        ) : (
          <div className="chats-table-scroll">
            <table className="chats-results-orders chats-contacts-table">
              <thead>
                <tr>
                  <SortHead by="name" label="Person" sort={sort} setSort={setSort} />
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Asked about</th>
                  <SortHead by="chats" label="Chats" sort={sort} setSort={setSort} />
                  <SortHead by="last" label="Last chatted" sort={sort} setSort={setSort} />
                  <SortHead by="cart" label="Cart" sort={sort} setSort={setSort} />
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.conversationId}>
                    <td>
                      <button
                        type="button"
                        className="chats-results-chat"
                        onClick={() => onOpenChat(p.conversationId)}
                        title="Open their latest chat"
                      >
                        {p.name || "No name"}
                      </button>
                      <small className="chats-contacts-sub">
                        {[p.company, p.from.join(" + ")].filter(Boolean).join(" · ")}
                      </small>
                    </td>
                    <td className="chats-nowrap">
                      {p.phone ? <a href={`tel:${p.phone.replace(/\s/g, "")}`}>{p.phone}</a> : "–"}
                    </td>
                    <td>{p.email ? <a href={`mailto:${p.email}`}>{p.email}</a> : "–"}</td>
                    <td>{p.topic || p.askedAbout}</td>
                    <td>{p.chats}</td>
                    <td className="chats-nowrap" title={`First chatted ${formatDay(p.firstAt)}`}>
                      {formatDay(p.lastAt)}
                    </td>
                    <td className="chats-nowrap">{p.cartValue > 0 ? rupees(p.cartValue) : "–"}</td>
                    <td>
                      <span className="chats-contacts-status">
                        {p.ordered && <span className="chats-tag chats-tag-lead">Ordered</span>}
                        {p.zohoUrl && (
                          <a
                            className="chats-tag"
                            href={p.zohoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            In Zoho <ExternalLink size={10} />
                          </a>
                        )}
                        {p.replied && <span className="chats-tag">Replied</span>}
                        {toFollowUp(p) && (
                          <span className="chats-tag chats-tag-alert">Follow up</span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default ChatContacts;
