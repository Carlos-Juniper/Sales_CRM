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
const mockExchangeCodeForTokens = vi.fn()

vi.mock('@/lib/azureAuth', () => ({
  exchangeCodeForTokens: (code: string, state: string) =>
    mockExchangeCodeForTokens(code, state),
}))

// ── api/auth ──────────────────────────────────────────────────────────────────
const mockEntraCallback = vi.fn()
const mockStoreMsGraphToken = vi.fn()

vi.mock('@/api/auth', () => ({
  entraCallback: (idToken: string) => mockEntraCallback(idToken),
  storeMsGraphToken: (payload: unknown) => mockStoreMsGraphToken(payload),
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

const GOOD_TOKENS = {
  id_token: 'id-tok',
  access_token: 'at-xxx',
  refresh_token: 'rt-xxx',
  expires_in: 3600,
  scope: 'Mail.Send Calendars.ReadWrite',
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe('AuthCallbackPage — Entra token exchange', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    mockExchangeCodeForTokens.mockReset()
    mockEntraCallback.mockReset()
    mockStoreMsGraphToken.mockReset()
    useAuthStore.setState({ user: null, isLoading: false })
  })

  // ── loading UI ──────────────────────────────────────────────────────────────

  it('renders the "Completing sign-in" spinner while the exchange is in flight', () => {
    // Keep exchange pending so the component stays in the loading state.
    mockExchangeCodeForTokens.mockReturnValue(new Promise(() => {}))
    setCallbackUrl({ code: 'auth-code', state: 'st-123' })

    render(<AuthCallbackPage />)

    expect(screen.getByText(/completing sign-in/i)).toBeInTheDocument()
  })

  // ── missing params ──────────────────────────────────────────────────────────

  it('redirects to /login when the code param is absent', async () => {
    setCallbackUrl({ state: 'st-123' })

    render(<AuthCallbackPage />)

    // Let the microtask queue flush.
    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true })
    })
    expect(mockExchangeCodeForTokens).not.toHaveBeenCalled()
  })

  it('redirects to /login when the state param is absent', async () => {
    setCallbackUrl({ code: 'auth-code' })

    render(<AuthCallbackPage />)

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true })
    })
    expect(mockExchangeCodeForTokens).not.toHaveBeenCalled()
  })

  // ── happy path ──────────────────────────────────────────────────────────────

  it('exchanges code for tokens, calls entraCallback, and stores the user', async () => {
    setCallbackUrl({ code: 'auth-code', state: 'st-123' })
    mockExchangeCodeForTokens.mockResolvedValue(GOOD_TOKENS)
    const user = makeUser({ role: 'inside_sales' })
    mockEntraCallback.mockResolvedValue(user)
    mockStoreMsGraphToken.mockResolvedValue({ ok: true })

    render(<AuthCallbackPage />)

    await vi.waitFor(() => {
      expect(mockExchangeCodeForTokens).toHaveBeenCalledWith('auth-code', 'st-123')
    })
    expect(mockEntraCallback).toHaveBeenCalledWith(GOOD_TOKENS.id_token)
    expect(useAuthStore.getState().user).toEqual(user)
  })

  it('stores Graph tokens server-side after a successful exchange', async () => {
    setCallbackUrl({ code: 'auth-code', state: 'st-123' })
    mockExchangeCodeForTokens.mockResolvedValue(GOOD_TOKENS)
    mockEntraCallback.mockResolvedValue(makeUser())
    mockStoreMsGraphToken.mockResolvedValue({ ok: true })

    render(<AuthCallbackPage />)

    await vi.waitFor(() => {
      expect(mockStoreMsGraphToken).toHaveBeenCalledWith({
        access_token: GOOD_TOKENS.access_token,
        refresh_token: GOOD_TOKENS.refresh_token,
        expires_in: GOOD_TOKENS.expires_in,
        scope: GOOD_TOKENS.scope,
      })
    })
  })

  // ── role-based routing ──────────────────────────────────────────────────────

  it('navigates inside_sales users to /inside-sales', async () => {
    setCallbackUrl({ code: 'auth-code', state: 'st-123' })
    mockExchangeCodeForTokens.mockResolvedValue(GOOD_TOKENS)
    mockEntraCallback.mockResolvedValue(makeUser({ role: 'inside_sales' }))
    mockStoreMsGraphToken.mockResolvedValue({ ok: true })

    render(<AuthCallbackPage />)

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/inside-sales', { replace: true })
    })
  })

  it('navigates outside_sales users to /outside-sales', async () => {
    setCallbackUrl({ code: 'auth-code', state: 'st-123' })
    mockExchangeCodeForTokens.mockResolvedValue(GOOD_TOKENS)
    mockEntraCallback.mockResolvedValue(makeUser({ role: 'outside_sales' }))
    mockStoreMsGraphToken.mockResolvedValue({ ok: true })

    render(<AuthCallbackPage />)

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/outside-sales', { replace: true })
    })
  })

  it('navigates manager users to /branch-manager', async () => {
    setCallbackUrl({ code: 'auth-code', state: 'st-123' })
    mockExchangeCodeForTokens.mockResolvedValue(GOOD_TOKENS)
    mockEntraCallback.mockResolvedValue(makeUser({ role: 'manager' }))
    mockStoreMsGraphToken.mockResolvedValue({ ok: true })

    render(<AuthCallbackPage />)

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/branch-manager', { replace: true })
    })
  })

  // ── error handling ──────────────────────────────────────────────────────────

  it('redirects to /login?error=sso_failed when token exchange throws', async () => {
    setCallbackUrl({ code: 'auth-code', state: 'st-123' })
    mockExchangeCodeForTokens.mockRejectedValue(new Error('Token exchange failed'))

    render(<AuthCallbackPage />)

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        '/login?error=sso_failed',
        { replace: true },
      )
    })
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('redirects to /login?error=sso_failed when entraCallback throws', async () => {
    setCallbackUrl({ code: 'auth-code', state: 'st-123' })
    mockExchangeCodeForTokens.mockResolvedValue(GOOD_TOKENS)
    mockEntraCallback.mockRejectedValue(new Error('Backend refused token'))

    render(<AuthCallbackPage />)

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        '/login?error=sso_failed',
        { replace: true },
      )
    })
  })

  it('still navigates the user on success even when storeMsGraphToken fails', async () => {
    setCallbackUrl({ code: 'auth-code', state: 'st-123' })
    mockExchangeCodeForTokens.mockResolvedValue(GOOD_TOKENS)
    const user = makeUser({ role: 'inside_sales' })
    mockEntraCallback.mockResolvedValue(user)
    // Graph token store is best-effort — failure must not block sign-in.
    mockStoreMsGraphToken.mockRejectedValue(new Error('Graph store unavailable'))

    render(<AuthCallbackPage />)

    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/inside-sales', { replace: true })
    })
    expect(useAuthStore.getState().user).toEqual(user)
  })
})
