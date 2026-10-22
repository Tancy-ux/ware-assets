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
  // Priyal's chat (21 Oct): a straight answer about Friday, no "easily",
  // and cards that fit "one good piece" (no plates, napkins or big sets).
  "Delivery by a day, one piece": [
    ["I want to by friday. Pincode-400049", [
      ["answers about Friday", has(/friday/i)],
      ["no sure-thing words", not(/\b(easily|comfortably|definitely|guaranteed|for sure)\b/i)],
    ]],
    ["So i need a good ceramic cup by friday to gift someone", [
      ["no sure-thing words", not(/\b(easily|comfortably|definitely|guaranteed|for sure)\b/i)],
    ]],
    ["I want one good peice", [
      ["only cups / drink sets", (r) => (r.products ?? []).every((p) => !/plate|napkin|starter|table setting|runner|mat\b/i.test(p.title))],
      ["no sets for 4 or more", (r) => (r.products ?? []).every((p) => !/set of ([4-9]|\d{2})|\(([4-9]|\d{2}) pieces?\)/i.test(p.title))],
      ["still suggests something", (r) => (r.products ?? []).length > 0],
    ]],
  ],
  "Delivery tomorrow": [
    ["can it reach tomorrow? pincode 400013", [
      ["says it may not, offers same-day", has(/same.day/i)],
      ["same-day is prepaid only", has(/prepaid/i)],
      ["no sure-thing words", not(/\b(easily|comfortably|definitely|guaranteed|for sure)\b/i)],
    ]],
  ],
  "Delivery before a date elsewhere": [
    ["will a dinner set reach Bangalore 560001 before the 10th of next month?", [
      ["no sure-thing words", not(/\b(easily|comfortably|definitely|guaranteed|for sure)\b/i)],
      ["gives an answer about the date", has(/\b(should|may|might|reach|arrive)\b/i)],
    ]],
  ],
  // A gift with no budget: it asks, with the three budget pills; a pill
  // then works as a budget; a choice it asks about comes with pills.
  "Budget pills": [
    ["hi, looking for a gift for my mom's birthday", [
      ["budget pills", (r) => (r.choices ?? []).includes("Under ₹2,500")],
      ["nothing over ₹5,000 shown yet", (r) => (r.products ?? []).every((p) => Number(String(p.price).replace(/\D/g, "")) <= 5000)],
    ]],
    ["Under ₹2,500", [
      ["all within ₹2,500", (r) => (r.products ?? []).length > 0 && (r.products ?? []).every((p) => Number(String(p.price).replace(/\D/g, "")) <= 2500)],
      ["no budget pills again", (r) => !(r.choices ?? []).includes("Under ₹2,500")],
    ]],
  ],
  "No fixed budget": [
    ["something nice for my sister's wedding", [
      ["budget pills", (r) => (r.choices ?? []).includes("No fixed budget")],
    ]],
    ["No fixed budget", [
      ["shows pieces", (r) => (r.products ?? []).length > 0],
      ["doesn't ask the budget again", (r) => !(r.choices ?? []).includes("No fixed budget")],
    ]],
  ],
  // Asking what Ware Atelier is: the gentle one-line ask, not the open form.
  "What is Atelier": [
    ["what is ware atelier", [
      ["no open quote form", (r) => !(r.askForDetails && r.detailsKind === "quote")],
    ]],
  ],
  "Bulk with a date": [
    ["need 50 gift sets by 28th october in delhi", [
      ["no pills for bulk", (r) => !(r.choices ?? []).length],
    ]],
  ],
  // An ordinary piece: + to cart and check out, not straight to WhatsApp.
  "How to order": [
    ["how do i order the flare tea cups?", [
      ["points to the cart / website", has(/\b(cart|checkout|check out|website)\b/i)],
      ["no WhatsApp button", (r) => !r.whatsappUrl],
    ]],
  ],
  // It knows today's date (India time), and says it when asked.
  "Today's date": [
    ["what day is today", [
      ["says today's weekday", has(new RegExp(new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long" }), "i"))],
    ]],
  ],
  // A number typed in the chat counts as their details; a plain "yes"
  // after a call question opens the form; bulk asks open it with a quote.
  "Leaving details": [
    ["I need 50 corporate gifts for my team", [
      // Bulk keeps its own flow: the quote form, no pills.
      ["asks with the quote form", (r) => r.askForDetails && r.detailsKind === "quote"],
      ["no pills", (r) => !(r.choices ?? []).length],
    ]],
    ["my number is 9000000001", [
      ["counts as their details", (r) => r.contactSaved === true],
      ["doesn't repeat the number", not(/9000000001/)],
      ["no form after it", (r) => !r.detailsOpen],
    ]],
  ],
  "Yes to a call": [
    ["Around 1500 each, 60 pieces for Diwali, delivery in Mumbai by 25th October", [
      ["asks about a call", has(/\bcall\b/i)],
    ]],
    ["yes", [["opens the form", (r) => r.detailsOpen === true]]],
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
