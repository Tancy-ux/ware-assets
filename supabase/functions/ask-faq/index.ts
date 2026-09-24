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
  nameWords: Set<string>;
  colors: Set<string>;
  keyTags: Set<string>;
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
  // Sold-out cards only: in-stock alternatives the UI offers behind a
  // "see similar" button, picked by similarProducts() below.
  similar?: ProductCard[];
};

const MAX_CARDS = 6;
const MAX_SIMILAR = 4;

// Colour words used in product names, grouped into families so "Sage"
// counts as close to "Lime Green". Anything not listed here is treated as
// part of the product's name (collection + item).
const COLOR_FAMILIES: Record<string, string> = {
  green: "green", sage: "green", lime: "green", mint: "green", verde: "green",
  blue: "blue", aqua: "blue", pacific: "blue", midnight: "blue", stormy: "blue",
  black: "black", onyx: "black", nero: "black",
  white: "white", nude: "neutral", tan: "neutral", caramel: "neutral",
  brown: "brown", warm: "brown", burnt: "brown",
  pink: "pink", blush: "pink", rose: "pink", misty: "pink", lilac: "pink",
  red: "red", maroon: "red", melon: "orange", orange: "orange",
  yellow: "yellow", lemon: "yellow", mustard: "yellow", ochre: "yellow",
  gold: "metal", silver: "metal", grey: "grey", gray: "grey",
};
// Words that describe a colour or finish without naming the product.
const SHADE_WORDS = new Set(["deep", "matt", "gloss"]);
const NAME_FILLER = new Set(
  "set of the and with without pieces piece in for a".split(" "),
);

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
    ...splitTitle(p.title),
    keyTags: new Set(), // filled in by loadProducts once all tags are known
  };
}

// "Pod 90ml Espresso Cup Matt Tan (Set of 2) - Gift Set" ->
//   nameWords {pod, espresso, cup, gift}, colors {neutral}
function splitTitle(title: string) {
  const words = title.toLowerCase().match(/[a-z]+/g) ?? [];
  const nameWords = new Set<string>();
  const colors = new Set<string>();
  for (const w of words) {
    if (COLOR_FAMILIES[w]) colors.add(COLOR_FAMILIES[w]);
    else if (!SHADE_WORDS.has(w) && !NAME_FILLER.has(w) && w !== "ml") {
      nameWords.add(w);
    }
  }
  return { nameWords, colors };
}

function overlap(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared);
}

// In-stock alternatives to a (usually sold-out) product. All signals
// count at once, weighted in priority order: name (same collection/item)
// > type > price > shared distinctive tags > colour.
function similarProducts(target: Product, products: Product[]) {
  return products
    .filter((p) => p.available && p.handle !== target.handle)
    .map((p) => {
      const priceGap = Math.abs(p.minPrice - target.minPrice) /
        Math.max(p.minPrice, target.minPrice, 1);
      const score = 4 * overlap(p.nameWords, target.nameWords) +
        3 * (p.type && p.type === target.type ? 1 : 0) +
        2 * Math.max(0, 1 - priceGap) +
        1.5 * overlap(p.keyTags, target.keyTags) +
        1 * overlap(p.colors, target.colors);
      return { p, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SIMILAR)
    .map((x) => x.p);
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
  // Tags on a big share of the catalog (active, google, ceramic, sale
  // tags...) say nothing about similarity; keep only the distinctive ones.
  const tagCount = new Map<string, number>();
  for (const p of products) {
    for (const t of p.tags) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  }
  for (const p of products) {
    p.keyTags = new Set(
      p.tags.filter((t) => (tagCount.get(t) ?? 0) < products.length * 0.15),
    );
  }
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

// Returns the model's text, or null if every model failed. Free-tier
// models regularly return 503 "high demand" (or 429) on big prompts like
// ours; fall through to the next model instead of failing outright.
async function callGemini(key: string, body: string): Promise<string | null> {
  for (const model of GEMINI_MODELS) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body },
    );
    if (res.ok) {
      const result = await res.json();
      return result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
    }
    console.error(`Gemini ${model} error:`, await res.text());
    if (res.status !== 503 && res.status !== 429) return null;
  }
  return null;
}

