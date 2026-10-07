import { useEffect, useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  Pencil,
  Search,
  Send,
  StickyNote,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "react-toastify";
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
  // Still to decide: not sent, and not put aside with "Don't send now".
  { id: "nozoho", label: "Not in Zoho", test: (p) => !p.zohoUrl && !p.skippedAt },
  { id: "zoho", label: "Sent to Zoho", test: (p) => !!p.zohoUrl },
  { id: "skipped", label: "Don't send now", test: (p) => !!p.skippedAt },
  { id: "unanswered", label: "AI didn't answer", test: (p) => p.unanswered > 0 },
  { id: "cart", label: "Has a cart", test: (p) => p.cartValue > 0 },
  { id: "ordered", label: "Ordered", test: (p) => p.ordered === true },
];

const FILTER_NOTES = {
  follow: "Left their details, but nobody has replied, it isn't in Zoho and they haven't ordered.",
  nozoho: "Not sent to Zoho yet, and not put aside with Don't send now.",
  zoho: "Sent to Zoho, as a new lead or matched to one already there, with where it is in Zoho now.",
  skipped:
    "Put aside for now. They come back to Not in Zoho if they chat again, or when a snooze runs out.",
  unanswered:
    "Asked something the AI didn't answer (it gave them the WhatsApp button instead). Worth a look.",
};

// The AI's read of how keen they are, warmest across their chats.
const INTEREST = { hot: "Hot", warm: "Warm", cold: "Cold" };
const INTEREST_RANK = { hot: 3, warm: 2, cold: 1 };

const GET = {
  name: (p) => (p.name ?? p.email ?? p.phone ?? "").toLowerCase(),
  last: (p) => p.lastAt,
  chats: (p) => p.chats,
  cart: (p) => p.cartValue,
  interest: (p) => INTEREST_RANK[p.interest] ?? 0,
};

// Zoho's "Type of client" choices, loaded once for the page.
let clientTypesPromise = null;
const useClientTypes = (api) => {
  const [types, setTypes] = useState(null);
  useEffect(() => {
    let cancelled = false;
    clientTypesPromise ??= api({ action: "lead-options" });
    clientTypesPromise.then((data) => {
      if (!data?.connected) clientTypesPromise = null; // try again next time
      if (!cancelled) setTypes(data ?? { connected: false, clientTypes: [] });
    });
    return () => {
      cancelled = true;
    };
  }, [api]);
  return types;
};

const ClientTypeSelect = ({ types, value, onChange, disabled, saved }) => {
  const choices = types?.clientTypes ?? [];
  if (types && !types.connected) {
    return <small>{types.message ?? "Zoho isn't connected yet."}</small>;
  }
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={!types || disabled}
      aria-label="Type of client"
    >
      <option value="">{types ? "Type of client" : "Loading…"}</option>
      {choices.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
      {/* A saved choice Zoho no longer lists still shows. */}
      {saved && !choices.includes(saved) && <option value={saved}>{saved}</option>}
    </select>
  );
};

// The type of client is needed when Zoho has choices for it.
const needsType = (types, clientType) =>
  (types?.clientTypes ?? []).length > 0 && !clientType;

// "Send to Zoho" in a row: just the type of client to pick. The rest comes
// from their chats (chat-admin's contact-push), with what they asked about
// as the requirement when nobody has written one.
const ZohoPush = ({ person: p, api, onDone, onCancel }) => {
  const types = useClientTypes(api);
  const [clientType, setClientType] = useState(p.clientType ?? "");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    const data = await api({
      action: "contact-push",
      conversationIds: p.chatIds,
      clientType,
    });
    setBusy(false);
    if (!data) return;
    // "New lead created" or "Matched an existing lead (same phone)…".
    toast.success(data.message ?? "Sent to Zoho", { autoClose: 7000 });
    onDone(data, clientType);
  };

  return (
    <div className="chats-contacts-push">
      <ClientTypeSelect
        types={types}
        value={clientType}
        onChange={setClientType}
        disabled={busy}
        saved={p.clientType}
      />
      <small className="chats-contacts-push-req" title="Sent as the requirement">
        {p.requirement ? "Requirement as saved" : `Requirement: ${p.topic || p.askedAbout}`}
      </small>
      <span className="chats-contacts-push-actions">
        <button
          type="button"
          className="chats-btn chats-btn-primary"
          onClick={send}
          disabled={busy || !types?.connected || needsType(types, clientType)}
          title={needsType(types, clientType) ? "Pick the type of client first" : ""}
        >
          {busy ? "Sending…" : "Send"}
        </button>
        <button type="button" className="chats-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </span>
    </div>
  );
};

