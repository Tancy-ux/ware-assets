// Delivery price and time for an Indian pincode, straight from the store's
// Shopify shipping settings (Settings > Shipping and delivery), so the
// assistant never guesses and a change in Shopify shows up within the hour.
//
// - Pincode -> town and state: India Post's public pincode API.
// - State -> rates: the Shopify zone for that state (one zone per state),
//   read with the Admin API (read_shipping). The token is either saved
//   directly (Supabase secret SHOPIFY_ADMIN_TOKEN) or fetched and renewed
//   here from the app's client ID + secret (SHOPIFY_CLIENT_ID /
//   SHOPIFY_CLIENT_SECRET).

const SHOP = "ware-innovations-mumbai.myshopify.com";
const API_VERSION = "2026-07";
const ZONES_CACHE_MS = 60 * 60 * 1000;

// ================= Delivery times (edit here) =================
// Shopify's Admin API doesn't expose a rate's transit time, and one state
// can have faster cities (Mumbai within Maharashtra), so delivery times
// live here. Most specific wins: a city rule, then days written in the
// rate's description in Shopify ("2–4 business days"), then the state,
// then the default.

// Every order, everywhere.
const DISPATCH_NOTE = "All orders are dispatched within 24 hours.";

// Cities, matched on India Post's district / division for the pincode.
const SAME_DAY_MUMBAI =
  "Same-day delivery is available in Mumbai and Navi Mumbai for Rs 350 extra.";
const CITY_RULES: {
  name: string;
  match: (p: Place) => boolean;
  days: string;
  extra?: string;
}[] = [
  {
    name: "Mumbai",
    match: (p) => /^mumbai( suburban)?$/i.test(p.district),
    days: "2–3 business days",
    extra: SAME_DAY_MUMBAI,
  },
  {
    // India Post calls it "New Mumbai" (Vashi, Belapur, Kharghar, Panvel).
    name: "Navi Mumbai",
    match: (p) => /\b(new|navi) mumbai\b/i.test(p.division),
    days: "2–3 business days",
    extra: SAME_DAY_MUMBAI,
  },
];

// States (as in Settings > Shipping and delivery; India Post's spellings
// are matched too, e.g. Chhattisgarh / Chattisgarh).
const FAST_STATES = [
  "Bihar", "Chandigarh", "Chhattisgarh", "Chattisgarh", "Delhi", "Goa",
  "Gujarat", "Haryana", "Jharkhand", "Karnataka", "Kerala",
  "Madhya Pradesh", "Maharashtra", "Punjab", "Rajasthan", "Tamil Nadu",
  "Telangana", "Uttar Pradesh",
];
const STATE_DAYS: Record<string, string> = Object.fromEntries(
  FAST_STATES.map((s) => [s, "3–5 business days"]),
);

// Everywhere else in India: Andhra Pradesh, Arunachal Pradesh, Dadra and
// Nagar Haveli and Daman and Diu, Himachal Pradesh, the islands, the
// North East zone, Odisha, Puducherry, Uttarakhand, West Bengal.
const DEFAULT_TRANSIT = "5–8 business days";
// ===============================================================

const LOOKUP_TIMEOUT_MS = 5000;

// ---- Shopify access token (client credentials) ----

let token: { value: string; expires: number } | null = null;

async function shopifyToken() {
  // A token from the app's own install / OAuth flow (SHOPIFY_ADMIN_TOKEN)
  // is used as is. Otherwise one is fetched with the client credentials,
  // which Shopify only allows when the app and the store belong to the
  // same organization.
  const direct = Deno.env.get("SHOPIFY_ADMIN_TOKEN");
  if (direct) return direct;
  if (token && token.expires > Date.now()) return token.value;
  const clientId = Deno.env.get("SHOPIFY_CLIENT_ID");
  const clientSecret = Deno.env.get("SHOPIFY_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Shopify app keys not set");
  const res = await fetch(`https://${SHOP}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Shopify token ${res.status}: ${await res.text()}`);
  const data = await res.json();
  // Renew a few minutes early; if no expiry is given, assume a day.
  const seconds = Number(data.expires_in) || 24 * 60 * 60;
  token = {
    value: data.access_token,
    expires: Date.now() + (seconds - 300) * 1000,
  };
  return token.value;
}

// ---- Shipping zones ----

export type Rate = {
  name: string;
  price: number; // rupees; 0 = free
  minOrder: number | null; // order value conditions, rupees
  maxOrder: number | null;
  days: string; // e.g. "5–8 business days", "" if not set
};
export type Zone = { name: string; states: string[]; rates: Rate[] };

