import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, Sparkles } from "lucide-react";
import { toast } from "react-toastify";

// The open chat's "Lead" card on the Chats page: the details for a Zoho CRM
// lead (name, phone or email, what they want, type of client), filled from
// the chat and editable. Nothing is sent until "Send to Zoho" is clicked,
// which needs a name, a phone or email and a requirement. If Zoho already
// has a lead with that phone or email, only its empty fields are filled
// (chat-admin's lead-push); otherwise a new lead is created.

// `contactSaved`: a phone or email is saved but this login can't see it.
const missingFor = (lead, contactSaved = false) => {
  const missing = [];
  if (!lead.name.trim()) missing.push("name");
  if (!contactSaved && !lead.phone.trim() && !lead.email.trim()) {
    missing.push("phone or email");
  }
  if (!lead.requirement.trim()) missing.push("requirement");
  return missing;
};

// Zoho's "Type of client" choices, loaded once for the page.
let optionsPromise = null;

// The side panel's contact details too: Save keeps them in the admin
// only; Send to Zoho is the separate push. `open` / `onOpenChange` are the
// panel's (open when a chat opens). What the login may do (checked on the
// server too): canEdit (fields, Save), canDraft ("Draft from chat", with
// canEdit), canPush (Send to Zoho),
// canSeeContacts (phone and email; hidden otherwise).
const LeadCard = ({
  conversation: c,
  api,
  onUpdated,
  open,
  onOpenChange,
  canEdit = true,
  canPush = true,
  canDraft = true,
  canSeeContacts = true,
}) => {
  const [lead, setLead] = useState(() => ({
    name: c.visitorName ?? "",
    // A logged-in customer's account details fill in when the chat has none.
    phone: c.visitorPhone ?? c.accountPhone ?? "",
    email: c.visitorEmail ?? c.accountEmail ?? "",
    requirement: c.requirement ?? "",
    products: c.leadProducts ?? "",
    clientType: c.clientType ?? "",
  }));
  const [dirty, setDirty] = useState(false);

  // Details that arrive while the chat is open (the live list picks up a
  // name or number they've just given) fill the fields still empty; what
  // the team has typed is never replaced.
  const fromChat = {
    name: c.visitorName ?? "",
    // A logged-in customer's account details fill in when the chat has none.
    phone: c.visitorPhone ?? c.accountPhone ?? "",
    email: c.visitorEmail ?? c.accountEmail ?? "",
  };
  const [seen, setSeen] = useState(fromChat);
  if (
    seen.name !== fromChat.name ||
    seen.phone !== fromChat.phone ||
    seen.email !== fromChat.email
  ) {
    setSeen(fromChat);
    setLead((prev) => ({
      ...prev,
      name: prev.name.trim() ? prev.name : fromChat.name,
      phone: prev.phone.trim() ? prev.phone : fromChat.phone,
      email: prev.email.trim() ? prev.email : fromChat.email,
    }));
  }
  const [busy, setBusy] = useState(null); // draft | save | push
  const [options, setOptions] = useState(null);

  const missing = missingFor(lead, !canSeeContacts && !!c.hasContact);
  const inZoho = !!c.zohoLeadId;

  const toggle = () => onOpenChange(!open);

  useEffect(() => {
    if (!open || options || (!canEdit && !canPush)) return;
    let cancelled = false;
    optionsPromise ??= api({ action: "lead-options" });
    optionsPromise.then((data) => {
      if (!data?.connected) optionsPromise = null; // try again next time
      if (!cancelled) setOptions(data ?? { connected: false, clientTypes: [] });
    });
    return () => {
      cancelled = true;
    };
  }, [open, options, api, canEdit, canPush]);

  const change = (key) => (e) => {
    setLead((prev) => ({ ...prev, [key]: e.target.value }));
    setDirty(true);
  };

  const patchFromLead = (l) => ({
    visitorName: l.name.trim() || null,
    visitorPhone: l.phone.trim() || null,
    visitorEmail: l.email.trim() || null,
    requirement: l.requirement.trim() || null,
    leadProducts: l.products.trim() || null,
    clientType: l.clientType || null,
  });

  const draft = async () => {
    setBusy("draft");
    const data = await api({ action: "lead-draft", conversationId: c.id });
    setBusy(null);
    if (!data) return;
    setLead((prev) => ({
      ...prev,
      requirement: data.requirement || prev.requirement,
      products: data.products || prev.products,
    }));
    setDirty(true);
  };

  const save = async () => {
    setBusy("save");
    const data = await api({ action: "lead-save", conversationId: c.id, lead });
    setBusy(null);
    if (!data) return;
    setDirty(false);
    onUpdated(patchFromLead(lead));
    toast.success("Lead details saved");
  };

  const push = async () => {
    setBusy("push");
    const data = await api({ action: "lead-push", conversationId: c.id, lead });
    setBusy(null);
    if (!data) return;
    setDirty(false);
    onUpdated({
      ...patchFromLead(lead),
      zohoLeadId: data.zohoLeadId,
      zohoLeadAt: data.zohoLeadAt,
      zohoUrl: data.zohoUrl,
    });
    // "New lead created" or "Matched an existing lead (same phone)…".
    toast.success(data.message ?? "Sent to Zoho", { autoClose: 7000 });
  };

  const status = inZoho ? (
    <a
      className="chats-lead-status chats-lead-done"
      href={c.zohoUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      In Zoho ✓ <ExternalLink size={11} />
    </a>
  ) : missing.length ? (
    <span className="chats-lead-status">Needs {missing.join(", ")}</span>
  ) : (
    <span className="chats-lead-status chats-lead-ready">Ready for Zoho</span>
  );

  return (
    <div className="chats-info-section chats-lead">
      <button type="button" className="chats-lead-bar" onClick={toggle}>
        <span className="chats-info-title">Contact &amp; Zoho lead</span>
        {status}
        {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>

      {open && (
        <div className="chats-lead-form">
          {options && !options.connected && (
            <p className="chats-lead-note">
              {options.message ?? "Zoho isn't connected yet."} You can still
              fill in and save the details.
            </p>
          )}
          {/* Read only for a login without the edit permission. */}
          <fieldset className="chats-lead-fields" disabled={!canEdit}>
          <div className="chats-lead-grid">
            <label>
              Name
              <input value={lead.name} onChange={change("name")} maxLength={100} />
            </label>
            <label>
              Phone
              <input
                value={lead.phone}
                onChange={change("phone")}
                maxLength={30}
                disabled={!canSeeContacts}
                placeholder={!canSeeContacts && c.hasContact ? "Hidden for your login" : ""}
              />
            </label>
            <label>
              Email
              <input
                type="email"
                value={lead.email}
                onChange={change("email")}
                maxLength={120}
                disabled={!canSeeContacts}
                placeholder={!canSeeContacts && c.hasContact ? "Hidden for your login" : ""}
              />
            </label>
            <label>
              Type of client
              <select value={lead.clientType} onChange={change("clientType")}>
                <option value="">Not set</option>
                {(options?.clientTypes ?? []).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
                {/* A saved choice Zoho no longer lists still shows. */}
                {lead.clientType &&
                  !(options?.clientTypes ?? []).includes(lead.clientType) && (
                    <option value={lead.clientType}>{lead.clientType}</option>
                  )}
              </select>
            </label>
            {/* Every lead from here goes to Zoho with this source. */}
            <label>
              Lead source
              <input value={options?.leadSource ?? "Website Bot"} readOnly disabled />
              {options?.connected && options.leadSourceListed === false && (
                <small className="chats-lead-hint">
                  Add "Website Bot" to Lead Source in Zoho (Setup → Modules →
                  Leads → Lead Source) before sending.
                </small>
              )}
            </label>
          </div>
          <label>
            <span className="chats-lead-label-row">
              Requirement
              {canEdit && canDraft && (
                <button
                  type="button"
                  className="chats-link-btn"
                  onClick={draft}
                  disabled={busy !== null}
                >
                  <Sparkles size={12} />
                  {busy === "draft" ? "Drafting…" : "Draft from chat"}
                </button>
              )}
            </span>
            <textarea
              value={lead.requirement}
              onChange={change("requirement")}
              rows={3}
              maxLength={1000}
              placeholder="What they're interested in: pieces, quantity, budget, timeline, city…"
            />
          </label>
          <label>
            Products enquired for
            <input
              value={lead.products}
              onChange={change("products")}
              maxLength={500}
            />
          </label>
          </fieldset>
          <div className="chats-lead-actions">
            {canEdit && (
              <button
                type="button"
                className="chats-btn"
                onClick={save}
                disabled={busy !== null || !dirty}
              >
                {busy === "save" ? "Saving…" : "Save"}
              </button>
            )}
            {inZoho ? (
              <a
                className="chats-btn"
                href={c.zohoUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in Zoho <ExternalLink size={13} />
              </a>
            ) : canPush && (
              <button
                type="button"
                className="chats-btn chats-btn-primary"
                onClick={push}
                disabled={busy !== null || missing.length > 0}
                title={missing.length ? `Add the ${missing.join(", ")} first` : ""}
              >
                {busy === "push" ? "Sending…" : "Send to Zoho"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LeadCard;