// A date `days` from today, as the date picker writes it (yyyy-mm-dd).
const dayFromNow = (days) => {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
};

// "Don't send now": until they chat again, or snoozed to a date (they come
// back to Not in Zoho on it). onSkip(until) with until a yyyy-mm-dd or null.
const SkipPicker = ({ onSkip, onCancel, busy }) => {
  const [date, setDate] = useState("");
  return (
    <div className="chats-contacts-push">
      <small>Don&apos;t send now, until…</small>
      <span className="chats-contacts-skip-options">
        <button type="button" className="chats-btn" onClick={() => onSkip(null)} disabled={busy}>
          They chat again
        </button>
        <button
          type="button"
          className="chats-btn"
          onClick={() => onSkip(dayFromNow(7))}
          disabled={busy}
        >
          1 week
        </button>
        <button
          type="button"
          className="chats-btn"
          onClick={() => onSkip(dayFromNow(30))}
          disabled={busy}
        >
          1 month
        </button>
      </span>
      <span className="chats-contacts-push-actions">
        <input
          type="date"
          value={date}
          min={dayFromNow(1)}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Snooze until"
        />
        <button
          type="button"
          className="chats-btn"
          onClick={() => onSkip(date)}
          disabled={busy || !date}
        >
          Snooze
        </button>
        <button type="button" className="chats-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </span>
    </div>
  );
};

// The team's note on a person, edited in place.
const NoteEditor = ({ person: p, api, onSaved, onCancel }) => {
  const [text, setText] = useState(p.note ?? "");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const data = await api({ action: "contact-note", conversationIds: p.chatIds, note: text });
    setBusy(false);
    if (data) onSaved(data);
  };
  return (
    <div className="chats-contacts-note-edit">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Called, wants a quote by Monday…"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            save();
          }
          if (e.key === "Escape") onCancel();
        }}
      />
      <span className="chats-contacts-push-actions">
        <button type="button" className="chats-btn chats-btn-primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" className="chats-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </span>
    </div>
  );
};

