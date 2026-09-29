import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  X,
  Pencil,
  Send,
  Trash2,
  Copy,
  Check,
  ArrowLeft,
  GraduationCap,
  MessageCircle,
  Maximize2,
  Minimize2,
  ArrowUpRight,
  ArrowUp,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { toast } from "react-toastify";
import { supabase } from "./supabase";
import { callAskFaq } from "../lib/askFaq";
import { TEXTS, fillText } from "../lib/chatTexts";
import AiGuidelines from "./AiGuidelines";
import RestockForm from "./RestockForm";
import ContactCard from "./ContactCard";
import NameCard from "./NameCard";

// Improved answers get saved as real rows in this category, so they're
// easy to find, review, and hand off — and since the ask-faq function
// reads straight from the faqs table, they immediately improve future
// answers too.
const CORRECTIONS_CATEGORY = "WhatsApp Bot FAQ";

// Chat history persists here so it survives refreshes/navigation — it's
// only ever cleared by the user hitting the clear button.
const STORAGE_KEY = "askAiChat";

// How much of the chat goes along with each question as context. The
// function caps turns too; this just avoids sending what it'd drop.
const HISTORY_MAX_TURNS = 10;
const HISTORY_MAX_AGE_MS = 30 * 60 * 60 * 1000;

// One anonymous ID per browser, so the Chats page can group a person's
// conversations together. Falls back to a throwaway ID if storage is off.
const VISITOR_KEY = "askAiVisitorId";
const getVisitorId = () => {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
};

// Whether the drawer is expanded to take most of the screen (like Gmail's
// full-screen compose). Remembered per browser.
const EXPANDED_KEY = "askAiExpanded";
const loadExpanded = () => {
  try {
    return localStorage.getItem(EXPANDED_KEY) === "1";
  } catch {
    return false;
  }
};

let nextId = 1;

const formatTime = (ms) =>
  ms
    ? new Date(ms).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

// Answers are plain text, but product replies include store links — turn
// those into real anchors so they're clickable.
const URL_PATTERN = /(https?:\/\/[^\s)]+)/g;
const linkify = (text) =>
  text.split(URL_PATTERN).map((part, i) =>
    i % 2 === 1 ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      part
    ),
  );

// "Check restock" on sold-out cards. Off for now: the restock_requests
// table (scripts/supabase-restock-requests-table.sql) isn't set up yet.
// Flip to true once it is, and restore the "Check restock" sentence in the
// ask-faq prompt.
const RESTOCK_CHECK_ENABLED = false;

// A reply shows up to 4 product cards; "Show more" posts the next 6 as a
// new message (and so on, for the up-to-16 similar products).
const FIRST_PAGE = 4;
const MORE_PAGE = 6;

// Human takeover: how often the chat checks for team replies, and when it
// stops bothering (matches the 24h takeover limit in ask-faq).
// Each check is one Supabase function call (no AI), so the idle rate is
// kept low: that's what counts towards the free tier's monthly allowance.
const POLL_TEAM_MS = 4000;
const POLL_IDLE_MS = 20000;
const POLL_IDLE_CUTOFF_MS = 10 * 60 * 1000;
const TAKEOVER_WINDOW_MS = 24 * 60 * 60 * 1000;
const systemNote = (kind) =>
  kind === "team-joined" ? TEXTS.teamJoined : TEXTS.teamLeft;

// When the AI can't answer (Gemini down or out of quota, no connection),
// the person gets the team on WhatsApp instead of an error, with their
// question already in the message. Same number as the ask-faq function.
const WHATSAPP_NUMBER = "919082820610";
const whatsAppUrl = (text) =>
  `https://api.whatsapp.com/send/?${new URLSearchParams({
    phone: WHATSAPP_NUMBER,
    text,
  })}`;
const fallbackWhatsAppUrl = (question) =>
  whatsAppUrl(
    `Hi Ware team! I was chatting on your website and asked: "${question}"`,
  );

// In a sentence: "the Lilo Cup & Saucer Set Tea Green", not "... (Set of
// 2) - Gift Set".
// ("The Cosmic Temple" too, so it doesn't read "the The Cosmic Temple".)
const shortName = (title) =>
  title
    .replace(/\s*\([^)]*\)|\s*-\s*gift set\b/gi, "")
    .replace(/^the\s+/i, "")
    .trim() || title;

// How long local replies (Show more, similar products) "type" for.
const LOCAL_REPLY_MIN_MS = 1000;
const LOCAL_REPLY_JITTER_MS = 600;

// Whether to offer the "leave your details" card: { dismissed } after "Not
// now", { saved } mirroring what the server says (the name/phone themselves
// live only on the server, so deleting the chat in the Chats page really
// forgets them, and the card comes back). Clearing the chat resets this.
const CONTACT_KEY = "askAiContact";
// Without a follow-up-worthy enquiry, the details prompt waits this long.
const CONTACT_AFTER_MESSAGES = 5;
const loadContactPrefs = () => {
  try {
    const v = JSON.parse(localStorage.getItem(CONTACT_KEY)) ?? {};
    return { dismissed: !!v.dismissed, saved: !!v.saved };
  } catch {
    return { dismissed: false, saved: false };
  }
};
const storeContactPrefs = (value) => {
  try {
    localStorage.setItem(CONTACT_KEY, JSON.stringify(value));
  } catch {
    // Still applies for this page view.
  }
};

// The "What should we call you?" box: offered under the first few replies
// until the server says it knows their name (they typed it, used the box
// or the details form), or they close it. Only the flags live here; the
// name itself stays on the server, like the phone number.
const NAME_KEY = "askAiName";
const NAME_BOX_REPLIES = 3;
const loadNamePrefs = () => {
  try {
    const v = JSON.parse(localStorage.getItem(NAME_KEY)) ?? {};
    return { known: !!v.known, dismissed: !!v.dismissed };
  } catch {
    return { known: false, dismissed: false };
  }
};
const storeNamePrefs = (value) => {
  try {
    localStorage.setItem(NAME_KEY, JSON.stringify(value));
  } catch {
    // Still applies for this page view.
  }
};

