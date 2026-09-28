# Ware chat for the Shopify store

The customer-facing version of Ask AI: a floating chat button for
wareinnovations.com. It's the same chat component as the ware-assets site
(`src/components/AskAi.jsx` with `customer` on), minus the team tools, built
into one file.

## Build

```
npm run build:widget
```

Output: `widget/dist/ware-chat.js` (styles included).

## Try it locally

Serve the repo folder and open `widget/test.html`, e.g.

```
npx serve .
```

then http://localhost:3000/widget/test.html. It talks to the deployed
`ask-faq` function; add `data-api="http://localhost:8000"` to the script tag
to use a local one (`npm run dev:ai`).

## Add it to the store (on a draft theme first)

1. Online Store → Themes → your live theme → ⋯ → **Duplicate**.
2. On the copy: ⋯ → **Edit code** → Assets → **Add a new asset** → upload
   `ware-chat.js`.
3. Open `layout/theme.liquid` and paste just above `</body>`:

   ```liquid
   <script src="{{ 'ware-chat.js' | asset_url }}" defer></script>
   ```

4. Save, then ⋯ → **Preview** on the copy.

To update it later, build again and re-upload `ware-chat.js` (same name).
Prompt and product changes live in the Supabase function and need no
re-upload.
