import { supabase } from "../components/supabase";

// Set in .env.local (dev only) to test a locally running ask-faq function
// instead of the deployed one — see the note at the top of that function.
const LOCAL_ASK_FAQ_URL = import.meta.env.VITE_ASK_FAQ_URL;

// Calls the ask-faq Supabase function. Same { data, error } shape either
// way, so callers don't care which one answered.
export const callAskFaq = async (body) => {
  if (!LOCAL_ASK_FAQ_URL) {
    return supabase.functions.invoke("ask-faq", { body });
  }
  try {
    const res = await fetch(LOCAL_ASK_FAQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { data: await res.json(), error: null };
  } catch (error) {
    return { data: null, error };
  }
};
