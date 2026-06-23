import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Mocks are gated on import.meta.env.DEV in main.tsx;
// Vite dead-code-eliminates that branch in production builds,
// so mockServiceWorker and handlers are never bundled.
export default defineConfig(({ mode: _mode }) => ({
  plugins: [
    tailwindcss(),
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
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
