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

// Every chat call says which store page it came from (just the path), so
// the Chats page can show where conversations start.
export const callAskFaq = (body) =>
  callFunction("ask-faq", { ...body, page: location.pathname });
