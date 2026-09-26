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
const GEMINI_TIMEOUT_MS = 25_000;
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
  collection: string;
  typePath: string[];
  // Which of Ware's lines it belongs to. Similar products never cross
  // lines, and Atelier pieces are handled differently (no prices).
  line: "atelier" | "collectibles" | "marble" | "ceramic";
  keyTags: Set<string>;
  // Photos of this product's gift packaging (box, sleeve, hamper).
  giftImages: string[];
  // Tagged "gift-wrap" in Shopify. The model may only call something
  // gift-packed when this is set (see the prompt).
  giftPacked: boolean;
};

// A gift packaging photo shown in the chat instead of product cards.
type GiftImage = { src: string; productTitle: string; url: string };
const MAX_GIFT_IMAGES = 6;

// What the chat UI renders as a product card. Every field comes straight
// from Shopify, never from the model.
type ProductCard = {
  title: string;
  price: string;
  image: string | null;
  url: string;
  cartUrl: string | null;
  available: boolean;
  // Ware Atelier pieces only: made to order and customised, so no price or
  // stock status; the card's button opens a WhatsApp enquiry instead.
  enquireUrl?: string;
  // Sold-out cards only: in-stock alternatives the UI offers behind a
  // "see similar" button, picked by similarProducts() below.
  similar?: ProductCard[];
};

const MAX_CARDS = 6;
// The chat shows 4, then 6 per "Show more" (4 + 6 + 6).
const MAX_SIMILAR = 16;

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

// `products` are the titles of the cards shown under that answer;
// `fromTeam` marks a reply a team member typed during a takeover.
type Turn = {
  question: string;
  answer: string;
  products: string[];
  fromTeam: boolean;
};
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
  // The team tags every product that comes gift-packed with "gift-wrap"
  // in Shopify; that tag is the only source of truth for it.
  const giftPacked = (p.tags ?? []).some(
    (t: string) => t.toLowerCase() === GIFT_TAG,
  );
  // Gift photos only for tagged products, so a photo can never suggest
  // gift packaging the tag doesn't back up.
  const giftImages = giftPacked
    ? (p.images ?? [])
      // deno-lint-ignore no-explicit-any
      .filter((i: any) => isGiftImage(i.src))
      // deno-lint-ignore no-explicit-any
      .map((i: any) => resized(i.src, 600))
    : [];
  return {
    handle: p.handle,
    title: p.title,
    type,
    tags: p.tags ?? [],
    url: `${STORE_URL}/products/${p.handle}`,
    // Shopify's CDN resizes on the fly; cards are small.
    image: image ? resized(image, 300) : null,
    giftImages,
    giftPacked,
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
    line: productLine(p),
    typePath: (p.product_type || "")
      .split(/[<>]/)
      .map((s: string) => s.trim().toLowerCase())
      .filter(Boolean),
    keyTags: new Set(), // filled in by loadProducts once all tags are known
  };
}

// Ware Atelier comes in two kinds, both tagged by the team in Shopify:
//   "ware atelier" — custom bespoke marble furniture / lighting, customised
//                    per client: no prices, WhatsApp enquiry instead.
//   "collectibles" — one-of-a-kind marble vases, tissue boxes etc.,
//                    priced and sold normally.
// Other marble pieces (Lush trays, trivets, coasters) are marble
// tableware; everything else is the ceramic line.
// deno-lint-ignore no-explicit-any
function productLine(p: any): Product["line"] {
  const tags: string[] = (p.tags ?? []).map((t: string) =>
    t.toLowerCase().trim()
  );
  if (tags.includes("ware atelier")) return "atelier";
  if (tags.includes("collectibles")) return "collectibles";
  if (tags.includes("marble") || /\bmarble\b/i.test(p.title)) return "marble";
  return "ceramic";
}

const resized = (src: string, width: number) =>
  `${src}${src.includes("?") ? "&" : "?"}width=${width}`;

// Gift packaging photos are recognisable by file name today
// ("..._gift_box_front_shot.jpg", "gifting_sleeve.jpg") and by alt text
// once the team adds it in Shopify (checked in loadGiftAlts).
const GIFT_WORDS = /gift|hamper/i;
const GIFT_TAG = "gift-wrap";
function isGiftImage(src: string) {
  const file = decodeURIComponent(src.split("/").pop()?.split("?")[0] ?? "");
  return GIFT_WORDS.test(file);
}