// Tells the server the visitor started over ("reset" / clear chat): ends
// any team takeover and marks the spot in the Chats transcript. Their chat
// stays one conversation there.
const notifyReset = () =>
  callAskFaq({
    mode: "reset",
    conversationId: getVisitorId(),
    visitorId: getVisitorId(),
  });

// A reply's product cards, in a row that scrolls sideways. People swipe it
// on phones; with `arrows` (the store chat) mouse users get ‹ › buttons at
// whichever ends have more to show (hidden on touch screens by the CSS).
const ProductRow = ({ arrows, children }) => {
  const rowRef = useRef(null);
  const [more, setMore] = useState({ before: false, after: false });

  const measure = () => {
    const el = rowRef.current;
    if (!el) return;
    setMore({
      before: el.scrollLeft > 4,
      after: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  };

  useEffect(() => {
    if (!arrows || !rowRef.current) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(rowRef.current);
    return () => observer.disconnect();
  }, [arrows]);

  const scrollBy = (direction) => {
    const el = rowRef.current;
    el?.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <div className="ware-row">
      <div
        className="faq-chat-products"
        ref={rowRef}
        onScroll={arrows ? measure : undefined}
      >
        {children}
      </div>
      {arrows && more.before && (
        <button
          type="button"
          className="ware-row-arrow ware-row-arrow-prev"
          onClick={() => scrollBy(-1)}
          aria-label="Previous products"
        >
          <ChevronLeft size={18} />
        </button>
      )}
      {arrows && more.after && (
        <button
          type="button"
          className="ware-row-arrow ware-row-arrow-next"
          onClick={() => scrollBy(1)}
          aria-label="More products"
        >
          <ChevronRight size={18} />
        </button>
      )}
    </div>
  );
};

// Store card names: "(Set of 4)" / "(4 pieces)" moves to a second line and
// a trailing "- Gift Set" goes.
const splitTitle = (title) => {
  let name = title.replace(/\s*-\s*Gift Set\s*$/i, "");
  const m = name.match(/\((set of \d+|\d+\s*pieces?)\)/i);
  if (!m) return { name, detail: "" };
  name = name.replace(m[0], " ").replace(/\s{2,}/g, " ").trim();
  return { name, detail: m[1].charAt(0).toUpperCase() + m[1].slice(1) };
};

// On the Shopify store itself (the customer widget), Add to cart goes
// through the store's cart API, so the shopper stays in the chat. The
// theme's cart count catches up on their next page.
const storeRoot = () =>
  typeof window !== "undefined" && window.Shopify
    ? (window.Shopify.routes?.root ?? "/")
    : null;
const addToStoreCart = async (root, cartUrl) => {
  const id = Number(new URL(cartUrl).searchParams.get("id"));
  const res = await fetch(`${root}cart/add.js`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ items: [{ id, quantity: 1 }] }),
  });
  if (!res.ok) throw new Error(`Cart add failed: ${res.status}`);
};

// A product the AI recommended. Everything shown here comes from the
// Shopify catalog via the function, not from the model's text. Single-
// variant products add straight to the store's cart; ones with options
// (size, colour) go to the product page to pick.
const ProductCard = ({ product, restockState, onCheckRestock, customer }) => {
  const [cartState, setCartState] = useState(null); // adding | added
  const root = customer ? storeRoot() : null;
  // In the store the product pages open in the same tab (the chat comes
  // along); elsewhere they open the store in a new one.
  const linkProps = root ? {} : { target: "_blank", rel: "noopener noreferrer" };

  const addToCart = async () => {
    setCartState("adding");
    try {
      await addToStoreCart(root, product.cartUrl);
      setCartState("added");
    } catch (err) {
      console.error(err);
      // The plain cart link still works: it adds and opens the cart.
      window.location.href = product.cartUrl;
    }
  };

  // Ware Atelier pieces are made to order: no cart, just a WhatsApp
  // enquiry (the function already hides their price).
  const action = product.enquireUrl
    ? { href: product.enquireUrl, label: TEXTS.enquire }
    : product.cartUrl
      ? { href: product.cartUrl, label: "Add to cart" }
      : { href: product.url, label: "Shop now" };
  const storeCart = root && !product.enquireUrl && product.cartUrl;

  // The store's card: a short name ("Lilo 90ml Espresso Cup & Saucer Set
  // (Set of 4) - Gift Set" becomes "Lilo 90ml Espresso Cup & Saucer Set"
  // over "Set of 4"), ₹ prices and a
  // round + to add to cart.
  if (customer) {
    const { name, detail } = splitTitle(product.title);
    let cta = null;
    // noAction: the reply around it has its own buttons (the bespoke offer).
    if (product.noAction) {
      cta = null;
    } else if (product.enquireUrl) {
      cta = (
        <a
          href={product.enquireUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ware-card-enquire"
        >
          {TEXTS.enquire}
        </a>
      );
    } else if (product.available && storeCart && cartState === "added") {
      cta = (
        <a
          href={`${root}cart`}
          className="ware-card-add ware-card-added"
          aria-label="Added. View cart"
          title="Added. View cart"
        >
          <Check size={15} />
        </a>
      );
    } else if (product.available && storeCart) {
      cta = (
        <button
          type="button"
          className="ware-card-add"
          disabled={cartState === "adding"}
          onClick={addToCart}
          aria-label={`Add ${name} to cart`}
          title="Add to cart"
        >
          <Plus size={15} />
        </button>
      );
    } else if (product.available) {
      cta = (
        <a
          href={product.cartUrl ?? product.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ware-card-add"
          aria-label={`Add ${name} to cart`}
          title="Add to cart"
        >
          <Plus size={15} />
        </a>
      );
    }
    return (
      <div className="ware-card">
        <a href={product.url} {...linkProps} className="ware-card-link">
          <div className="ware-card-img">
            {product.image && <img src={product.image} alt="" loading="lazy" />}
            {!product.available && (
              <span className="ware-card-tag ware-card-tag-muted">{TEXTS.soldOut}</span>
            )}
          </div>
          <div className="ware-card-name">{name}</div>
          {detail && <div className="ware-card-detail">{detail}</div>}
        </a>
        <div className="ware-card-foot">
          <span className="ware-card-price">
            {product.price.replace(/Rs\.?\s?/g, "₹")}
          </span>
          {cta}
        </div>
      </div>
    );
  }

  return (
    <div className="faq-chat-product">
      <a
        href={product.url}
        {...linkProps}
        className="faq-chat-product-link"
      >
        <div className="faq-chat-product-img">
          {product.image && <img src={product.image} alt="" loading="lazy" />}
          {!product.available && (
            <span className="faq-chat-product-badge">{TEXTS.soldOut}</span>
          )}
        </div>
        <div className="faq-chat-product-title">{product.title}</div>
        <div className="faq-chat-product-price">{product.price}</div>
      </a>
      {product.available && storeCart ? (
        cartState === "added" ? (
          <a
            href={`${root}cart`}
            className="faq-chat-product-btn ware-chat-added"
          >
            Added ✓ View cart
          </a>
        ) : (
          <button
            type="button"
            className="faq-chat-product-btn"
            disabled={cartState === "adding"}
            onClick={addToCart}
          >
            {cartState === "adding" ? "Adding..." : "Add to cart"}
          </button>
        )
      ) : product.available ? (
        <a
          href={action.href}
          target="_blank"
          rel="noopener noreferrer"
          className="faq-chat-product-btn"
        >
          {action.label}
        </a>
      ) : !RESTOCK_CHECK_ENABLED ? (
        <a
          href={product.url}
          {...linkProps}
          className="faq-chat-product-btn faq-chat-product-btn-muted"
        >
          View
        </a>
      ) : (
        // Sold out: no pre-orders, but the team can check for stock.
        <button
          type="button"
          className="faq-chat-product-btn faq-chat-product-btn-muted"
          disabled={restockState === "done"}
          onClick={onCheckRestock}
        >
          {restockState === "done" ? "Requested ✓" : "Check restock"}
        </button>
      )}
    </div>
  );
};

const loadStoredMessages = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // A message still "loading" or mid-edit when the page closed can
    // never resolve on its own — settle it into a plain state instead of
    // showing a permanent "Thinking..." bubble.
    return parsed.map((m) => ({
      ...m,
      loading: false,
      error: m.loading ? "Interrupted — try asking again." : m.error,
      correcting: false,
    }));
  } catch {
    return [];
  }
};

