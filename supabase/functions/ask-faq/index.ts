// Supabase Edge Function: ask-faq
//
// Answers a free-text question using only the content already in the
// `faqs` table plus the live Shopify online-store catalog, via Google
// Gemini's free tier. The Gemini API key lives
// in a Supabase secret (GEMINI_API_KEY) set with `supabase secrets set`
// and is never sent to the browser — this function is the only thing
// that ever sees it.
//
// Deploy: supabase functions deploy ask-faq
// Requires the secret: supabase secrets set GEMINI_API_KEY=your-key
//
// Run locally (no Supabase CLI needed): put SUPABASE_URL, SUPABASE_ANON_KEY
// and GEMINI_API_KEY in supabase/functions/.env.local, then
//   npm run dev:ai
// and set VITE_ASK_FAQ_URL=http://localhost:8000 in .env.local so the dev
// site's Ask AI talks to it.

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

// Products come from Shopify's public storefront feed, which only lists
// products published to the Online Store channel, so POS-only items never
// show up here. No token needed.
const STORE_URL = "https://www.wareinnovations.com";

// Tried in order; later ones are fallbacks for when Gemini is overloaded.
const GEMINI_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
];
const PRODUCT_CACHE_MS = 10 * 60 * 1000;
// Checkout helpers that live in the feed but aren't real products.
const EXCLUDED_TITLES = new Set(["Partial Payment"]);

type Product = {
  title: string;
  type: string;
  tags: string[];
  url: string;
  prices: string;
  description: string;
  searchText: string;
};

let productCache: { at: number; products: Product[] } | null = null;

function stripHtml(html: string) {
  return (html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z#0-9]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// deno-lint-ignore no-explicit-any
function toProduct(p: any): Product {
  // "Home & Garden > ... > Bowls" -> "Bowls"
  const type = (p.product_type || "").split(/[<>]/).pop().trim();
  // deno-lint-ignore no-explicit-any
  const prices = (p.variants ?? []).map((v: any) => {
    const label = v.title === "Default Title" ? "" : `${v.title} `;
    const soldOut = v.available ? "" : " (sold out)";
    return `${label}Rs ${Math.round(Number(v.price))}${soldOut}`;
  }).join("; ");
  const description = stripHtml(p.body_html);
  return {
    title: p.title,
    type,
    tags: p.tags ?? [],
    url: `${STORE_URL}/products/${p.handle}`,
    prices,
    description,
    searchText: `${p.title} ${type} ${(p.tags ?? []).join(" ")} ${description}`
      .toLowerCase(),
  };
}

async function loadProducts(): Promise<Product[]> {
  if (productCache && Date.now() - productCache.at < PRODUCT_CACHE_MS) {
    return productCache.products;
  }
  // deno-lint-ignore no-explicit-any
  const raw: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`${STORE_URL}/products.json?limit=250&page=${page}`);
    if (!res.ok) throw new Error(`Shopify feed returned ${res.status}`);
    const { products } = await res.json();
    raw.push(...products);
    if (products.length < 250) break;
  }
  const products = raw
    .filter((p) => !EXCLUDED_TITLES.has(p.title))
    .map(toProduct);
  productCache = { at: Date.now(), products };
  return products;
}

const STOPWORDS = new Set(
  ("the and for with you your have has what which are any can do does how " +
    "much many that this there from about want need show tell me some one " +
    "get give like looking price cost").split(" "),
);

// Cheap keyword match so the full descriptions of the few products the
// question is actually about fit in the prompt, instead of all ~600.
function relevantProducts(products: Product[], question: string, limit = 12) {
  const words = question.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const terms = [...new Set(words)].filter(
    (w) => w.length >= 3 && !STOPWORDS.has(w),
  );
  if (!terms.length) return [];
  return products
    .map((p) => {
      const title = p.title.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (title.includes(t)) score += 3;
        else if (p.searchText.includes(t)) score += 1;
      }
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p);
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

    // If Shopify is down, still answer from the FAQs alone.
    let products: Product[] = [];
    try {
      products = await loadProducts();
    } catch (err) {
      console.error("Product feed failed:", err);
    }

    const catalog = products
      .map((p) => `${p.title} | ${p.type || "Other"} | ${p.prices} | ${p.url}`)
      .join("\n");

    const details = relevantProducts(products, question)
      .map((p) =>
        `${p.title}\nType: ${p.type || "Other"}\nPrice: ${p.prices}\nTags: ${
          p.tags.join(", ")
        }\nLink: ${p.url}\nDescription: ${p.description}`
      )
      .join("\n\n");

    const prompt = `You are a helpful assistant answering questions about Ware Innovations, a ceramic tableware brand, using ONLY the FAQ content and product catalog below.

Keep replies as short as the moment calls for:
- Greetings or small talk ("hi", "thanks", "ok") get a brief, friendly line back. Don't summarize the FAQ or introduce yourself.
- Simple questions get a sentence or two.
- Only go longer (a short paragraph, or a few lines) when the question genuinely needs the detail, like a pricing breakdown with multiple tiers.

Answer in a friendly, conversational tone, like you're explaining it to someone new. Write in plain text only, no markdown — don't use asterisks for bold or italics, and don't use em dashes. If you need a list, write it as plain lines or "1., 2., 3." rather than markdown bullets. Don't repeat the question back before answering it. If the answer isn't covered in the FAQ content or catalog, say so honestly in one line and suggest they contact the team directly, don't make anything up.

When the question is about products, recommend real ones from the catalog by their exact name, with the price, and put the product link on its own line so it's clickable. Suggest at most 3 or 4 products unless they ask for more. Prices are in Indian Rupees. If something is marked sold out, say so. Only mention products that appear in the catalog.

FAQ content:
${context}

Product catalog (every product currently on the online store; name | type | price | link):
${catalog}

Full details for the products that best match this question:
${details || "(none matched by keyword, use the catalog above)"}

Question: ${question}

Answer:`;

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return json({ error: "AI is not configured yet" }, 500);
    }

    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      // A safety cap, not the main lever — the prompt above is what
      // actually teaches it to keep short answers short. Set high
      // enough to leave room for this model's invisible "thinking"
      // tokens too (they share this same budget, and a low cap here
      // was silently truncating real answers before the fix).
      generationConfig: { maxOutputTokens: 2048 },
    });

    // Free-tier models regularly return 503 "high demand" (or 429) on
    // big prompts like ours; fall through to the next model instead of
    // failing the whole answer.
    let res: Response | null = null;
    for (const model of GEMINI_MODELS) {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body },
      );
      if (res.ok) break;
      console.error(`Gemini ${model} error:`, await res.text());
      if (res.status !== 503 && res.status !== 429) break;
    }

    if (!res?.ok) {
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