// The bulk products.json feed leaves out image alt text, but each
// product's own .js endpoint includes it. Only fetched for the few
// products a gift packaging question is about, and cached.
const giftAltCache = new Map<string, { at: number; srcs: string[] }>();
async function loadGiftAlts(handle: string): Promise<string[]> {
  const cached = giftAltCache.get(handle);
  if (cached && Date.now() - cached.at < PRODUCT_CACHE_MS) return cached.srcs;
  try {
    const res = await fetch(`${STORE_URL}/products/${handle}.js`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const srcs: string[] = (data.media ?? [])
      // deno-lint-ignore no-explicit-any
      .filter((m: any) => m.src && m.alt && /gift|box|pack|wrap|hamper/i.test(m.alt))
      // deno-lint-ignore no-explicit-any
      .map((m: any) => resized(m.src.startsWith("//") ? `https:${m.src}` : m.src, 600));
    giftAltCache.set(handle, { at: Date.now(), srcs });
    return srcs;
  } catch {
    return [];
  }
}

// Gift packaging photos for a gift packaging question: the asked-about
// products' own photos (file name or alt text), or, for a general
// question, a few distinct examples from across the catalog. Empty when
// nothing real exists, so the reply stays text-only.
async function giftImagesFor(
  picked: Product[],
  products: Product[],
): Promise<GiftImage[]> {
  const out: GiftImage[] = [];
  const seen = new Set<string>();
  const add = (src: string, p: Product) => {
    // The same photo is often reused across products under different
    // Shopify file suffixes ("gifting_sleeve_4.jpg", "..._<uuid>.jpg").
    const key = decodeURIComponent(src.split("/").pop()?.split("?")[0] ?? "")
      .replace(/(_[0-9a-f-]{36}|_\d+)?\.\w+$/i, "");
    if (seen.has(key) || out.length >= MAX_GIFT_IMAGES) return;
    seen.add(key);
    out.push({ src, productTitle: p.title, url: p.url });
  };

  if (picked.length) {
    for (const p of picked.filter((p) => p.giftPacked).slice(0, 4)) {
      const fromAlt = await loadGiftAlts(p.handle);
      for (const src of [...p.giftImages, ...fromAlt]) add(src, p);
    }
    return out;
  }

  for (const p of products) {
    if (p.available && p.giftImages[0]) add(p.giftImages[0], p);
  }
  return out;
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
  // Ware names lead with the collection: "Pivot Big Main Course Serving
  // Set", "Whirl Bowl...", "030 Rosso Arc Marble..." (numbers skipped).
  // "Big & Small Whirl..." style names put a size word first, so skip
  // those too.
  const collection = words.find((w) => !SIZE_WORDS.has(w) && !NAME_FILLER.has(w)) ?? "";
  return { nameWords, colors, collection };
}

const SIZE_WORDS = new Set(["big", "small", "medium", "large", "mini"]);

function overlap(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return shared / (a.size + b.size - shared);
}

// Shopify types are paths ("Home & Garden > ... > Tableware > Serveware")
// and aren't always applied consistently (a Pivot serveware set is filed
// under "...Dinnerware > Bowls"), so related types get partial credit by
// how much of the path they share: 1 for the same type, ~0.6 for
// Serveware vs Bowls (both Tableware), ~0.2 for Serveware vs Vases.
function typeCloseness(a: string[], b: string[]) {
  if (!a.length || !b.length) return 0;
  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) {
    shared++;
  }
  return shared / Math.max(a.length, b.length);
}

// Like overlap(), but each word counts by how rare it is in the catalog,
// so a shared "pivot" (a handful of products) matters far more than a
// shared "serving" or "main course" (dozens).
function weightedOverlap(
  a: Set<string>,
  b: Set<string>,
  weight: (w: string) => number,
) {
  let shared = 0;
  let total = 0;
  for (const x of new Set([...a, ...b])) {
    const w = weight(x);
    total += w;
    if (a.has(x) && b.has(x)) shared += w;
  }
  return total ? shared / total : 0;
}

