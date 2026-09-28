import { useState } from "react";
import { createRoot } from "react-dom/client";
import { X } from "lucide-react";
import AskAi from "../../src/components/AskAi";
import faqCss from "../../src/components/Faq.css?inline";
import widgetCss from "./widget.css?inline";

// The Ware chat on the Shopify store: a floating button that opens the
// same Ask AI chat as the ware-assets site, minus the team tools. It lives
// in a shadow root so the theme's CSS and the chat's CSS can't touch each
// other. Added to the theme with one script tag (see widget/README.md).

// eslint-disable-next-line react-refresh/only-export-components -- an entry script, not a module
const WareChat = () => {
  // Always starts closed, on every page: shoppers open it themselves. (The
  // conversation itself is kept by AskAi, so it's all there when they do.)
  const [open, setOpen] = useState(false);

  return (
    <div className="faq-page ware-chat-root">
      <AskAi customer open={open} onClose={() => setOpen(false)} />
      {/* Closed: a pill with a live "online" dot inviting a question.
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
          onClick={() => setOpen(true)}
          aria-label="Chat with Ware: ask me anything"
        >
          <span className="ware-chat-pill-dot" aria-hidden="true" />
          Ask me anything
        </button>
      )}
    </div>
  );
};

// The serif for the concierge look. Fonts have to be declared on the page
// itself (an @font-face inside a shadow root is ignored), so the stylesheet
// link goes in the store's <head>; the chat's CSS then uses it by name.
const FONT_URL =
  "https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&display=swap";
const loadFont = () => {
  if (document.querySelector(`link[href="${FONT_URL}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = FONT_URL;
  document.head.appendChild(link);
};

const mount = () => {
  if (document.getElementById("ware-chat")) return; // added twice
  loadFont();
  const host = document.createElement("div");
  host.id = "ware-chat";
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `${faqCss}\n${widgetCss}`;
  shadow.appendChild(style);
  const container = document.createElement("div");
  shadow.appendChild(container);
  createRoot(container).render(<WareChat />);
};

if (document.body) mount();
else document.addEventListener("DOMContentLoaded", mount);
