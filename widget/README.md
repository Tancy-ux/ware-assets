# Ware chat for the Shopify store

(The full picture, including tracking, leads and every setting, is in
[docs/GUIDE.md](../docs/GUIDE.md).)

The customer-facing version of Ask AI: the "Ware concierge" chat on
wareinnovations.com. It's the same chat component as the ware-assets site
(`src/components/AskAi.jsx` with `customer` on), minus the team tools.

On Shopify it's two files:

| File | What's in it | Who changes it |
| --- | --- | --- |
| `snippets/ware-chat.liquid` | Every text the chat shows, and all its styling ("EASY EDITS" for colours, fonts, sizes and position at the top) | The team, straight in Shopify's code editor |
| `assets/ware-chat.js` | The engine | Rebuilt here when how the chat works changes |

The assistant's own replies come from the `ask-faq` function (FAQs and AI
guidelines), not from either file.

## Build

```
npm run build:widget
```

Output in `widget/dist/`:

- `ware-chat.js`: the engine.
- `ware-chat.default.liquid`: a fresh snippet with the default words (from
  `src/lib/chatTexts.js`) and styles (`widget/src/theme.css`, the chat's
  rules from `src/components/Faq.css`, and `widget/src/widget.css`). For
  reference, or to start over.
- `test.html`: a local test page with the store's snippet filled in.

**`widget/ware-chat.liquid` is the store's copy of the snippet**, with the
team's edits. It's what gets pasted into Shopify, and builds never touch
it. (If it's missing, the test page uses the default.)

Tip: turn off format-on-save for `.liquid` files in your editor. Formatters
can quietly break the CSS inside (e.g. `0%,` in an animation becoming `0,`).

## Try it locally

Serve the repo folder (`npx serve -l 5050 .`) and open
http://localhost:5050/widget/dist/test.html. It talks to the deployed
`ask-faq` function.

## Add it to the store (on a draft theme first)

1. Online Store → Themes → your live theme → ⋯ → **Duplicate**.
2. On the copy: ⋯ → **Edit code**.
3. **Assets** → Add a new asset → upload `ware-chat.js`.
4. **Snippets** → Add a new snippet → name it `ware-chat` → paste the whole
   of `widget/ware-chat.liquid` → Save.
5. In `layout/theme.liquid`, just above `</body>`, render it (it's on every
   page today; wrap it in an `{% if %}` to limit where it shows):

   ```liquid
   {% render 'ware-chat' %}
   ```

6. Save, then ⋯ → **Preview** on the copy.

## Updating later

- **Words or looks:** edit `snippets/ware-chat.liquid` in Shopify. Nothing
  to rebuild or upload.
- **Engine changes:** rebuild and re-upload `ware-chat.js` only. The
  snippet stays as the team edited it.
- **A change that adds a new text or style:** the developer says which lines
  to add to the snippet (a new text is optional: the default is used until
  it's added).