// Two small queries rather than one big one (Shopify caps a query's cost at
// 1,000): find the default ("General") profile, which covers all products,
// then read its zones a page at a time.
const PROFILES_QUERY = `{ deliveryProfiles(first: 10) { nodes { id default } } }`;
const ZONES_QUERY = `query Zones($id: ID!, $after: String) {
  deliveryProfile(id: $id) {
    profileLocationGroups {
      locationGroupZones(first: 25, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          zone {
            name
            countries { code { countryCode } provinces { name code } }
          }
          methodDefinitions(first: 6) {
            nodes {
              name
              active
              description
              rateProvider {
                ... on DeliveryRateDefinition { price { amount } }
              }
              methodConditions {
                field
                operator
                conditionCriteria {
                  __typename
                  ... on MoneyV2 { amount }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

let zonesCache: { at: number; zones: Zone[] } | null = null;

// deno-lint-ignore no-explicit-any
function toZones(zoneNodes: any[]): Zone[] {
  const zones: Zone[] = [];
  {
    for (const lgz of zoneNodes) {
      const states = (lgz.zone?.countries ?? [])
        // deno-lint-ignore no-explicit-any
        .filter((c: any) => c.code?.countryCode === "IN")
        // deno-lint-ignore no-explicit-any
        .flatMap((c: any) => (c.provinces ?? []).map((p: any) => p.name));
      const rates: Rate[] = [];
      for (const m of lgz.methodDefinitions?.nodes ?? []) {
        if (m.active === false) continue;
        let minOrder: number | null = null;
        let maxOrder: number | null = null;
        for (const c of m.methodConditions ?? []) {
          if (c.field !== "TOTAL_PRICE") continue;
          const amount = Number(c.conditionCriteria?.amount);
          if (!Number.isFinite(amount)) continue;
          if (/GREATER/.test(c.operator)) minOrder = amount;
          if (/LESS/.test(c.operator)) maxOrder = amount;
        }
        rates.push({
          name: m.name,
          price: Number(m.rateProvider?.price?.amount ?? NaN),
          minOrder,
          maxOrder,
          days: transitDays(`${m.name ?? ""} ${m.description ?? ""}`),
        });
      }
      if (states.length) zones.push({ name: lgz.zone?.name ?? "", states, rates });
    }
  }
  return zones;
}

// "5–8 business days" wherever Shopify keeps it (the rate's description,
// or its name).
function transitDays(text: string) {
  const m = text.match(/(\d+\s*(?:-|–|to)\s*\d+|\d+)\s*(business|working)?\s*days?/i);
  return m ? m[0].replace(/\s*-\s*/, "–") : "";
}

export async function loadZones(): Promise<Zone[]> {
  if (zonesCache && Date.now() - zonesCache.at < ZONES_CACHE_MS) {
    return zonesCache.zones;
  }
  const accessToken = await shopifyToken();
  // deno-lint-ignore no-explicit-any
  const graphql = async (query: string, variables?: Record<string, unknown>): Promise<any> => {
    const res = await fetch(
      `https://${SHOP}/admin/api/${API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
      },
    );
    const json = await res.json();
    if (!res.ok || json.errors) {
      throw new Error(`Shopify zones: ${JSON.stringify(json.errors ?? json).slice(0, 300)}`);
    }
    return json.data;
  };

  // deno-lint-ignore no-explicit-any
  const profiles = ((await graphql(PROFILES_QUERY))?.deliveryProfiles?.nodes ?? []) as any[];
  const profile = profiles.find((p) => p.default) ?? profiles[0];
  if (!profile) throw new Error("Shopify zones: no delivery profile");

  // The store ships from one location, so its zones sit in one location
  // group; pages of 25 until there are no more.
  // deno-lint-ignore no-explicit-any
  const nodes: any[] = [];
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const data = await graphql(ZONES_QUERY, { id: profile.id, after });
    const group = data?.deliveryProfile?.profileLocationGroups?.[0];
    const conn = group?.locationGroupZones;
    nodes.push(...(conn?.nodes ?? []));
    if (!conn?.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }

  const zones = toZones(nodes);
  zonesCache = { at: Date.now(), zones };
  return zones;
}

// ---- Pincode -> place ----

export type Place = {
  pincode: string;
  town: string;
  district: string;
  division: string;
  state: string;
};
const placeCache = new Map<string, Place | null>();

