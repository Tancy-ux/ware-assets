import { supabase } from "../components/supabase";

// Each function's local URL is set in .env.local (dev only) to test a
// locally running copy instead of the deployed one — see the note at the
// top of each function.
const LOCAL_URLS = {
  "ask-faq": import.meta.env.VITE_ASK_FAQ_URL,
  "chat-admin": import.meta.env.VITE_CHAT_ADMIN_URL,
};

// Calls a Supabase Edge Function. Same { data, error } shape either way,
// and `data` is filled in for error responses too, so callers can show
// the function's own message (e.g. "Wrong username or password").
export const callFunction = async (name, body) => {
  const localUrl = LOCAL_URLS[name];
  if (!localUrl) {
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error?.context?.json) {
      try {
        return { data: await error.context.json(), error };
      } catch {
        // Not JSON — fall through with just the error.
      }
    }
    return { data, error };
  }
  try {
    const res = await fetch(localUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return { data, error: res.ok ? null : new Error(data?.error ?? res.status) };
  } catch (error) {
    return { data: null, error };
  }
};

export const callAskFaq = (body) => callFunction("ask-faq", body);
