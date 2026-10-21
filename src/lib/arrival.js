// Where this visit came from (the site before ours and any ad tags on the
// landing page), noted once per tab when the chat's script first loads, so
// later pages of the same visit don't count. Sent with every chat request;
// ask-faq turns it into "Came from: Glance" for the Chats page.

const KEY = "askAiArrival";
// Ad and campaign tags worth keeping from the landing page's address.
const PARAMS = ["utm_source", "utm_medium", "utm_campaign", "gclid", "gad_source", "fbclid", "wbraid", "gbraid"];

const read = () => {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY));
    if (saved) return saved;
  } catch {
    // Worked out again below.
  }
  let ref = "";
  try {
    const host = document.referrer ? new URL(document.referrer).hostname : "";
    // Our own pages (a new tab from the site) aren't where they came from.
    ref = host && host !== location.hostname ? host : "";
  } catch {
    // No usable referrer.
  }
  const params = new URLSearchParams(location.search);
  const tags = Object.fromEntries(
    PARAMS.filter((p) => params.get(p)).map((p) => [p, params.get(p).slice(0, 100)]),
  );
  const value = { ref: ref.slice(0, 100), ...tags };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Just for this page then.
  }
  return value;
};

// Read now, while this is still the page they landed on.
const ARRIVAL = typeof window !== "undefined" ? read() : {};
export const arrival = () => ARRIVAL;
