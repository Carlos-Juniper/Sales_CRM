import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Leaf } from 'lucide-react'
import { consumePkce } from '@/lib/azureAuth'
import { entraComplete } from '@/api/auth'
import { useAuthStore } from '@/store/authStore'

function roleDefaultRoute(role: string) {
  if (role === 'outside_sales') return '/outside-sales'
  // BranchManagerPage removed in Slice 12; managers land on settings.
  if (role === 'manager') return '/settings'
  return '/inside-sales'
}

export default function AuthCallbackPage() {
  const navigate = useNavigate()
  const { login } = useAuthStore()
  const handled = useRef(false)

  useEffect(() => {
    if (handled.current) return
    handled.current = true

    async function handleCallback() {
      try {
        const params = new URLSearchParams(window.location.search)
        const code = params.get('code')
        const state = params.get('state')
        if (!code || !state) {
          navigate('/login', { replace: true })
          return
        }

        // The backend redeems the code and stores the Graph tokens in the same
        // call, so there is no separate token-storage step here any more. It
        // has to be the backend: a code redeemed by this page would yield a
        // SPA-bound refresh token the server could never use.
        const user = await entraComplete({ code, ...consumePkce(state) })
        login(user)

        navigate(roleDefaultRoute(user.role), { replace: true })
      } catch {
        navigate('/login?error=sso_failed', { replace: true })
      }
    }

    handleCallback()
  }, [login, navigate])

  return (
    <div className="min-h-screen bg-[hsl(0_0%_98%)] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="w-12 h-12 rounded-xl bg-[#2E7D52] flex items-center justify-center">
          <Leaf className="w-6 h-6 text-white" aria-hidden="true" />
        </div>
        <p className="text-sm text-[#6b7280]">Completing sign-in…</p>
      </div>
    </div>
  )
}
