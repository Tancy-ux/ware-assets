import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Builds the customer chat for the Shopify store: one self-contained
// script, widget/dist/ware-chat.js, to upload to the theme's assets.
// npm run build:widget

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const stubs = path.resolve(here, "src/stubs.js");

// The chat component is shared with the ware-assets site; these swap its
// team-only pieces (and supabase-js) out of the store build.
const SWAPS = {
  "src/lib/askFaq.js": path.resolve(here, "src/api.js"),
  "src/components/supabase.js": stubs,
  "src/components/AiGuidelines.jsx": stubs,
  "src/components/RestockForm.jsx": stubs,
};

function swapTeamModules() {
  return {
    name: "ware-chat-swap-team-modules",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (source === "react-toastify") return stubs;
      const resolved = await this.resolve(source, importer, {
        ...options,
        skipSelf: true,
      });
      if (!resolved) return null;
      const rel = path.relative(root, resolved.id).split(path.sep).join("/");
      return SWAPS[rel] ?? null;
    },
  };
}

export default defineConfig({
  root: here,
  // No .env files: the store build must never pick up the localhost
  // function URLs from the site's .env.local.
  envDir: path.resolve(here, "src"),
  plugins: [swapTeamModules(), react()],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: path.resolve(here, "dist"),
    emptyOutDir: true,
    lib: {
      entry: path.resolve(here, "src/main.jsx"),
      name: "WareChat",
      formats: ["iife"],
      fileName: () => "ware-chat.js",
    },
  },
});
