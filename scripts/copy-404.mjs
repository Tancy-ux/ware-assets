// GitHub Pages only serves actual files — it has no server-side rewrite
// for client-side routes, so refreshing a deep link like /ware-assets/faq
// 404s instead of reaching the SPA. The standard fix is to give GitHub
// Pages a 404.html identical to index.html: it serves that file's content
// (with a 404 status, but the browser still runs it) for any unmatched
// path, keeping the real URL in the address bar. Since the Vite build
// uses an absolute base ("/ware-assets/"), the asset links in that HTML
// resolve correctly regardless of how deep the URL is, and BrowserRouter
// then reads the real pathname and renders the right page.
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const distDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist",
);

copyFileSync(
  path.join(distDir, "index.html"),
  path.join(distDir, "404.html"),
);

console.log("Copied dist/index.html -> dist/404.html for GitHub Pages SPA routing.");
