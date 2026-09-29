import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../src/lib/supabaseConfig";

// Stands in for src/lib/askFaq.js in the store build (see vite.config.js):
// same { data, error } shape, but a plain fetch instead of supabase-js, so
// the widget stays small. A `data-api` attribute on the script tag points
// it at a locally running function for testing.
const scriptApi = document.currentScript?.dataset.api;

export const callFunction = async (name, body) => {
  const url = scriptApi || `${SUPABASE_URL}/functions/v1/${name}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    return {
      data,
      error: res.ok ? null : new Error(data?.error ?? String(res.status)),
    };
  } catch (error) {
    return { data: null, error };
  }
};

// The store cart right now (item count and total in paise), for the Chats
// page's side panel. Never holds a message up for long: null if slow.
const CART_WAIT_MS = 700;
const readCart = () =>
  Promise.race([
    fetch("/cart.js", { headers: { Accept: "application/json" } })
      .then((res) => (res.ok ? res.json() : null))
      .then((cart) =>
        cart ? { count: cart.item_count, total: cart.total_price } : null,
      )
      .catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), CART_WAIT_MS)),
  ]);

// Calls that log a message (questions and pill taps), not polls or forms.
const LOGGED_MODES = [undefined, "similar", "bespoke"];

// Every chat call says which store page it came from (just the path), so
// the Chats page can show where conversations start.
export const callAskFaq = async (body) => {
  const cart = LOGGED_MODES.includes(body.mode) ? await readCart() : null;
  return callFunction("ask-faq", {
    ...body,
    page: location.pathname,
    ...(cart ? { cart } : {}),
  });
};
