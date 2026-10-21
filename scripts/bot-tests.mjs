// Plays a set of conversations against the bot (ask-faq) and checks the
// replies follow our rules. Run before deploying a bot change:
//
//   node scripts/bot-tests.mjs                 the local bot (127.0.0.1:8000, npm run dev:ai)
//   node scripts/bot-tests.mjs --live          the deployed bot
//   node scripts/bot-tests.mjs --only Atelier  one conversation
//
// The chats aren't saved (no chat id), so nothing shows on the Chats page;
// their AI cost counts under Stats → AI cost → Tests. About 20 AI replies a
// run (roughly ₹15). Exits 1 if any check fails.
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const live = args.includes("--live");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;

const anonKey = readFileSync(new URL("../src/lib/supabaseConfig.js", import.meta.url), "utf8")
  .match(/SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/)?.[1];
const URL_ = live
  ? "https://lauvnmdepcdjxilglubn.supabase.co/functions/v1/ask-faq"
  : "http://127.0.0.1:8000";
const headers = {
  "Content-Type": "application/json",
  // The store's own address, so the bot answers as it would there.
  Origin: live ? "https://www.wareinnovations.com" : "http://localhost:4173",
  ...(live && anonKey ? { Authorization: `Bearer ${anonKey}`, apikey: anonKey } : {}),
};
// page: the store page it's asked from, as the chat widget sends it.
const ask = async (question, history, page) => {
  const res = await fetch(URL_, { method: "POST", headers, body: JSON.stringify({ question, history, page }) });
  return res.json();
};

// ---- Checks every reply gets ----
// The team is "we" / "us" / "our team", never "they" / "them".
const THEY_TEAM = /\b(they('ll| will| can|'d)|reach them|chat with them|contact them)\b/i;
const LINK_IN_TEXT = /https?:\/\/|wa\.me/i;
const words = (t) => new Set((t ?? "").toLowerCase().match(/[a-z]+/g) ?? []);
const overlap = (a, b) => {
  const x = words(a), y = words(b);
  if (!x.size || !y.size) return 0;
  let same = 0;
  for (const w of x) if (y.has(w)) same++;
  return same / Math.min(x.size, y.size);
};

// The Diwali gifts collection's pieces, for the collection page check.
const DIWALI = new Set(
  (await (await fetch("https://www.wareinnovations.com/collections/premium-handmade-diwali-gifts/products.json?limit=250")).json())
    .products.map((p) => p.handle),
);

