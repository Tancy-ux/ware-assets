// Plays a set of conversations against the bot (ask-faq) and checks the
// replies follow our rules. Run before deploying a bot change:
//
//   node scripts/bot-tests.mjs                 the local bot (127.0.0.1:8010)
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
  : "http://127.0.0.1:8010";
const headers = {
  "Content-Type": "application/json",
  // The store's own address, so the bot answers as it would there.
  Origin: live ? "https://www.wareinnovations.com" : "http://localhost:4173",
  ...(live && anonKey ? { Authorization: `Bearer ${anonKey}`, apikey: anonKey } : {}),
};
const ask = async (question, history) => {
  const res = await fetch(URL_, { method: "POST", headers, body: JSON.stringify({ question, history }) });
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

// ---- Conversations: each turn may add its own checks ----
// Each check: [what it checks, (reply, earlier replies) => true when fine]
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
  "Bulk gifting": [
    ["Corporate gifting for 100 people", []],
    ["budget 1500 each, need by Diwali", [["suggests products", (r) => (r.products ?? []).length > 0]]],
  ],
  "Not sold": [
    ["Do you sell bunk beds?", [["no made-up products", (r) => !(r.products ?? []).some((p) => /bed/i.test(p.title))]]],
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
  for (const [question, checks] of turns) {
    let r;
    try {
      r = await ask(question, history);
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
