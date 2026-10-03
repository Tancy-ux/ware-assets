import { useEffect, useState } from "react";
import { Check, Plus, Search, X } from "lucide-react";

// "Send a product" in the side panel of a taken-over chat: tap one to send
// it with the reply as a card (it shows above the reply box). Before a
// search, `suggestions` (what they've been shown in this chat); a search
// covers the whole store by name (no AI; chat-admin's "product-search").
const ChatProductPicker = ({ api, picked, onPick, suggestions = [], max = 6 }) => {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState({ query: "", products: [] });

  // Searches a moment after they stop typing.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
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
  }, [api, query]);

  const q = query.trim();
  const searching = q.length >= 2;
  const loading = searching && result.query !== q;
  const full = picked.length >= max;
  const list = searching ? result.products : suggestions;

  const item = (p) => {
    const added = picked.some((x) => x.url === p.url);
    return (
      <button
        key={p.url}
        type="button"
        className="chats-picker-item"
        disabled={added || full}
        onClick={() => onPick(p)}
        title={added ? "Added to your reply" : "Send with your reply"}
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
          <small>{[p.price, p.available === false && "Sold out"].filter(Boolean).join(" · ")}</small>
        </span>
        {added ? <Check size={14} /> : <Plus size={14} />}
      </button>
    );
  };

  return (
    <div className="chats-info-section chats-picker">
      <div className="chats-info-title">Send a product</div>
      <div className="chats-search chats-picker-search">
        <Search size={14} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search products, e.g. pod cup nude"
        />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
            <X size={13} />
          </button>
        )}
      </div>
      {searching ? (
        <div className="chats-picker-list">
          {loading ? (
            <p className="chats-results-note">Searching…</p>
          ) : !list.length ? (
            <p className="chats-results-note">No products match.</p>
          ) : (
            list.map(item)
          )}
        </div>
      ) : (
        list.length > 0 && (
          <div className="chats-picker-list">
            <p className="chats-picker-label">Shown in this chat</p>
            {list.map(item)}
          </div>
        )
      )}
      {full && <p className="chats-results-note">Up to {max} products per reply.</p>}
    </div>
  );
};

export default ChatProductPicker;