// A small chat popup for testing the FAQ bot turn by turn. The earlier
// answered turns go along with each question so the model can follow the
// conversation; clearing the chat starts it fresh. With `customer` it's the
// shopper-facing chat on the Shopify store (widget/): no team tools
// ("Improve answer", copy buttons), a welcome instead of tester notes, and
// the page around it is left alone.
// `actionsRef` (the store's widget) gets { productTap } for the pill on a
// product page.
const AskAi = ({
  open,
  onClose,
  onSaved,
  canEdit,
  customer = false,
  actionsRef,
}) => {
  const [messages, setMessages] = useState(loadStoredMessages);
  const [showGuidelines, setShowGuidelines] = useState(false);
  const [contactPrefs, setContactPrefs] = useState(loadContactPrefs);
  const [contactThanks, setContactThanks] = useState(null);
  const [namePrefs, setNamePrefs] = useState(loadNamePrefs);
  // Their name as the server knows it, to pre-fill the details form.
  const [knownName, setKnownName] = useState("");
  const [input, setInput] = useState("");
  const [copiedKey, setCopiedKey] = useState(null);
  const [expanded, setExpanded] = useState(loadExpanded);
  const [menuOpen, setMenuOpen] = useState(false);
  const listRef = useRef(null);

  // Keep nextId ahead of anything restored from storage so new messages
  // never collide with old ones.
  useEffect(() => {
    const maxStored = messages.reduce((max, m) => Math.max(max, m.id), 0);
    if (maxStored >= nextId) nextId = maxStored + 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // Storage full or unavailable (e.g. private browsing) — chat still
      // works for the session, it just won't persist.
    }
  }, [messages]);

  // Reserves room on the page for the drawer (see .faq-chat-open in
  // Faq.css) so it pushes the Q&A content and navbar aside instead of
  // covering them.
  // (Not on the store: the chat floats over the theme's page there.)
  useEffect(() => {
    if (customer) return;
    document.body.classList.toggle("faq-chat-open", open);
    return () => document.body.classList.remove("faq-chat-open");
  }, [open, customer]);

  // Expanded, the drawer overlays the page instead of pushing it aside
  // (squeezing the page into the leftover strip would be useless).
  const isExpanded = open && expanded;
  useEffect(() => {
    if (customer) return;
    document.body.classList.toggle("faq-chat-expanded", isExpanded);
    return () => document.body.classList.remove("faq-chat-expanded");
  }, [isExpanded, customer]);

  const toggleExpanded = (value) => {
    setExpanded(value);
    try {
      localStorage.setItem(EXPANDED_KEY, value ? "1" : "0");
    } catch {
      // Still applies for this page view.
    }
  };

  // Esc shrinks it back to the side drawer.
  useEffect(() => {
    if (!isExpanded) return;
    const onKey = (e) => {
      if (e.key === "Escape") toggleExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isExpanded]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const patchMessage = (id, patch) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    );
  };

  const send = (e) => {
    e.preventDefault();
    ask(input);
  };

  const ask = async (text) => {
    const question = text.trim();
    if (!question) return;
    setInput("");
    setContactThanks(null);

    const id = nextId++;

    // "reset" wipes the AI's memory of the chat without wiping what's on
    // screen — handled right here, no AI call needed.
    if (/^\/?reset$/i.test(question)) {
      notifyReset();
      setMessages((prev) => [
        ...prev,
        {
          id,
          question,
          answer: "Okay, starting fresh. I've forgotten the earlier chat.",
          isReset: true,
          time: Date.now(),
        },
      ]);
      return;
    }

    // Only the turns since the last "reset", and none older than
    // HISTORY_MAX_AGE_MS — a stale chat shouldn't color a new one.
    const lastReset = messages.findLastIndex((m) => m.isReset);
    const cutoff = Date.now() - HISTORY_MAX_AGE_MS;
    // Includes team replies and the customer's messages to the team from
    // a takeover, so the AI knows what was said once it's handed back.
    const recent = messages
      .slice(lastReset + 1)
      .filter(
        (m) => (m.answer || m.awaitingTeam) && !m.failed && m.time > cutoff,
      )
      .slice(-HISTORY_MAX_TURNS);
    const history = recent.map((m) => ({
      question: m.historyQuestion ?? m.question ?? "",
      answer: m.answer ?? "",
      products: (m.products ?? []).map((p) => p.title),
      fromTeam: !!m.isAgent,
    }));
    // One conversation per visitor in the Chats page, so it's keyed on the
    // browser's visitor ID; resets only clear the AI's memory above.
    const conversationId = getVisitorId();

    setMessages((prev) => [
      ...prev,
      {
        id,
        question,
        conversationId,
        answer: null,
        loading: true,
        error: null,
        correcting: false,
        correctedText: "",
        saving: false,
        saved: false,
        time: Date.now(),
      },
    ]);

    const { data, error } = await callAskFaq({
      question,
      history,
      conversationId,
      visitorId: getVisitorId(),
    });
    if (data && typeof data.contactSaved === "boolean") {
      syncContactSaved(data.contactSaved);
    }
    if (data && typeof data.nameKnown === "boolean") {
      if (data.nameKnown !== namePrefs.known) {
        updateNamePrefs({ known: data.nameKnown });
      }
      setKnownName(data.visitorName ?? "");
    }

    if (error || data?.error) {
      console.error(error ?? data?.error);
      // Not a real answer: kept out of the AI's history (`failed`) and
      // without "Improve answer" (`isLocal`).
      patchMessage(id, {
        loading: false,
        answer: TEXTS.fallback,
        whatsappUrl: fallbackWhatsAppUrl(question),
        failed: true,
        isLocal: true,
      });
      return;
    }
    // The team has taken this chat over: no AI answer, the message waits
    // for them (their replies arrive through the polling below).
    if (data.takeover) {
      patchMessage(id, { loading: false, awaitingTeam: true });
      if (!teamActive) addSystemNote("team-joined");
      return;
    }
    // A question about a Ware Atelier piece: the designer-call offer (see
    // startBespoke) in place of an answer, with the piece's card.
    if (data.bespoke) {
      patchMessage(id, {
        loading: false,
        answer: fillText(
          data.bespoke.count > 1 ? TEXTS.bespokeIntroMany : TEXTS.bespokeIntro,
          { name: shortName(data.bespoke.title) },
        ),
        // Their own Enquire (WhatsApp) would be a third ask: the form
        // behind "Yes, call me" links to WhatsApp already.
        products: (data.products ?? []).map((p) => ({ ...p, noAction: true })),
        bespokeOffer: data.bespoke,
      });
      return;
    }
    patchMessage(id, {
      loading: false,
      answer: data.answer,
      products: (data.products ?? []).slice(0, FIRST_PAGE),
      moreProducts: (data.products ?? []).slice(FIRST_PAGE),
      images: data.images ?? [],
      whatsappUrl: data.whatsappUrl ?? null,
      showCatalog: !!data.catalog,
      askForDetails: !!data.askForDetails,
      detailsOpen: !!data.detailsOpen,
      // A nudge to WhatsApp (too many / too long messages), not an answer.
      ...(data.fallback ? { failed: true, isLocal: true } : {}),
    });
    // The reply asks if the team can call them: offer the form even if
    // they said "Not now" to the earlier one-line prompt.
    if (data.detailsOpen) updateContactPrefs({ dismissed: false });
  };

  // The alternatives were already picked by the function alongside the
  // sold-out card, so this just shows them — no second AI call.
  const showSimilar = (msg, product) => {
    patchMessage(msg.id, {
      similarShown: { ...msg.similarShown, [product.url]: true },
    });
    postLocalReply("Yes, show me similar ones", {
      answer: fillText(TEXTS.similarIntro, { name: product.title }),
      products: product.similar.slice(0, FIRST_PAGE),
      moreProducts: product.similar.slice(FIRST_PAGE),
    });
  };

  // "Show more" continues the conversation: a "Show me more" turn and a
  // new bot message with the next batch, which can offer more again.
  // Everything was already sent by the function, so no AI call.
  const showMore = (msg) => {
    patchMessage(msg.id, { moreProducts: [] });
    postLocalReply("Show me more", {
      answer: TEXTS.moreIntro,
      products: msg.moreProducts.slice(0, MORE_PAGE),
      moreProducts: msg.moreProducts.slice(MORE_PAGE),
    });
  };

  // ---- The store pill on a product page (widget/src/main.jsx) ----
  // A normal piece: "Show me more products like this", answered with the
  // similar-products picks (no AI). A Ware Atelier piece: an offer of a
  // call from a designer, with Yes, call me / Not now.
  const productTap = (product) => {
    // Tapped again straight after: the answer's already on screen.
    const last = messages[messages.length - 1];
    if (last?.tapHandle === product.handle) return;
    setContactThanks(null);
    if (product.bespoke) startBespoke(product);
    else showMoreLikeThis(product);
  };
  useEffect(() => {
    if (actionsRef) actionsRef.current = { productTap };
  });

  const showMoreLikeThis = async (product) => {
    const id = nextId++;
    const conversationId = getVisitorId();
    const historyQuestion = `Show me more products like the ${product.title}`;
    setMessages((prev) => [
      ...prev,
      {
        id,
        question: TEXTS.moreLikeThisAsk,
        historyQuestion,
        tapHandle: product.handle,
        conversationId,
        loading: true,
        isLocal: true,
        time: Date.now(),
      },
    ]);
    const started = Date.now();
    const { data, error } = await callAskFaq({
      mode: "similar",
      handle: product.handle,
      conversationId,
      visitorId: getVisitorId(),
    });
    // Still "types" for a moment, like the other instant replies.
    const wait = LOCAL_REPLY_MIN_MS - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (error || data?.error) {
      console.error(error ?? data?.error);
      patchMessage(id, {
        loading: false,
        answer: TEXTS.fallback,
        whatsappUrl: fallbackWhatsAppUrl(historyQuestion),
        failed: true,
      });
      return;
    }
    if (typeof data.contactSaved === "boolean") {
      syncContactSaved(data.contactSaved);
    }
    const products = data.products ?? [];
    const name = shortName(data.title ?? product.title);
    patchMessage(id, {
      loading: false,
      answer: fillText(
        products.length ? TEXTS.moreLikeThisIntro : TEXTS.moreLikeThisNone,
        { name },
      ),
      products: products.slice(0, FIRST_PAGE),
      moreProducts: products.slice(FIRST_PAGE),
      whatsappUrl: data.whatsappUrl ?? null,
    });
  };

  // Each step is also logged for the team (the "bespoke" mode).
  const logBespoke = (product, step, contact) =>
    callAskFaq({
      mode: "bespoke",
      step,
      handle: product.handle,
      contact,
      conversationId: getVisitorId(),
      visitorId: getVisitorId(),
    });

  const startBespoke = (product) => {
    const name = shortName(product.title);
    logBespoke(product, "start").then(({ error, data }) => {
      if (error || data?.error) console.error(error ?? data?.error);
    });
    postLocalReply(
      fillText(TEXTS.bespokeAsk, { name }),
      {
        answer: fillText(TEXTS.bespokeIntro, { name }),
        bespokeOffer: product,
        conversationId: getVisitorId(),
      },
      { tapHandle: product.handle },
    );
  };

  // "Yes, call me": their choice as a message, with the name / number form
  // (and WhatsApp as the alternative) under it.
  const acceptBespoke = (msg) => {
    const product = msg.bespokeOffer;
    patchMessage(msg.id, { bespokeOffer: null });
    setMessages((prev) => [
      ...prev,
      {
        id: nextId++,
        question: TEXTS.bespokeYes,
        bespokeForm: product,
        isLocal: true,
        time: Date.now(),
      },
    ]);
  };

  // "Not now", from the offer or from the form.
  const declineBespoke = (msg, product) => {
    if (msg.bespokeForm) {
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    } else {
      patchMessage(msg.id, { bespokeOffer: null });
    }
    logBespoke(product, "later");
    postLocalReply(TEXTS.notNow, { answer: TEXTS.bespokeLater });
  };

  const saveBespoke = async (msg, details) => {
    const product = msg.bespokeForm;
    const { data, error } = await logBespoke(product, "call", details);
    if (error || data?.error) {
      console.error(error ?? data?.error);
      return false;
    }
    updateContactPrefs({ saved: true });
    if (details.name) {
      updateNamePrefs({ known: true });
      setKnownName(details.name);
    }
    patchMessage(msg.id, {
      bespokeForm: null,
      conversationId: getVisitorId(),
      answer: fillText(
        details.name ? TEXTS.bespokeThanks : TEXTS.bespokeThanksNoName,
        { name: details.name },
      ),
    });
    return true;
  };

  // Replies the chat already has the answer to still "type" for a moment
  // (the three dots), so they don't pop in unnaturally fast.
  const postLocalReply = (question, reply, extra = {}) => {
    const id = nextId++;
    setMessages((prev) => [
      ...prev,
      { id, question, loading: true, isLocal: true, time: Date.now(), ...extra },
    ]);
    const delay = LOCAL_REPLY_MIN_MS + Math.random() * LOCAL_REPLY_JITTER_MS;
    setTimeout(() => patchMessage(id, { loading: false, ...reply }), delay);
  };

  // The conversation the details card attaches to: the latest one the
  // function has logged (since the last "reset").
  const lastResetIndex = messages.findLastIndex((m) => m.isReset);
  const currentConversationId = messages
    .slice(lastResetIndex + 1)
    .findLast((m) => m.conversationId && m.answer)?.conversationId;
  // Offer it only when it's useful: the function flagged an enquiry the
  // team should follow up on (bulk / custom / quote...), or they've been
  // chatting a while. Not from the very first message.
  const customerMessages = messages.filter(
    (m) => m.question && !m.isLocal && !m.isReset,
  ).length;
  // Not straight after the WhatsApp button either: two asks at once.
  const lastReplyHasWhatsApp = !!messages.findLast((m) => m.answer)
    ?.whatsappUrl;
  const showContactCard =
    !contactPrefs.dismissed &&
    !messages.some((m) => m.bespokeForm) &&
    !contactPrefs.saved &&
    !!currentConversationId &&
    !lastReplyHasWhatsApp &&
    !messages.some((m) => m.loading) &&
    (messages.some((m) => m.askForDetails) ||
      customerMessages >= CONTACT_AFTER_MESSAGES);
  // "What should we call you?": under the latest reply while it's one of
  // their first few (since the last reset), until the name is known or
  // they close it. Never at the same time as the details form.
  const updateNamePrefs = (patch) =>
    setNamePrefs((prev) => {
      const next = { ...prev, ...patch };
      storeNamePrefs(next);
      return next;
    });
  const aiReplies = messages
    .slice(lastResetIndex + 1)
    .filter((m) => m.answer && !m.isLocal && !m.isAgent && !m.failed).length;
  const lastIsAiReply = (() => {
    const last = messages[messages.length - 1];
    return !!last?.answer && !last.isLocal && !last.isAgent && !last.failed;
  })();
  const showNameCard =
    !namePrefs.known &&
    !namePrefs.dismissed &&
    !showContactCard &&
    !messages.some((m) => m.loading || m.bespokeOffer || m.bespokeForm) &&
    lastIsAiReply &&
    aiReplies >= 1 &&
    aiReplies <= NAME_BOX_REPLIES;

  const saveName = async (name) => {
    const { data, error } = await callAskFaq({
      mode: "name",
      name,
      conversationId: getVisitorId(),
      visitorId: getVisitorId(),
    });
    if (error || data?.error) {
      console.error(error ?? data?.error);
      return false;
    }
    updateNamePrefs({ known: true });
    setKnownName(name);
    // A short, local "nice to meet you" (it also tells the assistant their
    // name through the chat history).
    setMessages((prev) => [
      ...prev,
      {
        id: nextId++,
        answer: fillText(TEXTS.nameBoxThanks, { name }),
        isLocal: true,
        time: Date.now(),
      },
    ]);
    return true;
  };

  // The latest reply asked "can our team give you a quick call?": show
  // the name / number form open under it rather than the one-liner.
  const callAsked = !!messages.findLast((m) => m.answer)?.detailsOpen;

  const updateContactPrefs = (patch) =>
    setContactPrefs((prev) => {
      const next = { ...prev, ...patch };
      storeContactPrefs(next);
      return next;
    });
  // The server says whether this visitor's details are on file; if the
  // team deleted the chat, that flips back to false and the card returns.
  const syncContactSaved = (saved) => {
    if (saved !== contactPrefs.saved) updateContactPrefs({ saved });
  };

  // ---- Human takeover (a team member replying from the Chats page) ----
  const sinceReset = messages.slice(lastResetIndex + 1);
  const teamActive =
    sinceReset.findLast((m) => m.isSystem)?.kind === "team-joined";
  const lastAgentTime = sinceReset.findLast((m) => m.isAgent)?.serverTime;
  const lastActivity = sinceReset.findLast((m) => !m.isSystem)?.time ?? 0;

  const addSystemNote = (kind) => {
    const id = nextId++;
    setMessages((prev) => [
      ...prev,
      { id, isSystem: true, kind, text: systemNote(kind), time: Date.now() },
    ]);
  };

  // Checks for team replies and takeover changes: every few seconds while
  // the team is in the chat, less often otherwise, and not at all once the
  // chat has gone quiet (nobody would be waiting on it).
  useEffect(() => {
    if (!open || !currentConversationId) return;
    const idleFor = Date.now() - lastActivity;
    if (!teamActive && idleFor > POLL_IDLE_CUTOFF_MS) return;
    if (teamActive && idleFor > TAKEOVER_WINDOW_MS) return;

    const timer = setInterval(
      async () => {
        // Nobody's looking at a background tab; catch up once it's back.
        if (document.hidden) return;
        const { data } = await callAskFaq({
          mode: "updates",
          conversationId: currentConversationId,
          visitorId: getVisitorId(),
          after: lastAgentTime,
        });
        if (!data || data.error) return;
        const incoming = (data.messages ?? []).map((r) => ({
          id: nextId++,
          answer: r.answer,
          isAgent: true,
          isLocal: true,
          serverId: r.id,
          serverTime: r.created_at,
          conversationId: currentConversationId,
          time: Date.now(),
        }));
        setMessages((prev) => {
          const seen = new Set(prev.map((m) => m.serverId).filter(Boolean));
          const fresh = incoming.filter((m) => !seen.has(m.serverId));
          const notes = [];
          if (data.takeover && !teamActive) notes.push("team-joined");
          if (!data.takeover && teamActive) notes.push("team-left");
          if (!fresh.length && !notes.length) return prev;
          return [
            ...prev,
            ...notes
              .filter((k) => k === "team-joined")
              .map((kind) => ({
                id: nextId++,
                isSystem: true,
                kind,
                text: systemNote(kind),
                time: Date.now(),
              })),
            ...fresh,
            ...notes
              .filter((k) => k === "team-left")
              .map((kind) => ({
                id: nextId++,
                isSystem: true,
                kind,
                text: systemNote(kind),
                time: Date.now(),
              })),
          ];
        });
      },
      teamActive ? POLL_TEAM_MS : POLL_IDLE_MS,
    );
    return () => clearInterval(timer);
  }, [open, currentConversationId, teamActive, lastAgentTime, lastActivity]);

  const saveContact = async (details) => {
    const { data, error } = await callAskFaq({
      mode: "contact",
      contact: details,
      conversationId: getVisitorId(),
      visitorId: getVisitorId(),
    });
    if (error || data?.error) {
      console.error(error ?? data?.error);
      return false;
    }
    updateContactPrefs({ saved: true });
    setContactThanks(
      fillText(details.name ? TEXTS.contactThanks : TEXTS.contactThanksNoName, {
        name: details.name,
        phone: details.phone,
      }),
    );
    return true;
  };

  const dismissContact = () => updateContactPrefs({ dismissed: true });

  const copyText = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch (err) {
      console.error(err);
      toast.error("Couldn't copy to clipboard.");
    }
  };

  // Starting over: the AI forgets the chat, any takeover ends, and "Not
  // now" is forgotten so the details card can be offered again. (It stays
  // one conversation in the Chats page, with a reset marker.)
  const clearChat = () => {
    notifyReset();
    setMessages([]);
    setContactThanks(null);
    updateContactPrefs({ dismissed: false });
    updateNamePrefs({ dismissed: false });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore — the in-memory state is already cleared either way.
    }
  };

  const startCorrection = (msg) =>
    patchMessage(msg.id, { correcting: true, correctedText: msg.answer });

  const saveCorrection = async (msg) => {
    if (!msg.correctedText.trim()) return;

    patchMessage(msg.id, { saving: true });
    const { data, error } = await supabase
      .from("faqs")
      .insert({
        question: msg.question,
        answer: msg.correctedText.trim(),
        category: CORRECTIONS_CATEGORY,
      })
      .select()
      .single();

    if (error) {
      toast.error("Couldn't save that. Check the Supabase setup.");
      console.error(error);
      patchMessage(msg.id, { saving: false });
      return;
    }

    toast.success(`Saved under "${CORRECTIONS_CATEGORY}"`);
    onSaved?.(data);
    patchMessage(msg.id, {
      saving: false,
      correcting: false,
      saved: true,
      answer: msg.correctedText.trim(),
    });
  };

  return (
    <>
    {isExpanded && (
      <div
        className="faq-chat-backdrop"
        onClick={() => toggleExpanded(false)}
        aria-hidden="true"
      />
    )}
    <div
      className={`faq-chat-popup ${open ? "faq-chat-popup-open" : ""} ${isExpanded ? "faq-chat-popup-expanded" : ""}`}
    >
      {customer ? (
        // The store's header: minimise on the left, name centred, and a
        // small menu for starting over / full screen.
        <div className="faq-chat-header ware-chat-header">
          <button
            type="button"
            onClick={onClose}
            className="faq-icon-btn"
            aria-label="Minimise chat"
          >
            <ChevronDown size={20} />
          </button>
          <div className="ware-chat-heading">
            <span className="ware-chat-name">{TEXTS.title}</span>
          </div>
          <div className="ware-chat-menu-wrap">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="faq-icon-btn"
              aria-label="More options"
              aria-expanded={menuOpen}
            >
              <MoreHorizontal size={20} />
            </button>
            {menuOpen && (
              // Tapping anywhere else closes the menu.
              <div
                className="ware-chat-menu-backdrop"
                onClick={() => setMenuOpen(false)}
                aria-hidden="true"
              />
            )}
            {menuOpen && (
              <div className="ware-chat-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  disabled={messages.length === 0}
                  onClick={() => {
                    setMenuOpen(false);
                    clearChat();
                  }}
                >
                  <Trash2 size={14} />
                  {TEXTS.menuNewChat}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="ware-chat-menu-expand"
                  onClick={() => {
                    setMenuOpen(false);
                    toggleExpanded(!expanded);
                  }}
                >
                  {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  {expanded ? TEXTS.menuSmaller : TEXTS.menuFullScreen}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
      <div className="faq-chat-header">
        {showGuidelines ? (
          <span className="faq-chat-title">
            <button
              type="button"
              onClick={() => setShowGuidelines(false)}
              className="faq-icon-btn"
              aria-label="Back to chat"
              title="Back to chat"
            >
              <ArrowLeft size={15} />
            </button>
            Improve AI
          </span>
        ) : (
          <span className="faq-chat-title">
            <Sparkles size={15} />
            {customer ? "Chat with Ware" : "Ask AI"}
          </span>
        )}
        <div className="faq-chat-header-actions">
          {canEdit && !showGuidelines && (
            <button
              type="button"
              onClick={() => setShowGuidelines(true)}
              className="faq-icon-btn faq-chat-improve-ai-btn"
              title="Improve AI: teach it how to answer"
            >
              <GraduationCap size={15} />
              Improve AI
            </button>
          )}
          {!showGuidelines && (
            <button
              type="button"
              onClick={clearChat}
              className="faq-icon-btn faq-danger"
              aria-label="Clear chat"
              title="Clear chat"
              disabled={messages.length === 0}
            >
              <Trash2 size={15} />
            </button>
          )}
          <button
            type="button"
            onClick={() => toggleExpanded(!expanded)}
            className="faq-icon-btn faq-chat-expand-btn"
            aria-label={expanded ? "Exit full screen" : "Full screen"}
            title={expanded ? "Exit full screen (Esc)" : "Full screen"}
          >
            {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="faq-icon-btn"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>
      )}

      {showGuidelines ? (
        <div className="faq-chat-messages">
          <AiGuidelines />
        </div>
      ) : (
      <>
      <div className="faq-chat-messages" ref={listRef}>
        {messages.length === 0 && customer && (
          <div className="ware-chat-welcome">
            <div className="faq-chat-bubble faq-chat-ai">
              {TEXTS.welcome}
            </div>
            <div className="ware-chat-suggestions">
              {TEXTS.suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="ware-chat-suggestion"
                  onClick={() => ask(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.length === 0 && !customer && (
          <p className="faq-chat-empty">
            Ask it anything a customer might. If a reply isn't quite right,
            hit "Improve answer" — saved answers collect under "
            {CORRECTIONS_CATEGORY}" so they're ready to hand off. It
            remembers the conversation; type "reset" to start fresh. Chats
            are saved so the team can review them.
          </p>
        )}

        {messages.map((m) => m.isSystem ? (
          <div key={m.id} className="faq-chat-system">{m.text}</div>
        ) : (
          <div key={m.id} className="faq-chat-turn">
            {m.question && (
            <>
            <div className="faq-chat-bubble faq-chat-user">{m.question}</div>
            <div className="faq-chat-meta faq-chat-meta-user">
              {m.awaitingTeam && (
                <span className="faq-chat-sent-team">{TEXTS.sentToTeam}</span>
              )}
              {!customer && (
                <button
                  type="button"
                  className="faq-chat-copy-btn"
                  onClick={() => copyText(m.question, `${m.id}-q`)}
                  aria-label="Copy question"
                  title="Copy"
                >
                  {copiedKey === `${m.id}-q` ? (
                    <Check size={11} />
                  ) : (
                    <Copy size={11} />
                  )}
                </button>
              )}
              <span className="faq-chat-time">{formatTime(m.time)}</span>
            </div>
            </>
            )}

            {m.loading && (
              <div
                className="faq-chat-bubble faq-chat-ai faq-chat-typing"
                aria-label="Typing"
              >
                <span />
                <span />
                <span />
              </div>
            )}

            {m.error && (
              <div className="faq-chat-bubble faq-chat-ai faq-chat-error">
                {m.error}
              </div>
            )}

            {m.answer && !m.correcting && (
              <div
                className={`faq-chat-bubble faq-chat-ai${m.isAgent ? " faq-chat-team" : ""}`}
              >
                {m.isAgent && <span className="faq-chat-team-label">Ware team</span>}
                {linkify(m.answer)}
                {m.products?.length > 0 && (
                  <ProductRow arrows={customer}>
                    {m.products.map((p) => (
                      <ProductCard
                        key={p.url}
                        product={p}
                        customer={customer}
                        restockState={
                          m.restockDone?.[p.url]
                            ? "done"
                            : m.restockOpen === p.url
                              ? "open"
                              : null
                        }
                        onCheckRestock={() =>
                          patchMessage(m.id, { restockOpen: p.url })
                        }
                      />
                    ))}
                  </ProductRow>
                )}
                {m.moreProducts?.length > 0 && (
                  <button
                    type="button"
                    className="faq-chat-similar-btn faq-chat-more-btn"
                    onClick={() => showMore(m)}
                  >
                    {TEXTS.showMore}
                  </button>
                )}
                {/* "Talk to a human" — the function only sends this link
                    when someone asks for the team, with a pre-filled
                    message carrying their name / products for context. */}
                {m.whatsappUrl && (
                  <a
                    href={m.whatsappUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="faq-chat-whatsapp-btn"
                  >
                    <span className="faq-chat-whatsapp-icon">
                      <MessageCircle size={17} />
                    </span>
                    <span className="faq-chat-whatsapp-text">
                      <strong>{TEXTS.whatsappTitle}</strong>
                      <small>{fillText(TEXTS.whatsappSubtitle)}</small>
                    </span>
                    <ArrowUpRight size={16} className="faq-chat-whatsapp-arrow" />
                  </a>
                )}
                {/* Gift packaging photos — only sent for gift packaging
                    questions, and only when real photos exist. */}
                {m.images?.length > 0 && (
                  <div className="faq-chat-products">
                    {m.images.map((img) => (
                      <a
                        key={img.src}
                        href={img.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="faq-chat-gift-image"
                      >
                        <img
                          src={img.src}
                          alt={`Gift packaging for ${img.productTitle}`}
                          loading="lazy"
                        />
                        <span>{img.productTitle}</span>
                      </a>
                    ))}
                  </div>
                )}
                {m.products
                  ?.filter((p) => m.restockOpen === p.url)
                  .map((p) => (
                    <RestockForm
                      key={p.url}
                      product={p}
                      onCancel={() => patchMessage(m.id, { restockOpen: null })}
                      onDone={(contact) =>
                        patchMessage(m.id, {
                          restockOpen: null,
                          restockDone: {
                            ...m.restockDone,
                            [p.url]: contact,
                          },
                        })
                      }
                    />
                  ))}
                {m.products
                  ?.filter((p) => m.restockDone?.[p.url])
                  .map((p) => (
                    <div key={p.url} className="faq-chat-restock-done">
                      Thanks! We'll check stock for the {p.title} and reach
                      out at {m.restockDone[p.url]}.
                    </div>
                  ))}
                {m.products
                  ?.filter((p) => p.similar?.length && !m.similarShown?.[p.url])
                  .map((p) => (
                    <div key={p.url} className="faq-chat-similar-offer">
                      {m.products.length > 1
                        ? `${p.title} is sold out right now. `
                        : ""}
                      {TEXTS.similarOffer}
                      <button
                        type="button"
                        className="faq-chat-similar-btn"
                        onClick={() => showSimilar(m, p)}
                      >
                        {TEXTS.similarButton}
                      </button>
                    </div>
                  ))}
                {(m.bespokeOffer || m.showCatalog) && TEXTS.atelierCatalogUrl && (
                  <a
                    href={TEXTS.atelierCatalogUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="faq-chat-catalog-link"
                  >
                    <BookOpen size={14} />
                    {TEXTS.bespokeCatalog}
                    <ArrowUpRight size={13} />
                  </a>
                )}
                {m.bespokeOffer && (
                  <div className="faq-chat-contact-prompt-actions">
                    <button
                      type="button"
                      className="faq-chat-similar-btn"
                      onClick={() => acceptBespoke(m)}
                    >
                      {TEXTS.bespokeYes}
                    </button>
                    <button
                      type="button"
                      className="faq-chat-contact-skip"
                      onClick={() => declineBespoke(m, m.bespokeOffer)}
                    >
                      {TEXTS.notNow}
                    </button>
                  </div>
                )}
                <div className="faq-chat-bubble-actions">
                  <div className="faq-chat-meta">
                    {!customer && (
                      <button
                        type="button"
                        className="faq-chat-copy-btn"
                        onClick={() => copyText(m.answer, `${m.id}-a`)}
                        aria-label="Copy answer"
                        title="Copy"
                      >
                        {copiedKey === `${m.id}-a` ? (
                          <Check size={11} />
                        ) : (
                          <Copy size={11} />
                        )}
                      </button>
                    )}
                    <span className="faq-chat-time">
                      {formatTime(m.time)}
                    </span>
                  </div>
                  {customer || m.isReset || m.isLocal ? null : m.saved ? (
                    <span className="faq-chat-saved">Saved ✓</span>
                  ) : (
                    <button
                      type="button"
                      className="faq-chat-improve-btn"
                      onClick={() => startCorrection(m)}
                    >
                      <Pencil size={12} />
                      Improve answer
                    </button>
                  )}
                </div>
              </div>
            )}

            {m.bespokeForm && (
              <ContactCard
                startOpen
                initialName={knownName}
                title={TEXTS.bespokeFormTitle}
                onSave={(details) => saveBespoke(m, details)}
                onDismiss={() => declineBespoke(m, m.bespokeForm)}
              >
                <a
                  href={whatsAppUrl(
                    `Hi! I'm interested in the ${m.bespokeForm.title} from Ware Atelier. Could we talk about it?`,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="faq-chat-contact-whatsapp"
                >
                  <MessageCircle size={14} />
                  {TEXTS.bespokeWhatsApp}
                </a>
              </ContactCard>
            )}

            {m.correcting && (
              <div className="faq-chat-bubble faq-chat-ai faq-chat-editing faq-edit-form">
                <textarea
                  value={m.correctedText}
                  onChange={(e) =>
                    patchMessage(m.id, { correctedText: e.target.value })
                  }
                  rows={4}
                  autoFocus
                />
                <div className="faq-edit-actions">
                  <button
                    type="button"
                    className="faq-btn faq-btn-ghost"
                    onClick={() => patchMessage(m.id, { correcting: false })}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="faq-btn faq-btn-primary"
                    disabled={m.saving}
                    onClick={() => saveCorrection(m)}
                  >
                    {m.saving ? "Saving..." : "Save improved answer"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        {showContactCard && (
          <ContactCard
            key={callAsked ? "call" : "prompt"}
            startOpen={callAsked}
            initialName={knownName}
            onSave={saveContact}
            onDismiss={dismissContact}
          />
        )}
        {showNameCard && (
          <NameCard
            onSave={saveName}
            onDismiss={() => updateNamePrefs({ dismissed: true })}
          />
        )}
        {contactThanks && (
          <div className="faq-chat-bubble faq-chat-ai">{contactThanks}</div>
        )}
      </div>

      <form onSubmit={send} className="faq-chat-input-row">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            customer
              ? TEXTS.inputPlaceholder
              : "Type a question like a customer would…"
          }
        />
        <button type="submit" className="faq-chat-send-btn" aria-label="Send">
          {customer ? <ArrowUp size={18} /> : <Send size={15} />}
        </button>
      </form>
      </>
      )}
    </div>
    </>
  );
};

export default AskAi;
