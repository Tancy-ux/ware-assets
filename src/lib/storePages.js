// Store page paths (as the chat records them) for the Chats page:
// "/products/lilo-90ml-cup" -> "Product · lilo 90ml cup", with a link to it.

const STORE_URL = "https://www.wareinnovations.com";

const KINDS = {
  products: "Product",
  collections: "Collection",
  pages: "Page",
  blogs: "Blog",
  search: "Search",
  cart: "Cart",
  account: "Account",
};

export const pageUrl = (path) => `${STORE_URL}${path}`;

export const pageLabel = (path) => {
  if (!path || path === "/") return "Home";
  const parts = path.split("/").filter(Boolean);
  // A product opened from a collection (/collections/x/products/y) is
  // still a product page.
  const kindAt = parts.lastIndexOf("products") >= 0
    ? parts.lastIndexOf("products")
    : 0;
  const kind = KINDS[parts[kindAt]];
  const name = decodeURIComponent(parts[kindAt + 1] ?? "").replace(/[-_]+/g, " ");
  if (!kind) return decodeURIComponent(path);
  return name ? `${kind} · ${name}` : kind;
};
