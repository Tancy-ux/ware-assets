import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { buildFaqs, ASSETS_DIR } from './scripts/build-faqs.mjs'

// Rebuilds src/data/faqs.json whenever a doc in src/assets is added,
// edited, or removed, so the FAQ search page stays in sync without a
// dev server restart.
function faqAssetsWatcher() {
  return {
    name: 'faq-assets-watcher',
    configureServer(server) {
      server.watcher.add(ASSETS_DIR)
      server.watcher.on('all', (event, file) => {
        if (!/\.(docx|pdf)$/i.test(file)) return
        if (!['add', 'change', 'unlink'].includes(event)) return
        buildFaqs()
          .then(() => server.ws.send({ type: 'full-reload' }))
          .catch((err) => console.error('[faq-assets-watcher]', err))
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), faqAssetsWatcher()],
  base: process.env.NODE_ENV === "production" ? "/ware-assets/" : "/"
})
