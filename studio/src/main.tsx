import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { CANONICAL_ROLES, type UserRole } from '@/types'

async function enableMocking() {
  if (import.meta.env.DEV && import.meta.env.VITE_MOCK === 'true') {
    const [{ worker }, { mockAuthSession }] = await Promise.all([
      import('./mocks/browser'),
      import('./mocks/handlers'),
    ])
    // Dev-only: /inside-sales/commissions?mockRole=admin shows the rep picker,
    // plan name, and mark-paid actions. Production builds drop this branch.
    const requested = new URLSearchParams(window.location.search).get('mockRole')
    if (requested && (CANONICAL_ROLES as readonly string[]).includes(requested)) {
      mockAuthSession.role = requested as UserRole
    }
    return worker.start({
      onUnhandledRequest: 'bypass',
      serviceWorker: { url: '/mockServiceWorker.js' },
    })
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
