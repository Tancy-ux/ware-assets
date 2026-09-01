// Supabase Edge Function: ask-faq
//
// Answers a free-text question using only the content already in the
// `faqs` table, via Google Gemini's free tier. The Gemini API key lives
// in a Supabase secret (GEMINI_API_KEY) set with `supabase secrets set`
// and is never sent to the browser — this function is the only thing
// that ever sees it.
//
// Deploy: supabase functions deploy ask-faq
// Requires the secret: supabase secrets set GEMINI_API_KEY=your-key

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const { question } = await req.json();
    if (!question || typeof question !== "string" || !question.trim()) {
      return json({ error: "Missing question" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    );

    // Same content the FAQ page itself shows publicly — no internal /
    // deleted rows leak into what the model gets to see.
    const { data: faqs, error } = await supabase
      .from("faqs")
      .select("category, question, answer")
      .eq("deleted", false)
      .eq("internal", false);

    if (error) throw error;

    const context = (faqs ?? [])
      .map((f) => `Category: ${f.category}\nQ: ${f.question}\nA: ${f.answer}`)
      .join("\n\n");

    const prompt = `You are a helpful assistant answering questions about Ware Innovations, a ceramic tableware brand, using ONLY the FAQ content below.

Keep replies as short as the moment calls for:
- Greetings or small talk ("hi", "thanks", "ok") get a brief, friendly line back. Don't summarize the FAQ or introduce yourself.
- Simple questions get a sentence or two.
- Only go longer (a short paragraph, or a few lines) when the question genuinely needs the detail, like a pricing breakdown with multiple tiers.

Answer in a friendly, conversational tone, like you're explaining it to someone new. Don't use em dashes. Don't repeat the question back before answering it. If the answer isn't covered in the FAQ content, say so honestly in one line and suggest they contact the team directly, don't make anything up.

FAQ content:
${context}

Question: ${question}

Answer:`;

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return json({ error: "AI is not configured yet" }, 500);
    }

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          // A safety cap, not the main lever — the prompt above is what
          // actually teaches it to keep short answers short. Set high
          // enough to leave room for this model's invisible "thinking"
          // tokens too (they share this same budget, and a low cap here
          // was silently truncating real answers before the fix).
          generationConfig: { maxOutputTokens: 2048 },
        }),
      },
    );

    if (!res.ok) {
      console.error("Gemini error:", await res.text());
      return json({ error: "AI request failed" }, 502);
    }

    const result = await res.json();
    const answer =
      result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ??
      "Sorry, I couldn't come up with an answer just now.";

    return json({ answer });
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong" }, 500);
  }
});
