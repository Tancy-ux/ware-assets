import { getVisitorId } from "../../src/lib/visitorId";
import { readCart, sendVisit } from "./api";

// Stats -> Journeys: where shoppers go after tapping the chat button. Only
// someone who tapped it is followed, and only for TRACK_DAYS after their
// last tap; everyone else is never recorded. Saved per event (ask-faq
// "visit", scripts/supabase-chat-visits.sql): the tap itself, each page
// they open, adding to cart, and tapping a checkout button. Just the page
// path and their cart's item count / total; nothing they type.

const TAP_KEY = "wareChatTappedAt";
const TRACK_DAYS = 30;

const tappedRecently = () => {
  try {
    const at = Number(localStorage.getItem(TAP_KEY));
    return at > 0 && Date.now() - at < TRACK_DAYS * 864e5;
  } catch {
    return false;
  }
};

const send = (kind, cart) =>
  sendVisit({
    visitorId: getVisitorId(),
    kind,
    page: location.pathname,
    ...(cart ? { cart } : {}),
  });

// The checkout buttons on the cart page and drawer (name="checkout"), links
// to checkout, and Shopify's "Buy it now" / Shop Pay buttons. Payment
// buttons drawn inside their own frame (PayPal) can't be seen from here.
const CHECKOUT_SELECTOR = [
  '[name="checkout"]',
  'a[href*="/checkout"]',
  ".shopify-payment-button",
  ".additional-checkout-buttons",
  "shopify-accelerated-checkout",
  "shopify-accelerated-checkout-cart",
].join(",");

// Any request the theme (or the chat) makes to add to the cart.
const CART_ADD_RE = /\/cart\/add(\.js|\.json)?(\?|$)/;
// Several adds in a row (or Shopify retrying) are one "added to cart".
const CART_SETTLE_MS = 1000;
const CHECKOUT_GAP_MS = 5000;

let watching = false;
const watch = () => {
  if (watching) return;
  watching = true;

  // Adding to cart doesn't always open a new page (the drawer), so the
  // request itself is the sign. The cart is read once it's settled.
  if ("PerformanceObserver" in window) {
    let timer = null;
    try {
      new PerformanceObserver((list) => {
        if (!list.getEntries().some((e) => CART_ADD_RE.test(e.name))) return;
        clearTimeout(timer);
        timer = setTimeout(() => readCart().then((cart) => send("cart", cart)), CART_SETTLE_MS);
      }).observe({ type: "resource" });
    } catch {
      // Older browsers: the next page view still shows their cart.
    }
  }

  // Sent straight away (no cart read): the page is about to go.
  let checkoutAt = 0;
  const onCheckout = (e) => {
    const hit =
      e.composedPath().some((el) => el instanceof Element && el.matches(CHECKOUT_SELECTOR)) ||
      (e.type === "submit" &&
        (e.submitter?.name === "checkout" ||
          /\/checkout/.test(e.target.getAttribute?.("action") ?? "")));
    if (!hit || Date.now() - checkoutAt < CHECKOUT_GAP_MS) return;
    checkoutAt = Date.now();
    send("checkout");
  };
  document.addEventListener("click", onCheckout, true);
  document.addEventListener("submit", onCheckout, true);
};

// They tapped the chat button: (re)starts the TRACK_DAYS and records where.
export const trackTap = () => {
  try {
    localStorage.setItem(TAP_KEY, String(Date.now()));
  } catch {
    // Storage off: just this page then.
  }
  send("open");
  const root = window.Shopify?.routes?.root;
  if (root) {
    fetch(`${root}cart/update.js`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ attributes: { _ware_chat: getVisitorId() } }),
    }).catch(() => {});
  }

  watch();
};

// Every page load: carries on following someone who tapped recently.
export const startTracking = () => {
  if (!tappedRecently()) return;
  readCart().then((cart) => send("page", cart));
  watch();
};
