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
  handle: string;
  title: string;
  type: string;
  tags: string[];
  url: string;
  image: string | null;
  prices: string;
  minPrice: number;
  maxPrice: number;
  available: boolean;
  // Only set when there's exactly one variant, so "Add to cart" needs no
  // size/colour choice; multi-variant products link to their page instead.
  variantId: number | null;
  description: string;
  searchText: string;
};

// What the chat UI renders as a product card. Every field comes straight
// from Shopify, never from the model.
type ProductCard = {
  title: string;
  price: string;
  image: string | null;
  url: string;
  cartUrl: string | null;
  available: boolean;
};

const MAX_CARDS = 6;

// `products` are the titles of the cards shown under that answer.
type Turn = { question: string; answer: string; products: string[] };
const MAX_HISTORY_TURNS = 10;
const MAX_TURN_CHARS = 2000;

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
  // deno-lint-ignore no-explicit-any
  const variantPrices = (p.variants ?? []).map((v: any) => Number(v.price));
  const image = p.images?.[0]?.src;
  return {
    handle: p.handle,
    title: p.title,
    type,
    tags: p.tags ?? [],
    url: `${STORE_URL}/products/${p.handle}`,
    // Shopify's CDN resizes on the fly; cards are small.
    image: image ? `${image}${image.includes("?") ? "&" : "?"}width=300` : null,
    prices,
    minPrice: Math.min(...variantPrices),
    maxPrice: Math.max(...variantPrices),
    // deno-lint-ignore no-explicit-any
    available: (p.variants ?? []).some((v: any) => v.available),
    variantId: p.variants?.length === 1 ? p.variants[0].id : null,
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

const formatRupees = (n: number) => `Rs ${Math.round(n).toLocaleString("en-IN")}`;

function toCard(p: Product): ProductCard {
  return {
    title: p.title,
    price: p.minPrice === p.maxPrice
      ? formatRupees(p.minPrice)
      : `From ${formatRupees(p.minPrice)}`,
    image: p.image,
    url: p.url,
    // Shopify's /cart/add adds the item to the shopper's cart on the store
    // and redirects to /cart.
    cartUrl: p.available && p.variantId
      ? `${STORE_URL}/cart/add?id=${p.variantId}&quantity=1`
      : null,
    available: p.available,
  };
}

// The most recent "under 2000" / "below 5k" / "less than ₹1500" in the
// text, as a number of rupees.
function maxBudget(text: string): number | null {
  const re =
    /\b(?:under|below|less than|within|upto|up to|max(?:imum)?)\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d+)?)\s*(k)?\b/gi;
  let last: number | null = null;
  for (const m of text.matchAll(re)) {
    const n = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
    if (n > 0) last = n;
  }
  return last;
}

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
    const { question, history: rawHistory } = await req.json();
    if (!question || typeof question !== "string" || !question.trim()) {
      return json({ error: "Missing question" }, 400);
    }

    // Earlier turns of this chat, so the model can follow along ("I
    // already said corporate gifting") instead of treating every message
    // as brand new. Capped so a long chat can't blow up the prompt.
    const history: Turn[] = (Array.isArray(rawHistory) ? rawHistory : [])
      .filter((t) =>
        typeof t?.question === "string" && typeof t?.answer === "string"
      )
      .slice(-MAX_HISTORY_TURNS)
      .map((t) => ({
        question: t.question.slice(0, MAX_TURN_CHARS),
        answer: t.answer.slice(0, MAX_TURN_CHARS),
        products: (Array.isArray(t.products) ? t.products : [])
          .filter((name: unknown) => typeof name === "string")
          .slice(0, MAX_CARDS),
      }));

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

    // The model refers to products by handle only; links, images and
    // prices for the cards are filled in from Shopify afterwards.
    const catalog = products
      .map((p) => `${p.handle} | ${p.title} | ${p.type || "Other"} | ${p.prices}`)
      .join("\n");

    // Match on recent questions too, so a follow-up like "under 2000?"
    // still pulls in the cups/vases/etc. the chat is about.
    const searchQuery = [
      ...history.slice(-2).map((t) => t.question),
      question,
    ].join(" ");

    // Enforce "under 2000"-style budgets in code; the fallback models
    // don't reliably respect them from the prompt alone.
    const budget = maxBudget(searchQuery);
    const matches = relevantProducts(products, searchQuery, budget ? 40 : 12)
      .filter((p) => !budget || p.minPrice < budget)
      .slice(0, 12);

    const details = matches
      .map((p) =>
        `${p.title}\nID: ${p.handle}\nType: ${p.type || "Other"}\nPrice: ${p.prices}\nTags: ${
          p.tags.join(", ")
        }\nDescription: ${p.description}`
      )
      .join("\n\n");

    const systemPrompt = `You are a helpful assistant answering questions about Ware Innovations, a ceramic tableware brand, using ONLY the FAQ content and product catalog below.

This is an ongoing conversation. Read the whole chat before replying and carry everything the person has already told you forward: who they are (for example a company doing corporate gifting, a restaurant or hotel, or someone shopping for their home), the occasion, budget, quantity, colours, and product types. Never ask for something they've already said. Build each reply on what came before, so a short follow-up like "under 2000?" or "in blue?" refines the earlier request instead of starting over.

Lean towards being useful straight away. If you have enough to make a reasonable suggestion, make it, and ask at most one short follow-up question only if it would genuinely change your recommendation. When you do need more, ask for just the one or two most important missing details.

Use what you know about them. For corporate or bulk gifting, favour gift sets and giftable items, and bring in anything the FAQ says about bulk orders, custom branding, gift wrapping, or volume pricing that's relevant. For restaurants, hotels or cafes, draw on the HoReCa FAQ content.

Keep replies as short as the moment calls for:
- Greetings or small talk ("hi", "thanks", "ok") get a brief, friendly line back. Don't summarize the FAQ or introduce yourself.
- Simple questions get a sentence or two.
- Only go longer (a short paragraph, or a few lines) when the question genuinely needs the detail, like a pricing breakdown with multiple tiers.

Answer in a friendly, conversational tone, like you're explaining it to someone new. Write in plain text only, no markdown — don't use asterisks for bold or italics, and don't use em dashes. If you need a list, write it as plain lines or "1., 2., 3." rather than markdown bullets. Don't repeat the question back before answering it. If the answer isn't covered in the FAQ content or catalog, say so honestly in one line and suggest they contact the team directly, don't make anything up.

Respond as JSON with two fields:
- "reply": your message, following all the rules above.
- "products": the IDs of the products you're recommending, best first, taken exactly from the catalog's first column. Use an empty list when you aren't recommending products.

Each product you list is shown under your reply as a card with its photo, name, live price, stock status, and an add to cart button, so don't write links or prices in the reply and don't list the products out again. Just talk about them naturally, for example why they suit this person, referring to them by name where it helps. Recommend 3 or 4 products unless they ask for more. Prices are in Indian Rupees. Treat budgets strictly: "under 2000" means below Rs 2000, so a Rs 2000 item doesn't qualify, and for sets use the set price as listed. Prefer products that are in stock. Only recommend products that appear in the catalog.

Earlier replies of yours in this chat may end with a note like "(Product cards shown: ...)"; that's what the person saw under that reply, so "the second one" or "that set" refers to those.

FAQ content:
${context}

Product catalog (every product currently on the online store; ID | name | type | price):
${catalog}

Full details for the products that best match the conversation so far:
${details || "(none matched by keyword, use the catalog above)"}${
      budget
        ? `\n\nThe person's budget is strictly under Rs ${budget}. Only suggest products priced below Rs ${budget}; anything at Rs ${budget} or more doesn't qualify.`
        : ""
    }`;

    const contents = [
      ...history.flatMap((t) => [
        { role: "user", parts: [{ text: t.question }] },
        {
          role: "model",
          parts: [{
            text: t.products.length
              ? `${t.answer}\n(Product cards shown: ${t.products.join("; ")})`
              : t.answer,
          }],
        },
      ]),
      { role: "user", parts: [{ text: question }] },
    ];

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return json({ error: "AI is not configured yet" }, 500);
    }

    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      // A safety cap, not the main lever — the prompt above is what
      // actually teaches it to keep short answers short. Set high
      // enough to leave room for this model's invisible "thinking"
      // tokens too (they share this same budget, and a low cap here
      // was silently truncating real answers before the fix).
      generationConfig: {
        maxOutputTokens: 2048,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            reply: { type: "STRING" },
            products: { type: "ARRAY", items: { type: "STRING" } },
          },
          required: ["reply", "products"],
        },
      },
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
    const text: string =
      result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    let answer = "";
    let picked: string[] = [];
    try {
      const parsed = JSON.parse(text);
      answer = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
      picked = Array.isArray(parsed.products) ? parsed.products : [];
    } catch {
      // Not JSON after all — show whatever it said, just without cards.
      answer = text;
    }
    if (!answer) answer = "Sorry, I couldn't come up with an answer just now.";

    // Resolve the model's picks against the real catalog: unknown IDs are
    // dropped, duplicates removed, and the budget is re-checked here too.
    const byHandle = new Map(products.map((p) => [p.handle, p]));
    const cards = [...new Set(picked)]
      .map((h) => byHandle.get(String(h).trim()))
      .filter((p): p is Product => !!p && (!budget || p.minPrice < budget))
      .slice(0, MAX_CARDS)
      .map(toCard);

    return json({ answer, products: cards });
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong" }, 500);
  }
});