// In-stock alternatives to a (usually sold-out) product. All signals
// count at once, weighted in priority order: same collection and name
// (rare words count most) > type > price > shared distinctive tags >
// colour.
function similarProducts(target: Product, products: Product[]) {
  // How many products each name word appears in, for weighting.
  const df = new Map<string, number>();
  for (const p of products) {
    for (const w of p.nameWords) df.set(w, (df.get(w) ?? 0) + 1);
  }
  const weight = (w: string) => Math.log(products.length / (df.get(w) ?? 1));

  return products
    // Never across lines: a marble vase's alternatives are marble, a
    // ceramic cup's are ceramic, an Atelier piece's are Atelier.
    .filter((p) =>
      p.available && p.handle !== target.handle && p.line === target.line
    )
    .map((p) => {
      const priceGap = Math.abs(p.minPrice - target.minPrice) /
        Math.max(p.minPrice, target.minPrice, 1);
      const sameCollection = !!target.collection &&
        p.collection === target.collection;
      const typeScore = typeCloseness(p.typePath, target.typePath);
      // Some names span unrelated lines (ceramic Pivot tableware vs Pivot
      // marble vases and candle stands), so the collection bonus shrinks
      // when the types are far apart.
      const score = 5 * (sameCollection ? 0.4 + 0.6 * typeScore : 0) +
        4 * weightedOverlap(p.nameWords, target.nameWords, weight) +
        3 * typeScore +
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

// Ware Atelier's real prices never reach the model, so it can't quote one.
const priceForModel = (p: Product) =>
  p.line === "atelier"
    ? "Ware Atelier, made to order, price on request"
    : p.prices;

function toCard(p: Product): ProductCard {
  if (p.line === "atelier") {
    return {
      title: p.title,
      price: "Price on request",
      image: p.image,
      url: p.url,
      cartUrl: null,
      // Made to order: never shown as sold out, no "similar in stock".
      available: true,
      enquireUrl: atelierEnquiryUrl(p.title),
    };
  }
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
    let res: Response;
    try {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          // An overloaded model sometimes just hangs instead of returning
          // 503; give up on it and try the next one.
          signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        },
      );
    } catch (err) {
      console.error(`Gemini ${model} timed out / failed:`, err);
      continue;
    }
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WHATSAPP_NUMBER = "+919082820610";

// Enquiries the team should follow up on personally (bulk / corporate /
// custom / quotes / business orders / big quantities like "100 pcs").
const FOLLOW_UP_WORDS =
  /\b(bulk|corporate|wholesale|custom(ised|ized|ise|ize)?|personali[sz]ed?|branding|logo|quote|quotation|hamper|horeca|hotel|restaurant|cafe|caf[eé]|b2b)\b|\b\d{2,}\s*(pcs|pieces|units|qty|nos|boxes|sets|gifts)\b|\b(qty|quantity)\s*(of\s*)?\d{2,}/i;

const whatsAppLink = (text: string) =>
  `https://api.whatsapp.com/send/?${new URLSearchParams({
    phone: WHATSAPP_NUMBER,
    text,
    type: "phone_number",
    app_absent: "0",
  })}`;

// The "Enquire" button on a Ware Atelier card.
const atelierEnquiryUrl = (title: string) =>
  whatsAppLink(
    `Hi! I'm interested in the ${title} from Ware Atelier. ` +
      `Could you share pricing and customisation options?`,
  );

// e.g. "Hi! This is Priya from Fox Brains. I was chatting with the Ware
// Innovations assistant and would like to speak to someone from the
// team. I was looking at: Pivot Serveware Set Pacific Blue."
function buildWhatsAppUrl(ctx: {
  visitorName: string;
  company: string;
  products: string[];
}) {
  const who = ctx.visitorName && ctx.company
    ? ` This is ${ctx.visitorName} from ${ctx.company}.`
    : ctx.visitorName
    ? ` This is ${ctx.visitorName}.`
    : ctx.company
    ? ` I'm reaching out from ${ctx.company}.`
    : "";
  const products = [...new Set(ctx.products)].slice(0, 3);
  const text = `Hi!${who} I was chatting with the Ware Innovations assistant ` +
    `and would like to speak to someone from the team.` +
    (products.length ? ` I was looking at: ${products.join(", ")}.` : "");
  return whatsAppLink(text);
}

// Treats the model's "none" / "unknown" / "N/A" style answers as empty.
function cleanField(value: unknown) {
  const s = typeof value === "string" ? value.trim().slice(0, 100) : "";
  return /^(|none|unknown|n\/?a|null|not provided|not mentioned)$/i.test(s)
    ? ""
    : s;
}

// Columns added to chat_conversations after it first shipped. If the SQL
// script hasn't been re-run yet, save without them rather than failing.
const NEWER_COLUMNS = ["last_question", "visitor_phone"];

// deno-lint-ignore no-explicit-any
async function upsertConversation(admin: any, row: Record<string, string>) {
  let { error } = await admin
    .from("chat_conversations")
    .upsert(row, { onConflict: "id" });
  if (error?.code === "PGRST204") {
    const trimmed = { ...row };
    for (const c of NEWER_COLUMNS) delete trimmed[c];
    ({ error } = await admin
      .from("chat_conversations")
      .upsert(trimmed, { onConflict: "id" }));
  }
  if (error) throw error;
}

// ---- Human takeover (from the Chats page) ----
// A takeover lasts until the team hands back, TAKEOVER_HOURS pass, or the
// visitor types "reset" / clears the chat (see the "reset" mode).
const TAKEOVER_HOURS = 24;

function adminClient() {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return serviceKey
    ? createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey)
    : null;
}

const validIds = (conversationId: unknown, visitorId: unknown) =>
  typeof conversationId === "string" && UUID_RE.test(conversationId) &&
  typeof visitorId === "string" && UUID_RE.test(visitorId);

// The conversation row, only if it belongs to this visitor (both IDs are
// random UUIDs the browser holds, so one visitor can't read another's).
async function ownConversation(conversationId: unknown, visitorId: unknown) {
  const admin = adminClient();
  if (!admin || !validIds(conversationId, visitorId)) return null;
  const { data, error } = await admin
    .from("chat_conversations")
    .select("*")
    .eq("id", conversationId)
    .eq("visitor_id", visitorId)
    .maybeSingle();
  if (error) {
    console.error("Conversation lookup failed:", error);
    return null;
  }
  return data;
}

function takeoverActive(conversation: { takeover_at?: string | null } | null) {
  if (!conversation?.takeover_at) return false;
  const since = Date.now() - new Date(conversation.takeover_at).getTime();
  return since < TAKEOVER_HOURS * 60 * 60 * 1000;
}

// A customer message during a takeover: saved with no AI answer, for the
// team to reply to from the Chats page.
async function logCustomerMessage(
  conversationId: string,
  visitorId: string,
  question: string,
) {
  const admin = adminClient();
  if (!admin) return;
  await upsertConversation(admin, {
    id: conversationId,
    visitor_id: visitorId,
    last_message_at: new Date().toISOString(),
    last_question: question.slice(0, 300),
  });
  const { error } = await admin.from("chat_messages").insert({
    conversation_id: conversationId,
    question,
    answer: "",
    sender: "customer",
  });
  if (error) throw error;
}

// The name/phone a visitor types into the chat's "leave your details"
// card. Stored only on their conversation row (never kept in the
// browser), so deleting the chat in the Chats page forgets them for good.
function readContact(raw: unknown) {
  // deno-lint-ignore no-explicit-any
  const c = (raw ?? {}) as any;
  const name = typeof c.name === "string" ? c.name.trim().slice(0, 100) : "";
  const phone = typeof c.phone === "string" ? c.phone.trim().slice(0, 30) : "";
  return {
    name,
    // Loose check: people type +91, spaces, dashes.
    phone: phone.replace(/\D/g, "").length >= 7 ? phone : "",
  };
}

// Saves one question/answer to chat_conversations + chat_messages for the
// Chats page. Uses the service role key, since those tables have no anon
// access at all. Skipped quietly if the key or IDs are missing (e.g. a
// local run without the key set).
async function logTurn(turn: {
  conversationId: unknown;
  visitorId: unknown;
  question: string;
  answer: string;
  cards: ProductCard[];
  visitorName: string;
  company: string;
  isFirst: boolean;
}) {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const { conversationId, visitorId } = turn;
  if (
    !serviceKey ||
    typeof conversationId !== "string" || !UUID_RE.test(conversationId) ||
    typeof visitorId !== "string" || !UUID_RE.test(visitorId)
  ) {
    return;
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);
  const now = new Date().toISOString();

  // Only overwrite name/company when the model actually found one, so a
  // later turn with nothing new doesn't blank them out.
  const conversation: Record<string, string> = {
    id: conversationId,
    visitor_id: visitorId,
    last_message_at: now,
  };
  if (turn.visitorName) conversation.visitor_name = turn.visitorName;
  if (turn.company) conversation.company = turn.company;
  if (turn.isFirst) conversation.first_question = turn.question.slice(0, 300);
  conversation.last_question = turn.question.slice(0, 300);

  await upsertConversation(admin, conversation);

  const { error: msgError } = await admin.from("chat_messages").insert({
    conversation_id: conversationId,
    question: turn.question,
    answer: turn.answer,
    products: turn.cards.map((c) => ({
      title: c.title,
      url: c.url,
      available: c.available,
    })),
  });
  if (msgError) throw msgError;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  try {
    const payload = await req.json();

    // The chat window checking in: is the team handling this chat, and
    // have they replied since `after`? Cheap (no AI), so it can poll.
    if (payload.mode === "updates") {
      const conversation = await ownConversation(
        payload.conversationId,
        payload.visitorId,
      );
      if (!conversation) return json({ takeover: false, messages: [] });
      const admin = adminClient()!;
      let query = admin
        .from("chat_messages")
        .select("id, answer, created_at")
        .eq("conversation_id", conversation.id)
        .eq("sender", "agent")
        .order("created_at", { ascending: true })
        .limit(50);
      if (typeof payload.after === "string" && !isNaN(Date.parse(payload.after))) {
        query = query.gt("created_at", payload.after);
      }
      const { data, error } = await query;
      if (error) console.error("Team replies lookup failed:", error);
      return json({
        takeover: takeoverActive(conversation),
        messages: data ?? [],
      });
    }

    // The visitor typed "reset" or cleared the chat. It's still the same
    // conversation in the Chats page, so: end any takeover, and leave a
    // marker in the transcript showing where they started over.
    if (payload.mode === "reset") {
      const conversation = await ownConversation(
        payload.conversationId,
        payload.visitorId,
      );
      if (!conversation) return json({ ok: true });
      const admin = adminClient()!;
      await admin
        .from("chat_conversations")
        .update({ takeover_at: null })
        .eq("id", conversation.id);
      await admin.from("chat_messages").insert({
        conversation_id: conversation.id,
        question: "",
        answer: "Visitor reset the chat",
        sender: "system",
      });
      return json({ ok: true });
    }

    // The chat's "leave your details" card: attach name + phone to the
    // current conversation straight away (no AI involved).
    if (payload.mode === "contact") {
      const contact = readContact(payload.contact);
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const { conversationId, visitorId } = payload;
      if (!contact.phone) return json({ error: "Invalid phone number" }, 400);
      if (
        !serviceKey ||
        typeof conversationId !== "string" || !UUID_RE.test(conversationId) ||
        typeof visitorId !== "string" || !UUID_RE.test(visitorId)
      ) {
        return json({ error: "Can't save details right now" }, 400);
      }
      const row: Record<string, string> = {
        id: conversationId,
        visitor_id: visitorId,
        visitor_phone: contact.phone,
      };
      if (contact.name) row.visitor_name = contact.name;
      await upsertConversation(
        createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey),
        row,
      );
      return json({ ok: true });
    }

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
        fromTeam: t.fromTeam === true,
      }));

    // A team member has taken this chat over from the Chats page: the AI
    // stays quiet, and the message is saved for them to answer.
    // One conversation per visitor, holding the details they left (name /
    // phone) and any takeover. Null for a brand-new (or deleted) visitor.
    const conversation = await ownConversation(
      payload.conversationId,
      payload.visitorId,
    );
    const contactSaved = !!conversation?.visitor_phone;

    if (takeoverActive(conversation)) {
      try {
        await logCustomerMessage(
          payload.conversationId,
          payload.visitorId,
          question,
        );
      } catch (err) {
        console.error("Chat log failed:", err);
      }
      return json({ takeover: true, contactSaved });
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
      .map((p) =>
        `${p.handle} | ${p.title} | ${p.type || "Other"} | ${priceForModel(p)}${
          p.giftPacked ? " | gift-packed" : ""
        }`
      )
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
        `${p.title}\nID: ${p.handle}\nType: ${p.type || "Other"}\nPrice: ${
          priceForModel(p)
        }\nGift packaging: ${
          p.giftPacked ? "yes" : "no"
        }\nTags: ${
          p.tags.join(", ")
        }\nDescription: ${p.description}`
      )
      .join("\n\n");

    const systemPrompt = `You are a helpful assistant answering questions about Ware Innovations, a ceramic tableware brand, using ONLY the FAQ content and product catalog below.

This is an ongoing conversation. Read the whole chat before replying and carry everything the person has already told you forward: who they are (for example a company doing corporate gifting, a restaurant or hotel, or someone shopping for their home), the occasion, budget, quantity, colours, and product types. Never ask for something they've already said. Build each reply on what came before, so a short follow-up like "under 2000?" or "in blue?" refines the earlier request instead of starting over.

Lean towards being useful straight away. If you have enough to make a reasonable suggestion, make it, and ask at most one short follow-up question only if it would genuinely change your recommendation. When you do need more, ask for just the one or two most important missing details.

Use what you know about them. For corporate or bulk gifting, favour gift sets and giftable items, and bring in the one or two FAQ details (bulk orders, custom branding, gift wrapping, volume pricing) that matter most for what they just asked.

Keep replies short, like a helpful person texting on WhatsApp:
- Most replies are 1 to 3 short sentences, around 40 words or less.
- Greetings or small talk ("hi", "thanks", "ok") get one brief, friendly line. Don't summarize the FAQ or introduce yourself.
- Answer only what they asked. Don't pile on extra details they didn't ask about (packaging, ribbons, delivery, other options); they can ask.
- Don't repeat things you already told them earlier in the chat, and don't restate what they just said back to them.
- Only go longer (a few short lines, never more than about 80 words) when the question genuinely needs it, like comparing pricing tiers they asked about.

Never promise follow-up you can't guarantee: don't say the team "will be in touch", "will contact you", or that you've "noted everything down" or passed anything on, because nothing is sent to the team from this chat. When they're ready to order, want a quote, or want to finalise details with the team, use the "human" intent so they get the WhatsApp button to reach the team directly.

Answer in a friendly, conversational tone, like you're explaining it to someone new. Write in plain text only, no markdown — don't use asterisks for bold or italics, and don't use em dashes. If you need a list, write it as plain lines or "1., 2., 3." rather than markdown bullets. Don't repeat the question back before answering it. If the answer isn't covered in the FAQ content or catalog, say so honestly in one line and suggest they contact the team directly, don't make anything up.

Respond as JSON with these fields:
- "reply": your message, following all the rules above.
- "intent": what this reply is doing:
  "recommend" when you're suggesting products for them;
  "product" when they asked about specific products (details, price, stock, colours);
  "gift_packaging" when they're asking about gift packaging, gift boxes or wrapping, or what a gift looks like when it arrives;
  "human" when they ask to talk to a person, an agent, someone from the team, want a call back or a phone number, or when you can't answer and are pointing them to the team;
  "general" for everything else (greetings, policies, shipping, payments, the process, follow-up questions without new products).
- "products": the IDs of the products this reply is about, best first, taken exactly from the catalog's first column. For "recommend" and "product", the products you're recommending or were asked about. For "gift_packaging", the specific products they asked about, or an empty list if they asked about gift packaging in general. For "general", always an empty list.
- "visitorName" and "company": the person's own name and their company or business name, if they've stated them anywhere in this chat; otherwise empty strings. Only use what they actually said about themselves, never guess. This is recorded quietly for the team; don't mention it or ask for it.
- "followUp": true when this is the kind of enquiry the team should personally follow up on: bulk or corporate gifting, custom or personalised requirements (branding, logos, bespoke sets), large quantities, asking for a quote, or a business order (hotel, restaurant, cafe). Otherwise false. The app then offers them a way to leave their name and number; don't ask for their details yourself.

Only products that are directly relevant get shown, so don't attach products to replies that aren't about them. For "recommend" and "product", each product you list is shown under your reply as a card with its photo, name, live price, stock status, and an add to cart button, so don't write links or prices in the reply and don't list the products out again. Just talk about them naturally, for example why they suit this person, referring to them by name where it helps. Recommend 3 or 4 products unless they ask for more. Prices are in Indian Rupees. Treat budgets strictly: "under 2000" means below Rs 2000, so a Rs 2000 item doesn't qualify, and for sets use the set price as listed. Prefer products that are in stock. Only recommend products that appear in the catalog.

If someone asks about a specific product that's sold out, still include it in "products" and lead with the positive, then the stock status, for example: "The Bites and Delights Lime Green is a lovely pick for corporate gifting, but it's currently sold out." Don't suggest alternatives to it yourself and don't ask whether they'd like to see similar items; the app automatically offers similar in-stock products under a sold-out card. Pre-orders aren't available, and never promise a restock or a date; if they ask when it'll be back, suggest contacting the team.

Reaching the team: for "human" replies, say warmly in a sentence or two that they can reach the team directly on WhatsApp using the button below your reply. A WhatsApp button with the team's number is added automatically, so never write a phone number or link yourself, and don't claim you're transferring them or that someone will contact them.

Ware Atelier: products marked "Ware Atelier, made to order, price on request" are bespoke marble furniture and lighting, made with multiple marble components and usually customised for each client. Never state or guess a price for them, and never call them sold out or out of stock. Describe the piece, mention it's made to order and can be customised, and say the team will share pricing and options; each Atelier card has an Enquire button that opens WhatsApp with the team, and the app offers them a way to leave their details. Ware Atelier's other range is the Collectibles: one-of-a-kind marble vases and tissue boxes (Arc, Claude, Horizon and so on), which are priced and can be bought directly like any other product. The bespoke Atelier pieces, the Collectibles, the marble tableware (trays, trivets, coasters) and the ceramic tableware are different ranges: when recommending alternatives, stay within the range they're looking at.

Gift packaging: a product only comes gift-packed (in a gift box, sleeve or as a gift set) if the catalog marks it "gift-packed". Never say or imply a product is a gift set or comes gift-packed otherwise, even if it's giftable or tagged for gifting; just describe it as the product it is. If the FAQ describes packaging for gifting orders (ribbons, notes, boxes), that's about gifting orders placed with the team, so present it that way rather than as something a particular product comes with. For "gift_packaging" questions, photos of the packaging are shown automatically when they exist, so don't describe photos or promise to show any.

Some earlier replies may be marked as written by a member of the Ware team, who took over the chat for a while. Stay consistent with anything they told the person, and pick up naturally from there.

Earlier replies of yours in this chat may end with a note like "(Product cards shown: ...)"; that's what the person saw under that reply, so "the second one" or "that set" refers to those. When recommending again, suggest products they haven't been shown yet; only bring back an earlier one if they ask about it. Pick 3 or 4 of the best new options rather than a long list.
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

    // After a human takeover the history has customer messages nobody
    // answered and team replies with no question, so consecutive same-side
    // messages are merged into one turn and empty ones dropped.
    const contents: { role: string; parts: { text: string }[] }[] = [];
    const addTurn = (role: string, text: string) => {
      if (!text.trim()) return;
      const last = contents[contents.length - 1];
      if (last?.role === role) last.parts[0].text += `\n\n${text}`;
      else contents.push({ role, parts: [{ text }] });
    };
    for (const t of history) {
      addTurn("user", t.question);
      addTurn(
        "model",
        t.fromTeam
          ? `(A member of the Ware team replied to them directly:) ${t.answer}`
          : t.products.length
          ? `${t.answer}\n(Product cards shown: ${t.products.join("; ")})`
          : t.answer,
      );
    }
    addTurn("user", question);

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
            intent: {
              type: "STRING",
              enum: ["recommend", "product", "gift_packaging", "human", "general"],
            },
            products: { type: "ARRAY", items: { type: "STRING" } },
            visitorName: { type: "STRING" },
            company: { type: "STRING" },
            followUp: { type: "BOOLEAN" },
          },
          required: [
            "reply",
            "intent",
            "products",
            "visitorName",
            "company",
            "followUp",
          ],
        },
      },
    });

    const text = await callGemini(geminiKey, body);
    if (text === null) {
      return json({ error: "AI request failed" }, 502);
    }

    let answer = "";
    let picked: string[] = [];
    let visitorName = "";
    let company = "";
    let intent = "general";
    let followUp = false;
    try {
      const parsed = JSON.parse(text);
      answer = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
      picked = Array.isArray(parsed.products) ? parsed.products : [];
      if (typeof parsed.intent === "string") intent = parsed.intent;
      followUp = parsed.followUp === true;
      visitorName = cleanField(parsed.visitorName);
      company = cleanField(parsed.company);
    } catch {
      // Not JSON after all — show whatever it said, just without cards.
      answer = text;
    }
    if (!answer) answer = "Sorry, I couldn't come up with an answer just now.";

    // Resolve the model's picks against the real catalog: unknown IDs are
    // dropped, duplicates removed, and the budget is re-checked here too.
    const byHandle = new Map(products.map((p) => [p.handle, p]));
    const pickedProducts = [...new Set(picked)]
      .map((h) => byHandle.get(String(h).trim()))
      .filter((p): p is Product => !!p);

    // What gets shown is decided here, not left to the model: cards only
    // when products are the point of the reply, gift packaging photos only
    // for gift packaging questions (and only real ones), otherwise text.
    const showCards = intent === "recommend" || intent === "product";
    const images = intent === "gift_packaging"
      ? await giftImagesFor(pickedProducts, products)
      : [];

    // Fresh suggestions each time: for "recommend", drop anything already
    // shown earlier in this chat (they can still ask about one by name,
    // which comes through as "product"). If every pick was a repeat, keep
    // them rather than showing nothing.
    const alreadyShown = new Set(history.flatMap((t) => t.products));
    const fresh = intent === "recommend"
      ? pickedProducts.filter((p) => !alreadyShown.has(p.title))
      : pickedProducts;
    const toShow = fresh.length ? fresh : pickedProducts;

    const cards = (showCards ? toShow : [])
      .filter((p) => !budget || p.minPrice < budget)
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

    // What they typed in the details card beats what the model inferred.
    const name = conversation?.visitor_name || visitorName;

    // Logging must never cost the visitor their answer.
    try {
      await logTurn({
        conversationId: payload.conversationId,
        visitorId: payload.visitorId,
        question,
        answer,
        cards,
        // Never overwrite a name they typed into the details card.
        visitorName: conversation?.visitor_phone ? "" : visitorName,
        company,
        isFirst: !conversation?.first_question,
      });
    } catch (err) {
      console.error("Chat log failed:", err);
    }

    // "Talk to a human": a WhatsApp link whose pre-filled message carries
    // what we know (name, company, products looked at), so the team has
    // context the moment the chat opens.
    const whatsappUrl = intent === "human"
      ? buildWhatsAppUrl({
        // The model reads the whole chat for these, not just this turn.
        visitorName: name,
        company,
        products: [
          ...pickedProducts.map((p) => p.title),
          ...history.slice(-3).flatMap((t) => t.products),
        ],
      })
      : null;

    // Worth offering the "leave your details" prompt? The model's call,
    // backed by a keyword check so an obvious bulk / custom enquiry is
    // never missed. Not when they asked for a person: they get the
    // WhatsApp button instead, and two asks at once is too much.
    // Ware Atelier enquiries always qualify: those pieces are customised
    // per client, so the team needs to take it from here.
    const aboutAtelier = /\batelier\b/i.test(question) ||
      pickedProducts.some((p) => p.line === "atelier");
    const askForDetails = intent !== "human" &&
      (followUp || aboutAtelier || FOLLOW_UP_WORDS.test(question));

    return json({
      answer,
      products: cards,
      images,
      whatsappUrl,
      contactSaved,
      askForDetails,
    });
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong" }, 500);
  }
});
