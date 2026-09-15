import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

const DEV_REFERENCE_DIR = path.resolve(__dirname, './dev-reference')

/**
 * Serve the rasterized Coral Bay reference pages at /proposal/reference/*.png
 * for the DEV-only fidelity route (/dev/proposal-fidelity).
 *
 * They deliberately live in ./dev-reference rather than ./public: publicDir is
 * copied wholesale into dist, and 34MB of reference scans has no business in a
 * production bundle or the container image. `apply: 'serve'` means this plugin
 * is inert during `vite build`.
 *
 * Regenerate with: ./venv/bin/python scripts/rasterize_coral_bay_reference.py
 */
function devReferencePages(): Plugin {
  return {
    name: 'juniper-dev-reference-pages',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/proposal/reference', (req, res, next) => {
        // basename + strict allowlist: the URL never escapes DEV_REFERENCE_DIR.
        const name = path.basename(decodeURIComponent((req.url ?? '').split('?')[0]))
        const file = path.join(DEV_REFERENCE_DIR, name)
        if (!/^[\w-]+\.png$/.test(name) || !fs.existsSync(file)) {
          next()
          return
        }
        res.setHeader('Content-Type', 'image/png')
        fs.createReadStream(file).pipe(res)
      })
    },
  }
}

// Mocks are gated on import.meta.env.DEV in main.tsx;
// Vite dead-code-eliminates that branch in production builds,
// so mockServiceWorker and handlers are never bundled.
export default defineConfig(() => ({
  plugins: [
    tailwindcss(),
    react(),
    devReferencePages(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // Force a single React instance — prevents Rolldown/Vite 8 CJS-interop from
    // creating mismatched React copies across pre-bundled deps (zustand, radix, etc.)
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client'],
  },
  server: {
    port: 5174,
    // Vite 8's fs path comparison mishandles the colon in the working directory
    // name (feat:lead-management). strict: false is dev-only and has no effect
    // on production builds.
    fs: {
      strict: false,
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
}))
