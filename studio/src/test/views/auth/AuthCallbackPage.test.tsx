import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import { makeUser } from '@/test/utils'
import AuthCallbackPage from '@/views/auth/AuthCallbackPage'

// ── navigation ────────────────────────────────────────────────────────────────
const mockNavigate = vi.fn()

vi.mock('react-router-dom', async (importOriginal) => {
  const mod = await importOriginal<typeof import('react-router-dom')>()
  return { ...mod, useNavigate: () => mockNavigate }
})

// ── azureAuth ─────────────────────────────────────────────────────────────────
const mockConsumePkce = vi.fn()

vi.mock('@/lib/azureAuth', () => ({
  consumePkce: (state: string) => mockConsumePkce(state),
}))

// ── api/auth ──────────────────────────────────────────────────────────────────
// One backend call now does what exchangeCodeForTokens + entraCallback +
// storeMsGraphToken used to do across three. The redemption moved server-side so
// the Graph refresh token is one the backend can actually redeem later.
const mockEntraComplete = vi.fn()

vi.mock('@/api/auth', () => ({
  entraComplete: (payload: unknown) => mockEntraComplete(payload),
}))

// ── helpers ───────────────────────────────────────────────────────────────────

/** Simulate the browser URL that Azure redirects back to. */
function setCallbackUrl(params: Record<string, string>) {
  const search = new URLSearchParams(params).toString()
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { search: `?${search}` },
  })
}

const PKCE = {
  code_verifier: 'verifier-xyz',
  redirect_uri: 'http://localhost:5174/auth/entra-complete',
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe('AuthCallbackPage — Entra sign-in completion', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    mockConsumePkce.mockReset()
    mockEntraComplete.mockReset()
    mockConsumePkce.mockReturnValue(PKCE)
    useAuthStore.setState({ user: null, isLoading: false })
  })

  // ── loading UI ──────────────────────────────────────────────────────────────

  it('renders the "Completing sign-in" spinner while the exchange is in flight', () => {
    // Keep the exchange pending so the component stays in the loading state.
    mockEntraComplete.mockReturnValue(new Promise(() => {}))
    setCallbackUrl({ code: 'auth-code', state: 'st-123' })

    render(<AuthCallbackPage />)

    expect(screen.getByText(/completing sign-in/i)).toBeInTheDocument()
  })

  // ── missing params ──────────────────────────────────────────────────────────

  it('redirects to /login when the code param is absent', async () => {
    setCallbackUrl({ state: 'st-123' })

    render(<AuthCallbackPage />)

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true })
    })
    expect(mockEntraComplete).not.toHaveBeenCalled()
  })

  it('redirects to /login when the state param is absent', async () => {
    setCallbackUrl({ code: 'auth-code' })

    render(<AuthCallbackPage />)

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true })
    })
    expect(mockEntraComplete).not.toHaveBeenCalled()
  })

  // ── happy path ──────────────────────────────────────────────────────────────

  it('sends the code with the stored PKCE material and stores the user', async () => {
    setCallbackUrl({ code: 'auth-code', state: 'st-123' })
    const user = makeUser({ role: 'inside_sales' })
    mockEntraComplete.mockResolvedValue(user)

    render(<AuthCallbackPage />)

    await vi.waitFor(() => {
      expect(mockConsumePkce).toHaveBeenCalledWith('st-123')
      expect(mockEntraComplete).toHaveBeenCalledWith({ code: 'auth-code', ...PKCE })
      expect(useAuthStore.getState().user).toEqual(user)
    })
  })

  it('never redeems the code in the browser — no token call leaves this page', async () => {
    // A browser redemption is exactly what produced SPA-bound refresh tokens
    // (AADSTS9002327) that the backend could never refresh for Calendar/Mail.
    const fetchSpy = vi.fn()
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    setCallbackUrl({ code: 'auth-code', state: 'st-123' })
    mockEntraComplete.mockResolvedValue(makeUser())

    render(<AuthCallbackPage />)

    await vi.waitFor(() => expect(mockEntraComplete).toHaveBeenCalled())
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // ── role-based routing ──────────────────────────────────────────────────────

  it.each([
    ['inside_sales', '/inside-sales/leads'],
    ['outside_sales', '/inside-sales/pipeline'],
    ['sales', '/inside-sales/pipeline'],
    ['maintenance_estimating', '/inside-sales/estimating'],
    ['marketing', '/settings'],
    ['ceo', '/inside-sales'],
    // BranchManagerPage removed in Slice 12; managers land on settings.
    // Analytics stays in the nav for them.
    ['manager', '/settings'],
    // Split field-sales roles, and legacy sales, land on the pipeline.
    ['maintenance_sales', '/inside-sales/pipeline'],
    ['install_sales', '/inside-sales/pipeline'],
  ])('navigates %s users to %s', async (role, route) => {
    setCallbackUrl({ code: 'auth-code', state: 'st-123' })
    mockEntraComplete.mockResolvedValue(makeUser({ role: role as 'inside_sales' }))

    render(<AuthCallbackPage />)

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(route, { replace: true })
    })
  })

  // ── error handling ──────────────────────────────────────────────────────────

  it('redirects to /login?error=sso_failed when the backend exchange throws', async () => {
    setCallbackUrl({ code: 'auth-code', state: 'st-123' })
    mockEntraComplete.mockRejectedValue(new Error('Microsoft sign-in failed'))

    render(<AuthCallbackPage />)

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        '/login?error=sso_failed',
        { replace: true },
      )
    })
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('redirects to /login?error=sso_failed when the state check fails', async () => {
    setCallbackUrl({ code: 'auth-code', state: 'tampered' })
    mockConsumePkce.mockImplementation(() => {
      throw new Error('Invalid OAuth state or missing PKCE verifier')
    })

    render(<AuthCallbackPage />)

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        '/login?error=sso_failed',
        { replace: true },
      )
    })
    expect(mockEntraComplete).not.toHaveBeenCalled()
  })
})
