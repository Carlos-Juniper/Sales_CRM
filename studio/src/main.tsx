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
  // always enable MSW and auto-login with a mock manager user so the
  // app is fully functional for testing without Entra ID SSO.
  if (!import.meta.env.DEV) {
    const { worker } = await import('./mocks/browser')
    await worker.start({
      onUnhandledRequest: 'bypass',
      serviceWorker: { url: '/mockServiceWorker.js' },
    })

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