// A CSV cell: quoted when it needs to be.
const cell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// `canPush`: the login may send people to Zoho from here (and put them in
// Don't send now); `canEdit`: may write notes; `onPushed` updates their
// chats in the Chats list.
const ChatContacts = ({
  api,
  bounds,
  refreshKey,
  toolbar,
  onOpenChat,
  canPush = false,
  canEdit = false,
  onPushed,
}) => {
  const [result, setResult] = useState({ key: null, data: null });
  // The row with something open under it: { id, kind: push | skip | note }.
  const [open, setOpen] = useState(null);
  const [busyRow, setBusyRow] = useState(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ by: "last", desc: true });
  // Ticked rows (conversationId), for sending or putting aside together.
  const [selected, setSelected] = useState(() => new Set());
  const [bulkType, setBulkType] = useState("");
  const [bulkSkip, setBulkSkip] = useState(false);
  // Sending several: how far along.
  const [progress, setProgress] = useState(null);
  const key = JSON.stringify({ ...bounds, refreshKey });
  const types = useClientTypes(api);

  useEffect(() => {
    let cancelled = false;
    const { refreshKey: refreshed, ...request } = JSON.parse(key);
    api({ action: "contacts", ...request, fresh: refreshed > 0 }).then((data) => {
      if (!cancelled) {
        setResult({ key, data });
        setSelected(new Set());
      }
    });
    return () => {
      cancelled = true;
    };
  }, [api, key]);

  const patchPeople = (ids, patch) =>
    setResult((prev) => ({
      ...prev,
      data: {
        ...prev.data,
        contacts: prev.data.contacts.map((p) =>
          ids.includes(p.conversationId)
            ? { ...p, ...(typeof patch === "function" ? patch(p) : patch) }
            : p,
        ),
      },
    }));

  // "Don't send now" (`until`: a snooze date, or null for "until they chat
  // again"), or back to Not in Zoho (yes = false), for one or more people.
  const skip = async (persons, yes, until = null) => {
    const ids = persons.map((p) => p.conversationId);
    setBusyRow(persons.length === 1 ? ids[0] : "bulk");
    const data = await api({
      action: "contact-skip",
      conversationIds: persons.flatMap((p) => p.chatIds ?? []),
      skip: yes,
      until,
    });
    setBusyRow(null);
    if (!data) return;
    setOpen(null);
    setBulkSkip(false);
    patchPeople(ids, {
      skippedAt: data.skippedAt,
      skippedBy: data.skippedBy,
      skippedUntil: data.skippedUntil,
    });
    setSelected(new Set());
    const who = persons.length === 1 ? "" : `${persons.length} people `;
    toast.success(
      yes
        ? `Moved ${who}to Don't send now${
            data.skippedUntil ? ` until ${formatDay(data.skippedUntil)}` : ""
          }`
        : `Moved ${who}back to Not in Zoho`,
    );
  };

  // Sent: the row shows In Zoho now, and so do their chats.
  const pushed = (person, data, clientType) => {
    setOpen(null);
    patchPeople([person.conversationId], {
      zohoUrl: data.zohoUrl,
      zohoAt: data.zohoLeadAt,
      zohoBy: data.zohoBy ?? "you",
      zohoStatus: null,
      skippedAt: null,
      clientType: clientType || person.clientType,
    });
    for (const id of person.chatIds ?? []) {
      onPushed?.(id, {
        zohoLeadId: data.zohoLeadId,
        zohoLeadAt: data.zohoLeadAt,
        zohoUrl: data.zohoUrl,
      });
    }
  };

  // Several at once, one after the other, with one type of client. Anyone
  // without a name is left for later (open the chat to add one).
  const sendSelected = async (persons) => {
    const ready = persons.filter((p) => p.hasName);
    const failed = [];
    let created = 0;
    let matched = 0;
    for (let i = 0; i < ready.length; i++) {
      setProgress({ done: i, total: ready.length });
      const p = ready[i];
      const data = await api(
        { action: "contact-push", conversationIds: p.chatIds, clientType: bulkType },
        { quiet: true },
      );
      if (!data || data.error) {
        failed.push(`${p.name}: ${data?.error ?? "something went wrong"}`);
        continue;
      }
      if (data.existing) matched++;
      else created++;
      pushed(p, data, bulkType);
    }
    setProgress(null);
    setSelected(new Set());
    const skippedNoName = persons.length - ready.length;
    const parts = [
      created && `${created} new lead${created === 1 ? "" : "s"}`,
      matched && `${matched} matched to existing leads`,
    ].filter(Boolean);
    if (parts.length) toast.success(`Sent to Zoho: ${parts.join(", ")}.`, { autoClose: 7000 });
    if (failed.length) {
      toast.error(`Not sent: ${failed.join("; ")}`, { autoClose: false });
    }
    if (skippedNoName) {
      toast.info(
        `${skippedNoName} left out: no name yet (open their chat to add one).`,
        { autoClose: 7000 },
      );
    }
  };

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
          [p.name, p.email, p.company, p.note].some((v) => v?.toLowerCase().includes(needle)) ||
          (digits.length >= 3 && p.phone?.replace(/\D/g, "").includes(digits))),
    ),
    sort,
    GET,
  );

  // Only people not in Zoho can be ticked (to send or put aside).
  const tickable = (p) => canPush && !p.zohoUrl;
  const shownTickable = shown.filter(tickable);
  const picked = shown.filter((p) => selected.has(p.conversationId) && tickable(p));
  const allTicked = shownTickable.length > 0 && picked.length === shownTickable.length;
  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected(allTicked ? new Set() : new Set(shownTickable.map((p) => p.conversationId)));

  // What's on screen (this filter and search), as a spreadsheet.
  const download = () => {
    const head = ["Name", "Company", "Phone", "Email", "From", "Chats", "First chatted",
      "Last chatted", "Asked about", "Interest", "Cart", "Ordered", "In Zoho", "Zoho status",
      "Team replied", "Note"];
    const lines = shown.map((p) =>
      [p.name, p.company, p.phone, p.email, p.from.join(" + "), p.chats,
        p.firstAt.slice(0, 10), p.lastAt.slice(0, 10), p.topic ?? p.askedAbout,
        INTEREST[p.interest] ?? "", p.cart, p.ordered ? "Yes" : "", p.zohoUrl ? "Yes" : "",
        p.zohoStatus ?? "", p.replied ? "Yes" : "", p.note ?? ""]
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

  const isOpen = (p, kind) => open?.id === p.conversationId && open.kind === kind;

  return (
    <div className="chats-stats-body">
      <div className="chats-stats-toolbar">
        {toolbar}
        <div className="chats-search chats-contacts-search">
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, number, email, company or note"
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
      {result.data?.zohoError && (
        <p className="chats-results-note chats-results-warn">{result.data.zohoError}</p>
      )}

      {picked.length > 0 && (
        <div className="chats-contacts-bulk">
          <strong>{picked.length} selected</strong>
          {progress ? (
            <span>
              Sending {progress.done + 1} of {progress.total}…
            </span>
          ) : bulkSkip ? (
            <SkipPicker
              onSkip={(until) => skip(picked, true, until)}
              onCancel={() => setBulkSkip(false)}
              busy={busyRow === "bulk"}
            />
          ) : (
            <>
              <ClientTypeSelect types={types} value={bulkType} onChange={setBulkType} />
              <button
                type="button"
                className="chats-btn chats-btn-primary"
                onClick={() => sendSelected(picked)}
                disabled={!types?.connected || needsType(types, bulkType)}
                title={needsType(types, bulkType) ? "Pick the type of client first" : ""}
              >
                <Send size={13} /> Send to Zoho
              </button>
              <button type="button" className="chats-btn" onClick={() => setBulkSkip(true)}>
                Don&apos;t send now
              </button>
              {picked.some((p) => p.skippedAt) && (
                <button
                  type="button"
                  className="chats-btn"
                  onClick={() => skip(picked.filter((p) => p.skippedAt), false)}
                >
                  <Undo2 size={13} /> Move back
                </button>
              )}
              <button type="button" className="chats-btn" onClick={() => setSelected(new Set())}>
                Clear
              </button>
            </>
          )}
        </div>
      )}

      <section className="chats-card chats-orders-card">
        <p className="chats-card-sub">
          {FILTER_NOTES[filter] ??
            "Everyone who left a phone number or email, last chatted in this period. Chats with the same number or email are one person."}
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
                  {canPush && (
                    <th className="chats-contacts-tick">
                      <input
                        type="checkbox"
                        checked={allTicked}
                        onChange={toggleAll}
                        disabled={!shownTickable.length}
                        aria-label="Select everyone not in Zoho"
                        title="Select everyone here who isn't in Zoho"
                      />
                    </th>
                  )}
                  <SortHead by="name" label="Person" sort={sort} setSort={setSort} />
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Asked about</th>
                  <SortHead by="interest" label="Interest" sort={sort} setSort={setSort} />
                  <SortHead by="chats" label="Chats" sort={sort} setSort={setSort} />
                  <SortHead by="last" label="Last chatted" sort={sort} setSort={setSort} />
                  <SortHead by="cart" label="Cart" sort={sort} setSort={setSort} />
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr
                    key={p.conversationId}
                    className={selected.has(p.conversationId) ? "chats-contacts-picked" : ""}
                  >
                    {canPush && (
                      <td className="chats-contacts-tick">
                        {tickable(p) && (
                          <input
                            type="checkbox"
                            checked={selected.has(p.conversationId)}
                            onChange={() => toggle(p.conversationId)}
                            aria-label={`Select ${p.name || "this person"}`}
                          />
                        )}
                      </td>
                    )}
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
                      {isOpen(p, "note") ? (
                        <NoteEditor
                          person={p}
                          api={api}
                          onCancel={() => setOpen(null)}
                          onSaved={(data) => {
                            setOpen(null);
                            patchPeople([p.conversationId], {
                              note: data.note,
                              noteBy: data.noteBy,
                              noteAt: data.noteAt,
                            });
                          }}
                        />
                      ) : p.note ? (
                        <small
                          className="chats-contacts-note"
                          title={[p.noteBy, p.noteAt && formatDay(p.noteAt)]
                            .filter(Boolean)
                            .join(", ")}
                        >
                          <StickyNote size={11} />
                          <span>{p.note}</span>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => setOpen({ id: p.conversationId, kind: "note" })}
                              aria-label="Edit note"
                            >
                              <Pencil size={11} />
                            </button>
                          )}
                        </small>
                      ) : (
                        canEdit && (
                          <button
                            type="button"
                            className="chats-contacts-note-add"
                            onClick={() => setOpen({ id: p.conversationId, kind: "note" })}
                          >
                            + Note
                          </button>
                        )
                      )}
                    </td>
                    <td className="chats-nowrap">
                      {p.phone ? <a href={`tel:${p.phone.replace(/\s/g, "")}`}>{p.phone}</a> : "–"}
                    </td>
                    <td>{p.email ? <a href={`mailto:${p.email}`}>{p.email}</a> : "–"}</td>
                    <td>{p.topic || p.askedAbout}</td>
                    <td>
                      {p.interest ? (
                        <span className={`chats-contacts-interest chats-warmth-${p.interest}`}>
                          {INTEREST[p.interest]}
                        </span>
                      ) : (
                        "–"
                      )}
                    </td>
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
                            title={[
                              p.zohoAt && `Sent ${formatDay(p.zohoAt)}`,
                              p.zohoBy && `by ${p.zohoBy}`,
                            ]
                              .filter(Boolean)
                              .join(" ")}
                          >
                            In Zoho{p.zohoStatus ? ` · ${p.zohoStatus}` : ""}{" "}
                            <ExternalLink size={10} />
                          </a>
                        )}
                        {p.skippedAt && (
                          <span
                            className="chats-tag"
                            title={`${formatDay(p.skippedAt)}${p.skippedBy ? `, by ${p.skippedBy}` : ""}`}
                          >
                            {p.skippedUntil
                              ? `Snoozed till ${formatDay(p.skippedUntil)}`
                              : "Not sending now"}
                          </span>
                        )}
                        {p.unanswered > 0 && (
                          <span
                            className="chats-tag chats-tag-alert"
                            title={`${p.unanswered} message${p.unanswered === 1 ? "" : "s"} the AI didn't answer`}
                          >
                            AI didn&apos;t answer{p.unanswered > 1 ? ` ×${p.unanswered}` : ""}
                          </span>
                        )}
                        {p.replied && <span className="chats-tag">Replied</span>}
                        {toFollowUp(p) && (
                          <span className="chats-tag chats-tag-alert">Follow up</span>
                        )}
                        {canPush && p.skippedAt && (
                          <button
                            type="button"
                            className="chats-tag chats-contacts-push-btn"
                            onClick={() => skip([p], false)}
                            disabled={busyRow === p.conversationId}
                            title="Back to Not in Zoho"
                          >
                            <Undo2 size={10} /> Move back
                          </button>
                        )}
                        {canPush && !p.zohoUrl && !p.skippedAt &&
                          !isOpen(p, "push") && !isOpen(p, "skip") && (
                          <>
                            <button
                              type="button"
                              className="chats-tag chats-contacts-skip-btn"
                              onClick={() => setOpen({ id: p.conversationId, kind: "skip" })}
                              title="Put them in Don't send now"
                            >
                              Don&apos;t send
                            </button>
                            <button
                              type="button"
                              className="chats-tag chats-contacts-push-btn"
                              onClick={() => setOpen({ id: p.conversationId, kind: "push" })}
                              disabled={!p.hasName}
                              title={
                                p.hasName
                                  ? "Send them to Zoho as a lead"
                                  : "No name yet: open the chat to add one"
                              }
                            >
                              <Send size={10} /> Send to Zoho
                            </button>
                          </>
                        )}
                      </span>
                      {isOpen(p, "push") && (
                        <ZohoPush
                          person={p}
                          api={api}
                          onDone={(data, clientType) => pushed(p, data, clientType)}
                          onCancel={() => setOpen(null)}
                        />
                      )}
                      {isOpen(p, "skip") && (
                        <SkipPicker
                          onSkip={(until) => skip([p], true, until)}
                          onCancel={() => setOpen(null)}
                          busy={busyRow === p.conversationId}
                        />
                      )}
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
