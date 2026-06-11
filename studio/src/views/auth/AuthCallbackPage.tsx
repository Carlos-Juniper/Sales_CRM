import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Leaf } from 'lucide-react'
import { msalInstance } from '@/lib/msal'
import { entraCallback } from '@/api/auth'
import { useAuthStore } from '@/store/authStore'

function roleDefaultRoute(role: string) {
  if (role === 'outside_sales') return '/outside-sales'
  if (role === 'manager') return '/branch-manager'
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
        const result = await msalInstance.handleRedirectPromise()
        if (!result?.code) {
          navigate('/login', { replace: true })
          return
        }
        const redirectUri = `${window.location.origin}/auth/callback`
        const user = await entraCallback(result.code, redirectUri)
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
