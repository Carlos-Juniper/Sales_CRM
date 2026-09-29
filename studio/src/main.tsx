import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
async function enableMocking() {
  // DEV + VITE_MOCK: optional mock mode for local development
  if (import.meta.env.DEV && import.meta.env.VITE_MOCK === 'true') {
    const { worker } = await import('./mocks/browser')
    return worker.start({
      onUnhandledRequest: 'bypass',
      serviceWorker: { url: '/mockServiceWorker.js' },
    })
  }

  // Production build deployed as a static app with no backend —
  // try MSW for full mock data; if the service worker fails (some hosting
  // environments don't support SW), fall back to auto-login only.
  // The FastAPI app.py also serves /api/auth/me as a safety net.
  if (!import.meta.env.DEV) {
    try {
      const { worker } = await import('./mocks/browser')
      await worker.start({
        onUnhandledRequest: 'bypass',
        serviceWorker: { url: '/mockServiceWorker.js' },
      })
    } catch (e) {
      console.warn('[mock] MSW service worker failed to start, using FastAPI mock fallback', e)
    }

    // Auto-login with mock user (Riley Chen, manager) for full access
    const { useAuthStore } = await import('./store/authStore')
    if (!useAuthStore.getState().user) {
      useAuthStore.getState().login({
        id: 'u7',
        email: 'riley.chen@example.com',
        name: 'Riley Chen',
        role: 'manager',
        branch_id: 'b1',
        avatar_initials: 'RC',
        allowed_intake_types: ['maintenance', 'install'],
      })
    }
  }
}

async function bootstrap() {
  await enableMocking()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

bootstrap()
