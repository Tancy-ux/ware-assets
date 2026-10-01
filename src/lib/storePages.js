// Store page paths (as the chat records them) for the Chats page:
// "/products/lilo-90ml-cup" -> "Product · lilo 90ml cup", with a link to it.

const STORE_URL = "https://www.wareinnovations.com";

// Page kinds, by the path's first part (after any /en-us style market
// prefix). The keys are what the Stats tab filters by.
export const PAGE_KINDS = [
  { id: "home", label: "Homepage" },
  { id: "collections", label: "Collection" },
  { id: "products", label: "Product" },
  { id: "pages", label: "Page" },
  { id: "search", label: "Search" },
  { id: "blogs", label: "Blog" },
  { id: "cart", label: "Cart" },
  { id: "account", label: "Account" },
  { id: "other", label: "Other" },
];
const LABELS = Object.fromEntries(PAGE_KINDS.map((k) => [k.id, k.label]));

export const pageUrl = (path) => `${STORE_URL}${path}`;

// The path's parts, without a market prefix like "en-us".
const partsOf = (path) => {
  const parts = (path ?? "").split("/").filter(Boolean);
  if (parts.length && /^[a-z]{2}(-[a-z]{2})?$/i.test(parts[0])) parts.shift();
  return parts;
};

// "home" | "products" | "collections" | ... | "other". A product opened
// from a collection (/collections/x/products/y) is still a product page.
export const pageKind = (path) => {
  const parts = partsOf(path);
  if (!parts.length) return "home";
  if (parts.includes("products")) return "products";
  return LABELS[parts[0]] && parts[0] !== "home" ? parts[0] : "other";
};

export const pageKindLabel = (path) => LABELS[pageKind(path)];

// "kuch meetha ho jaye dessert set" -> "Kuch Meetha Ho Jaye Dessert Set",
// the way the store names its pieces (small joining words stay small).
const SMALL_WORDS = new Set(["a", "an", "and", "of", "the", "with", "in", "for", "or", "to"]);
const titleCase = (text) =>
  text
    .split(" ")
    .map((w, i) =>
      i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(" ");

export const pageLabel = (path) => {
  const kind = pageKind(path);
  if (kind === "home") return "Home";
  if (kind === "other") return decodeURIComponent(path);
  const parts = partsOf(path);
  const at = kind === "products" ? parts.lastIndexOf("products") : 0;
  const name = titleCase(
    decodeURIComponent(parts[at + 1] ?? "").replace(/[-_]+/g, " "),
  );
  return name ? `${LABELS[kind]} · ${name}` : LABELS[kind];
};
