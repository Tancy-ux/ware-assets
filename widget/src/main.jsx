import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Sparkles, X } from "lucide-react";
import AskAi from "../../src/components/AskAi";
import { TEXTS, setTexts } from "../../src/lib/chatTexts";

// The Ware chat on the Shopify store: a floating button that opens the
// same Ask AI chat as the ware-assets site, minus the team tools. It lives
// in a shadow root so the theme's CSS and the chat's CSS can't touch each
// other.
//
// This file is only the engine. The words and the styling live in the
// store's ware-chat snippet (built by widget/build-snippet.mjs), which the
// team edits in Shopify directly:
// - window.WareChatConfig.texts overrides any of TEXTS (src/lib/chatTexts)
// - <template id="ware-chat-styles"> holds all of the chat's CSS
// - the snippet also loads the fonts and then this script

const STYLES_ID = "ware-chat-styles";

// The product this page is about, if it's a product page: { handle, title,
// bespoke } (bespoke = tagged "ware atelier"). Read from Shopify's own
// /products/<handle>.js; a test page can set window.WareChatConfig.product
// instead.
async function pageProduct() {
  const given = window.WareChatConfig?.product;
  if (given?.handle) return given;
  const match = location.pathname.match(/\/products\/([^/?#]+)/);
  if (!match) return null;
  try {
    const res = await fetch(`/products/${match[1]}.js`);
    if (!res.ok) return null;
    const p = await res.json();
    return {
      handle: p.handle,
      title: p.title,
      bespoke: (p.tags ?? []).some(
        (t) => t.toLowerCase().trim() === "ware atelier",
      ),
    };
  } catch {
    return null;
  }
}

// eslint-disable-next-line react-refresh/only-export-components -- an entry script, not a module
const WareChat = () => {
  // Always starts closed, on every page: shoppers open it themselves. (The
  // conversation itself is kept by AskAi, so it's all there when they do.)
  const [open, setOpen] = useState(false);
  // On a product page the pill offers more like it (or, for a bespoke
  // piece, a designer's call) and tapping it asks straight away.
  const [product, setProduct] = useState(null);
  const chat = useRef(null);
  useEffect(() => {
    pageProduct().then(setProduct);
  }, []);
  const pillText = !product
    ? TEXTS.pill
    : product.bespoke
      ? TEXTS.pillBespoke
      : TEXTS.pillProduct;
  const openChat = () => {
    setOpen(true);
    if (product) chat.current?.productTap(product);
  };

  return (
    <div className="faq-page ware-chat-root">
      <AskAi
        customer
        open={open}
        onClose={() => setOpen(false)}
        actionsRef={chat}
      />
      {/* Closed: a pill with a twinkling sparkle inviting a question.
          Open: a round close button in the same spot. */}
      {open ? (
        <button
          type="button"
          className="ware-chat-launcher ware-chat-launcher-open"
          onClick={() => setOpen(false)}
          aria-label="Close chat"
        >
          <X size={20} />
        </button>
      ) : (
        <button
          type="button"
          className="ware-chat-pill"
          onClick={openChat}
          aria-label={`${TEXTS.title}: ${pillText}`}
        >
          <span className="ware-chat-pill-icon" aria-hidden="true">
            <Sparkles size={15} />
          </span>
          {pillText}
        </button>
      )}
    </div>
  );
};

const mount = () => {
  if (document.getElementById("ware-chat")) return; // added twice
  // Without the snippet's styles the chat would show unstyled, so it stays
  // hidden and says why.
  const styles = document.getElementById(STYLES_ID);
  if (!styles) {
    console.warn(
      `Ware chat: no <template id="${STYLES_ID}"> on the page. Add the ware-chat snippet ({% render 'ware-chat' %}) rather than the script alone.`,
    );
    return;
  }
  setTexts(window.WareChatConfig?.texts);

  const host = document.createElement("div");
  host.id = "ware-chat";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  // A <template>'s contents never apply to the page itself, only here.
  shadow.appendChild(styles.content.cloneNode(true));
  const container = document.createElement("div");
  shadow.appendChild(container);
  createRoot(container).render(<WareChat />);
};

if (document.body) mount();
else document.addEventListener("DOMContentLoaded", mount);