// ---- Conversations: each turn may add its own checks ----
// Each check: [what it checks, (reply, earlier replies) => true when fine]
// A turn's optional third item is the store page it's asked from.
const has = (re) => (r) => re.test(r.answer ?? "");
const not = (re) => (r) => !re.test(r.answer ?? "");
const SCENARIOS = {
  "Delivery": [
    ["Do you deliver to Pune?", [["asks for the pincode", has(/pin ?code/i)]]],
    ["411001", [["gives days or a charge", has(/\bdays?\b|free|₹|rs\.?\s?\d/i)]]],
  ],
  "Returns": [
    ["I want to return a cup I bought", [
      ["adds the returns link", (r) => !!r.returnsLink],
      ["14 days after delivery, not dispatch", (r) => !/dispatch/i.test(r.answer ?? "") || !/14 days/i.test(r.answer ?? "")],
    ]],
    ["It arrived broken", [["adds the returns link", (r) => !!r.returnsLink]]],
  ],
  "Order tracking": [
    ["Where is my order? I ordered last week", [
      ["shows the WhatsApp button", (r) => !!r.whatsappUrl],
      ["no made-up status", not(/(is|was) (out for delivery|delivered|shipped on)/i)],
    ]],
  ],
  "Directions": [
    ["Where is your store?", [
      ["adds the Google Maps link", (r) => !!r.storeMap],
      ["gives store hours Mon–Sat", has(/mon/i)],
    ]],
  ],
  "Same question twice": [
    ["What is your return policy?", []],
    ["What is your return policy?", [["doesn't repeat itself", (r, prev) => overlap(r.answer, prev.at(-1)) < 0.8]]],
  ],
  "Call me": [
    ["Can someone call me?", [["opens the call form", (r) => !!r.detailsOpen]]],
  ],
  "A person": [
    ["I want to talk to a person", [["shows the WhatsApp button", (r) => !!r.whatsappUrl]]],
  ],
  "Atelier": [
    ["Tell me about the Cosmic Temple", [["no price", not(/₹\s?\d|rs\.?\s?\d/i)]]],
    ["how much does it cost?", [
      ["no price", not(/₹\s?\d|rs\.?\s?\d/i)],
      ["gives the designers' number", has(/96196\s?20099/)],
      ["no product card the 2nd time", (r) => !(r.products ?? []).length],
    ]],
  ],
  // Asked on a product page: "it" / "this set" is that product, not the range.
  "Product page": [
    ["What all it consists", [
      ["about this product, not the range", not(/our collection|range from|we (also )?(make|offer|have) /i)],
      ["no other product's card", (r) => (r.products ?? []).every((p) => /elements dinner spread/i.test(p.title))],
    ], "/products/elements-dinner-spread"],
    ["In this dinner set", [
      ["shows just this product", (r) => (r.products ?? []).length <= 1 && (r.products ?? []).every((p) => /elements dinner spread/i.test(p.title))],
      ["doesn't switch to another set", not(/lunar|range from/i)],
    ], "/products/elements-dinner-spread"],
  ],
  // On a collection page: "these" / "here" means that collection's pieces.
  "Collection page": [
    ["What do you have under 1500 here?", [
      ["only pieces from this page", (r) => (r.products ?? []).length > 0 &&
        (r.products ?? []).every((p) => DIWALI.has(p.url?.match(/products\/([^/?#]+)/)?.[1]))],
    ], "/collections/premium-handmade-diwali-gifts"],
  ],
  // A size asked for: every card (Show more too) is near it.
  "Size asked": [
    ["i want 300ml serving bowls", [
      ["every card is 180-500ml", (r) => (r.products ?? []).length > 0 && (r.products ?? []).every((p) => {
        const ml = Number(p.title.match(/(\d+)\s?ml/i)?.[1]);
        return !ml || (ml >= 180 && ml <= 500);
      })],
    ], "/collections/serving-small-bowls"],
  ],
  "Plate size": [
    ["show me 10 inch dinner plates", [
      ["every card is 9-11.5in", (r) => (r.products ?? []).length > 0 && (r.products ?? []).every((p) => {
        const inches = Number(p.title.match(/([0-9.]+)in[^a-z]/i)?.[1]);
        return !inches || (inches >= 9 && inches <= 11.5);
      })],
    ]],
  ],
  // Named from another page: answers about that product from its records.
  "Product by name": [
    ["What's in the Elements Dinner Spread?", [
      ["lists its pieces", has(/whirl|margo|pollen/i)],
      ["only that product's cards", (r) => (r.products ?? []).every((p) => /elements dinner spread/i.test(p.title))],
    ]],
  ],
  // Ready to buy in the chat: the team takes the order on WhatsApp.
  "Ordering in chat": [
    ["Could you please share a payment link for 2 Jay Dip Plates Lime Green", [
      ["shows the WhatsApp button", (r) => !!r.whatsappUrl],
      ["doesn't just send them to the website", not(/head (over )?to (our|the) (online )?store/i)],
    ]],
  ],
  "Discounts": [
    ["Any discount for first time buyers?", [["mentions 5% off the first order", has(/5\s?%/)]]],
    // Circle of Ware, HoReCa and bulk discounts are for that type of client only.
    ["is there a discount", [
      ["mentions 5% off the first order", has(/5\s?%/)],
      ["no Circle of Ware tiers", not(/circle of ware|7\.5\s?%|10\s?%/i)],
    ]],
  ],
  // Details first, the catalogue with the next reply.
  "Gift catalogue": [
    ["Bulk or corporate gifting", [["no catalogue link yet", (r) => !r.giftCatalog]]],
    ["Around 1500 each, 60 pieces, by 25th October", [["adds the gifting catalogue link", (r) => !!r.giftCatalog]]],
  ],
  // "Catalogue" in a gifting chat: the gifting one, never the bespoke one.
  "Catalogue in a gifting chat": [
    ["Hey want to look for some Diwali gifting, let's connect and take it further. I need the quotation for 50 quantities", [
      ["no catalogue link yet", (r) => !r.giftCatalog],
    ]],
    ["do u have catalog", [
      ["the gifting catalogue", (r) => !!r.giftCatalog],
      ["not the bespoke one", (r) => !r.catalog],
    ]],
  ],
  "Catalogue for a cafe": [
    ["We're opening a cafe, do you have a catalogue?", [
      ["the HoReCa catalogue", (r) => !!r.horecaCatalog],
      ["not the bespoke one", (r) => !r.catalog],
    ]],
  ],
  // The bespoke catalogue only for pieces tagged "ware atelier".
  "Bespoke gift boxes": [
    ["Do you do bespoke gift boxes with our logo?", [["no bespoke catalogue", (r) => !r.catalog]]],
  ],
  "Catalogue on an Atelier page": [
    ["do you have a catalogue?", [
      ["the bespoke catalogue", (r) => !!r.catalog || !!r.bespoke],
      ["not the gifting one", (r) => !r.giftCatalog],
    ], "/products/the-cosmic-temple"],
  ],
  "Quick gifting": [
    ["Do you have a catalogue for quick gifting?", [
      ["the gifting catalogue", (r) => !!r.giftCatalog],
      ["not the bespoke one", (r) => !r.catalog],
    ]],
  ],
  // "Catalogue?" with nothing to go on: ask what for, no link yet.
  "Catalogue, no context": [
    ["do you have a catalogue?", [
      ["no catalogue link yet", (r) => !r.catalog && !r.giftCatalog && !r.horecaCatalog],
      ["asks what it's for", has(/gift|restaurant|caf|hotel|marble|atelier/i)],
    ]],
    ["for gifting my clients this diwali", [["the gifting catalogue", (r) => !!r.giftCatalog]]],
  ],
  "Not gifting": [
    ["Do you have soup bowls?", [["no gifting catalogue link", (r) => !r.giftCatalog]]],
  ],
  "Bulk gifting": [
    ["Corporate gifting for 100 people", []],
    ["budget 1500 each, need by Diwali", [["suggests products", (r) => (r.products ?? []).length > 0]]],
  ],
  "Not sold": [
    ["Do you sell bunk beds?", [["no made-up products", (r) => !(r.products ?? []).some((p) => /\bbed/i.test(p.title))]]],
  ],
  "Off topic": [
    ["Write me a poem about the sea", [["stays on Ware", has(/ware|help|pieces?|tableware|gift/i)]]],
  ],
};

let failed = 0, passed = 0;
for (const [name, turns] of Object.entries(SCENARIOS)) {
  if (only && name.toLowerCase() !== only.toLowerCase()) continue;
  console.log(`\n=== ${name}`);
  const history = [];
  const answers = [];
  for (const [question, checks, page] of turns) {
    let r;
    try {
      r = await ask(question, history, page);
    } catch (err) {
      r = { error: String(err) };
    }
    console.log(`> ${question}\n  ${(r.error ?? r.answer ?? "").replace(/\n/g, "\n  ")}`);
    const all = [
      ["answers", (x) => !x.error && !!x.answer?.trim()],
      ["team is \"we\", not \"they\"", not(THEY_TEAM)],
      ["no link typed in the text", not(LINK_IN_TEXT)],
      ...checks,
    ];
    for (const [label, ok] of all) {
      const good = (() => { try { return ok(r, answers); } catch { return false; } })();
      if (good) passed++;
      else {
        failed++;
        console.log(`  ✗ ${label}`);
      }
    }
    answers.push(r.answer ?? "");
    history.push({ question, answer: r.answer ?? "", products: (r.products ?? []).map((p) => p.title), fromTeam: false });
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
