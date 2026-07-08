import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Absolute paths are required because the project directory contains a colon
// (feat:graph-integration). Vite's isFileLoadingAllowed rejects paths with ':'
// on non-Windows systems, causing Cannot find module '/src/test/setup.ts'.
// Fix: hard-code the absolute root + set server.fs.strict = false.
const ROOT = '/Users/carloshernandez/Desktop/feat:graph-integration/studio'
const SETUP_FILE = ROOT + '/src/test/setup.ts'

export default defineConfig({
  root: ROOT,
  plugins: [react()],
  server: {
    fs: {
      strict: false,
    },
  },
  test: {
    root: ROOT,
    environment: 'jsdom',
    globals: true,
    setupFiles: [SETUP_FILE],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Override VITE_API_URL so apiClient uses a relative base URL (/api),
    // keeping MSW handler paths like http.get('/api/...') correct in jsdom.
    env: { VITE_API_URL: '' },
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/test/**', 'src/mocks/**', 'src/main.tsx'],
    },
  },
  resolve: {
    alias: {
      '@': `${ROOT}/src`,
    },
  },
})
