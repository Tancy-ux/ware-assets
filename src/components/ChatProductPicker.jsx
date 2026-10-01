import { useEffect, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";

// "+ Product" in the reply box: search the store's products by name (no
// AI) and add one to send with the reply as a card. From chat-admin's
// "product-search".
const ChatProductPicker = ({ api, picked, onPick, max = 6 }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState({ query: "", products: [] });
  const box = useRef(null);

  // Searches a moment after they stop typing.
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      api({ action: "product-search", query: q }).then((res) => {
        if (!cancelled) setResult({ query: q, products: res?.products ?? [] });
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, open, query]);

  // Closes on a click outside or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const q = query.trim();
  const loading = q.length >= 2 && result.query !== q;
  const full = picked.length >= max;

  return (
    <div className="chats-quick" ref={box}>
      <button
        type="button"
        className={`chats-btn chats-add-product${open ? " chats-quick-on" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title="Add a product card to your reply"
      >
        <Plus size={14} />
        <span>Product</span>
      </button>
      {open && (
        <div className="chats-quick-pop chats-picker-pop" role="dialog" aria-label="Add a product">
          <h4>Add a product to your reply</h4>
          <div className="chats-search chats-picker-search">
            <Search size={14} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products, e.g. pod cup nude"
            />
          </div>
          <div className="chats-picker-list">
            {q.length < 2 ? (
              <p className="chats-results-note">Type at least 2 letters.</p>
            ) : loading ? (
              <p className="chats-results-note">Searching…</p>
            ) : !result.products.length ? (
              <p className="chats-results-note">No products match.</p>
            ) : (
              result.products.map((p) => {
                const added = picked.some((x) => x.url === p.url);
                return (
                  <button
                    key={p.url}
                    type="button"
                    className="chats-picker-item"
                    disabled={added || full}
                    onClick={() => {
                      onPick(p);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <span className="chats-start-img">
                      {p.image && (
                        <img
                          src={`${p.image}${p.image.includes("?") ? "&" : "?"}width=80`}
                          alt=""
                          loading="lazy"
                        />
                      )}
                    </span>
                    <span>
                      {p.title}
                      <small>
                        {[p.price, !p.available && "Sold out", added && "Added"]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </span>
                  </button>
                );
              })
            )}
          </div>
          {full && <p className="chats-results-note">Up to {max} products per reply.</p>}
        </div>
      )}
    </div>
  );
};

export default ChatProductPicker;
