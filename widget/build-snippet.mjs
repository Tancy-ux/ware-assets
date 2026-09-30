// Builds widget/dist/ware-chat.liquid: the Shopify snippet that holds the
// store chat's words and styling (the parts the team edits), and loads the
// engine (ware-chat.js). Runs after the Vite build: npm run build:widget.
//
// Also writes widget/dist/test.html, the local test page with the snippet
// already filled in (open it through a local server, see README).

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dist = path.join(here, "dist");

const FONT_URL =
  "https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&display=swap";

// The default wording, copied as written in src/lib/chatTexts.js (with its
// comments), so the snippet reads like a labelled list.
async function textsBlock() {
  const source = await readFile(path.join(root, "src/lib/chatTexts.js"), "utf-8");
  const start = source.indexOf("export const TEXTS = {");
  const end = source.indexOf("\n};", start);
  if (start < 0 || end < 0) throw new Error("Couldn't find TEXTS in chatTexts.js");
  const body = source
    .slice(source.indexOf("{", start) + 1, end)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => (line ? `    ${line}` : line))
    .join("\n");
  return `{${body}\n    }`;
}

// Faq.css also styles the admin site's FAQ page; the store chat only needs
// the chat's rules (and the few shared buttons / form bits it uses).
const CHAT_SELECTOR =
  /\.faq-chat|\.faq-btn|\.faq-icon-btn|\.faq-danger|\.faq-edit-(form|actions)|\.faq-page(?![\w-])/;
function chatRulesOnly(css) {
  const tree = postcss.parse(css);
  tree.walkComments((c) => c.remove());
  tree.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes/i.test(rule.parent.name)) {
      return;
    }
    // (Minus the team-only "Improve AI" panel, which the store never shows.)
    const kept = rule.selectors.filter((s) =>
      CHAT_SELECTOR.test(s) && !/faq-guidelines|improve/.test(s)
    );
    if (!kept.length) rule.remove();
    else rule.selectors = kept;
  });
  tree.walkAtRules((at) => {
    if (/keyframes/i.test(at.name)) {
      if (!/^faq-chat/.test(at.params)) at.remove();
    } else if (at.nodes && !at.nodes.length) {
      at.remove();
    }
  });
  return tree.toString().replace(/\n{3,}/g, "\n\n").trim();
}

const read = (p) => readFile(path.join(root, p), "utf-8").then((s) => s.replace(/\r\n/g, "\n"));

const [texts, theme, faqCss, widgetCss] = await Promise.all([
  textsBlock(),
  read("widget/src/theme.css"),
  read("src/components/Faq.css"),
  read("widget/src/widget.css"),
]);

const snippet = `{% comment %}
  WARE CHAT (the "Ware concierge" on the store)

  Everything you might want to change is in this file:
    1. WORDS    - every text the chat window shows, as a labelled list.
    2. STYLING  - colours, fonts, sizes and position ("EASY EDITS" first).
  Edit, save, and refresh the store. No rebuild needed.

  Tips:
  - Keep the quotes around each text. {name}, {phone} and {hours} are
    filled in automatically; leave them as they are.
  - The assistant's own replies come from its FAQs and AI guidelines (on
    the ware-assets site), not from here.
  - assets/ware-chat.js is the engine; it only needs replacing when the
    developer changes how the chat works.

  Added to the theme (layout/theme.liquid) with a render tag for
  'ware-chat'; see widget/README.md in the ware-assets project.
{% endcomment %}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONT_URL}">

<script>
  /* ================= 1. WORDS ================= */
  window.WareChatConfig = {
    texts: ${texts}
  };
</script>
<script>
  /* The product's details for the chat's options (product pages only;
     empty ones are left out by the chat). */
  {%- if product -%}
    {%- liquid
      assign ware_includes = ''
      assign ware_dimensions = ''
      assign ware_volume = ''
      assign ware_weight = ''
      if product.metafields.custom.this_set_includes != blank
        assign ware_includes = product.metafields.custom.this_set_includes | metafield_text | strip
      endif
      if product.metafields.my_fields.set_dimensions != blank
        assign ware_dimensions = product.metafields.my_fields.set_dimensions | metafield_text | strip
      endif
      if product.metafields.my_fields.set_volumes != blank
        assign ware_volume = product.metafields.my_fields.set_volumes | metafield_text | strip
      endif
      if product.metafields.my_fields.set_weight != blank
        assign ware_weight = product.metafields.my_fields.set_weight | metafield_text | strip
      endif
    -%}
  window.WareChatConfig.productInfo = {
    handle: {{ product.handle | json }},
    includes: {{ ware_includes | json }},
    dimensions: {{ ware_dimensions | json }},
    volume: {{ ware_volume | json }},
    weight: {{ ware_weight | json }}
  };
  {%- endif -%}
</script>

<template id="ware-chat-styles">
<style>
/* ================= 2. STYLING ================= */

${theme.trim()}

/* ------------------------------------------------------------
   Everything below is the chat's detailed styling. Fine to tweak,
   but the EASY EDITS above cover colours, fonts and sizes.
   ------------------------------------------------------------ */

${chatRulesOnly(faqCss)}

${widgetCss.trim()}
</style>
</template>

<script src="{{ 'ware-chat.js' | asset_url }}" defer></script>
`;

// The store's own copy, as the team has edited it, lives in
// widget/ware-chat.liquid and is never overwritten. This build writes the
// untouched default next to the engine, for reference (or to start over).
await writeFile(path.join(dist, "ware-chat.default.liquid"), snippet, "utf-8");

let storeCopy = null;
try {
  storeCopy = await read("widget/ware-chat.liquid");
} catch {
  // No store copy yet: the test page uses the default.
}

// Local test page: the store's snippet (or the default) as Shopify would
// render it.
const rendered = (storeCopy ?? snippet)
  .replace(/\{% comment %\}[\s\S]*?\{% endcomment %\}\n?/, "")
  // The product details come from Liquid, which a plain page can't run:
  // test.html sets them from its address instead.
  .replace(/[ \t]*\/\* The product's details[\s\S]*?\{%- endif -%\}\n/, "")
  .replace(/\{\{\s*'ware-chat\.js'\s*\|\s*asset_url\s*\}\}/, "ware-chat.js");
const page = (await read("widget/test.html")).replace(
  "<!-- WARE_CHAT_SNIPPET -->",
  rendered,
);
await writeFile(path.join(dist, "test.html"), page, "utf-8");

console.log(
  `Wrote widget/dist/ware-chat.default.liquid and widget/dist/test.html (using ${
    storeCopy ? "the store copy, widget/ware-chat.liquid" : "the default snippet"
  })`,
);