export async function lookupPincode(pincode: string): Promise<Place | null> {
  if (placeCache.has(pincode)) return placeCache.get(pincode)!;
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${pincode}`, {
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    const data = await res.json();
    const office = data?.[0]?.Status === "Success" ? data[0].PostOffice?.[0] : null;
    const place = office
      ? {
        pincode,
        // The district names the town people know ("Mumbai", "Paschim
        // Bardhaman" for Durgapur is less friendly, so keep both).
        // ("Durgapur Mc" is India Post's "Durgapur Municipal Corporation".)
        town: (office.Block && office.Block !== "NA" ? office.Block : office.Name)
          .replace(/\s*\(?\b(m\.?\s*c|m\.?\s*corp\.?|municipal corporation|mc)\)?\.?$/i, "")
          .trim(),
        district: office.District,
        division: office.Division ?? "",
        state: office.State,
      }
      : null;
    placeCache.set(pincode, place);
    return place;
  } catch (err) {
    console.error("Pincode lookup failed:", err);
    return null; // not cached: try again next time
  }
}

// ---- Putting it together ----

// Old and new spellings of the same state: India Post uses current names,
// the Shopify zones some older ones.
const STATE_ALIASES: Record<string, string> = {
  odisha: "orissa",
  chhattisgarh: "chattisgarh",
  puducherry: "pondicherry",
  pondicherry: "puducherry",
  uttarakhand: "uttaranchal",
  andamanandnicobarislands: "andamanandnicobar",
  thedadraandnagarhaveliandthedamananddiu: "dadraandnagarhaveli",
};

const norm = (s: string) =>
  s.toLowerCase().replace(/&/g, "and").replace(/[^a-z]/g, "");

function zoneFor(zones: Zone[], state: string) {
  const wants = [norm(state), STATE_ALIASES[norm(state)]].filter(Boolean);
  const exact = (s: string) => wants.includes(norm(s));
  const close = (s: string) =>
    wants.some((w) => norm(s).startsWith(w) || w.startsWith(norm(s)));
  return zones.find((z) => z.states.some(exact)) ??
    zones.find((z) => z.states.some(close)) ?? null;
}

// Settings say "₹5,001 and up" and "up to ₹4,999.99"; the team treats both
// as ₹5,000. Anything within a rupee of a round hundred is shown as it.
const roundDown = (n: number) => {
  const r = Math.round(n / 100) * 100;
  return Math.abs(n - r) <= 1 ? r : n;
};
const rupees = (n: number) => `Rs ${Math.round(n).toLocaleString("en-IN")}`;

// How long it takes to get there: a city rule, the rate's own
// description, the state, or the default (see "Delivery times" above).
function deliveryDays(r: Rate, place: Place, city: (typeof CITY_RULES)[number] | undefined) {
  if (city) return city.days;
  if (r.days) return r.days;
  const state = Object.keys(STATE_DAYS).find((s) => norm(s) === norm(place.state));
  return state ? STATE_DAYS[state] : DEFAULT_TRANSIT;
}

function describeRate(r: Rate, days: string) {
  const price = r.price === 0 ? "free" : Number.isFinite(r.price) ? rupees(r.price) : "price not set";
  // "Orders ₹0–₹5,000" reads as "under ₹5,000" (free starts at ₹5,000).
  const min = r.minOrder ? roundDown(r.minOrder) : 0;
  const when = r.maxOrder !== null
    ? min > 0
      ? `on orders from ${rupees(min)} to ${rupees(roundDown(r.maxOrder))}`
      : `on orders under ${rupees(roundDown(r.maxOrder))}`
    : min > 0
    ? `on orders of ${rupees(min)} and above`
    : "on any order";
  return `${r.name}: ${price} ${when}, ${days}`;
}

// Indian pincodes: 6 digits, not starting with 0.
const PINCODE = /\b[1-9]\d{5}\b/g;

// A line for the assistant about the most recent pincode in the chat, or
// null if there's none (or it can't be looked up).
export async function deliveryNote(text: string): Promise<string | null> {
  const pincodes = [...text.matchAll(PINCODE)].map((m) => m[0]);
  const pincode = pincodes[pincodes.length - 1];
  if (!pincode) return null;
  const place = await lookupPincode(pincode);
  if (!place) {
    return `Delivery: they mentioned ${pincode}, but it couldn't be matched to a place in India. Ask them to double-check the pincode, or which city and state it's for.`;
  }
  let zone: Zone | null = null;
  try {
    zone = zoneFor(await loadZones(), place.state);
  } catch (err) {
    console.error("Shipping zones failed:", err);
  }
  const city = CITY_RULES.find((c) => c.match(place));
  // India Post's town is sometimes a block or an abbreviation ("Gmc" for
  // Guwahati), so the district goes alongside it, and 2–3 letter
  // abbreviations are left out.
  const parts = city
    ? [city.name]
    : [place.town.length > 3 ? place.town : "", place.district]
      .filter((p, i, all) => p && all.findIndex((q) => norm(q) === norm(p)) === i);
  const where = `${place.pincode} (${[...parts, place.state].join(", ")})`;
  const extras = [DISPATCH_NOTE, city?.extra].filter(Boolean).join(" ");
  if (!zone || !zone.rates.length) {
    return `Delivery to ${where}: the shipping charge couldn't be loaded just now, so say the team can confirm it. It usually takes ${
      deliveryDays({ days: "" } as Rate, place, city)
    }. ${extras}`;
  }
  return `Delivery to ${where}, from Ware's own shipping settings (use exactly this, don't guess or round):\n${
    zone.rates.map((r) => `- ${describeRate(r, deliveryDays(r, place, city))}`).join("\n")
  }\n${extras} Mention these too.`;
}