const MAX_RULE_CHARS = 400;
const MAX_NOTE_CHARS = 3000;

// "Improve AI" panel: turns a team member's rough note into clear,
// standalone rules for them to review before saving. Nothing is stored
// here; the panel saves what they approve.
async function tidyGuideline(key: string, note: string) {
  const prompt = `A team member at Ware Innovations (a ceramic tableware brand) typed the note below to change how their customer-facing chat assistant behaves. It may be rough, run-on, or full of shorthand.

Rewrite it as one or more clear, short instructions addressed to the assistant, in plain English. Each instruction must stand on its own and be under ${MAX_RULE_CHARS} characters. Split unrelated points into separate instructions; keep related ones together. Keep the team member's meaning exactly. Don't add requirements they didn't state, and don't soften or strengthen them.

Also write "note": one short sentence for the team member ONLY if something is worth flagging, otherwise an empty string. Flag it if the note:
- mentions a specific product's stock, price or availability (those change, and the assistant already gets them live from the store), or
- is about one particular customer or conversation rather than how to treat customers in general, or
- is too unclear to turn into an instruction (then say what's unclear).

Team member's note:
${note}`;

  const text = await callGemini(key, JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          rules: { type: "ARRAY", items: { type: "STRING" } },
          note: { type: "STRING" },
        },
        required: ["rules", "note"],
      },
    },
  }));
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text);
    return {
      rules: (Array.isArray(parsed.rules) ? parsed.rules : [])
        .filter((r: unknown) => typeof r === "string" && r.trim())
        .map((r: string) => r.trim().slice(0, MAX_RULE_CHARS)),
      note: typeof parsed.note === "string" ? parsed.note.trim() : "",
    };
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const payload = await req.json();

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return json({ error: "AI is not configured yet" }, 500);
    }

    if (payload.mode === "tidy") {
      const note = typeof payload.note === "string" ? payload.note.trim() : "";
      if (!note) return json({ error: "Missing note" }, 400);
      const tidied = await tidyGuideline(
        geminiKey,
        note.slice(0, MAX_NOTE_CHARS),
      );
      return tidied
        ? json(tidied)
        : json({ error: "AI request failed" }, 502);
    }

    const { question, history: rawHistory } = payload;
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

    // Team-written rules from the "Improve AI" panel. If the table is
    // missing or unreachable, answer without them rather than failing.
    const { data: guidelineRows, error: guidelineError } = await supabase
      .from("ai_guidelines")
      .select("rule")
      .eq("enabled", true)
      .order("created_at");
    if (guidelineError) console.error("Guidelines failed:", guidelineError);
    const guidelines = (guidelineRows ?? [])
      .map((g) => `- ${String(g.rule).slice(0, MAX_RULE_CHARS)}`)
      .join("\n");

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

If someone asks about a specific product that's sold out, still include it in "products" and lead with the positive, then the stock status, for example: "The Bites and Delights Lime Green is a lovely pick for corporate gifting, but it's currently sold out." Don't suggest alternatives to it yourself and don't ask whether they'd like to see similar items; the app automatically offers similar in-stock products under a sold-out card. Pre-orders aren't available, and never promise a restock or a date. A sold-out card has a "Check restock" button where they can leave their details for the team to check; mention it only if they ask when it'll be back.

Earlier replies of yours in this chat may end with a note like "(Product cards shown: ...)"; that's what the person saw under that reply, so "the second one" or "that set" refers to those.
${
      guidelines
        ? `
Team guidelines. The Ware team added these to fine-tune how you answer; follow them. If one ever conflicts with the rules above (only use the FAQ and catalog, never invent products or facts, reply in the JSON format described), the rules above win.
${guidelines}
`
        : ""
    }
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

    const text = await callGemini(geminiKey, body);
    if (text === null) {
      return json({ error: "AI request failed" }, 502);
    }

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
      .map((p) => {
        const card = toCard(p);
        if (!p.available) {
          card.similar = similarProducts(p, products)
            .filter((s) => !budget || s.minPrice < budget)
            .map(toCard);
        }
        return card;
      });

    return json({ answer, products: cards });
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong" }, 500);
  }
});
