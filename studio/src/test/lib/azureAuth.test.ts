import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock environment variables before importing the module
vi.stubEnv('VITE_ENTRA_CLIENT_ID', 'test-client-id')
vi.stubEnv('VITE_ENTRA_TENANT_ID', 'test-tenant-id')

// Re-import after env setup
const { redirectToAzureLogin, exchangeCodeForTokens } = await import('@/lib/azureAuth')

describe('azureAuth — scope construction', () => {
  beforeEach(() => {
    // Reset sessionStorage between tests
    sessionStorage.clear()
    // Reset location
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { origin: 'http://localhost:5173', href: '' },
    })
  })

  it('redirectToAzureLogin includes Mail.Send in scope', async () => {
    await redirectToAzureLogin()
    const redirectHref = window.location.href as string
    const url = new URL(redirectHref)
    const scope = url.searchParams.get('scope') ?? ''
    expect(scope).toContain('Mail.Send')
  })

  it('redirectToAzureLogin includes Calendars.ReadWrite in scope', async () => {
    await redirectToAzureLogin()
    const redirectHref = window.location.href as string
    const url = new URL(redirectHref)
    const scope = url.searchParams.get('scope') ?? ''
    expect(scope).toContain('Calendars.ReadWrite')
  })

  it('redirectToAzureLogin includes offline_access in scope', async () => {
    await redirectToAzureLogin()
    const redirectHref = window.location.href as string
    const url = new URL(redirectHref)
    const scope = url.searchParams.get('scope') ?? ''
    expect(scope).toContain('offline_access')
  })

  it('redirectToAzureLogin still includes openid and email', async () => {
    await redirectToAzureLogin()
    const redirectHref = window.location.href as string
    const url = new URL(redirectHref)
    const scope = url.searchParams.get('scope') ?? ''
    expect(scope).toContain('openid')
    expect(scope).toContain('email')
  })

  it('redirectToAzureLogin uses S256 PKCE challenge method', async () => {
    await redirectToAzureLogin()
    const redirectHref = window.location.href as string
    const url = new URL(redirectHref)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })
})

describe('azureAuth — exchangeCodeForTokens', () => {
  it('returns id_token, access_token, refresh_token, expires_in, scope', async () => {
    sessionStorage.setItem('oauth_state', 'state-abc')
    sessionStorage.setItem('pkce_verifier', 'verifier-xyz')

    const mockResponse = {
      id_token: 'id-tok',
      access_token: 'at-xxx',
      refresh_token: 'rt-xxx',
      expires_in: 3600,
      scope: 'Mail.Send Calendars.ReadWrite',
    }

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    } as Response)

    const result = await exchangeCodeForTokens('auth-code-123', 'state-abc')

    expect(result.id_token).toBe('id-tok')
    expect(result.access_token).toBe('at-xxx')
    expect(result.refresh_token).toBe('rt-xxx')
    expect(result.expires_in).toBe(3600)
    expect(result.scope).toBe('Mail.Send Calendars.ReadWrite')
  })

  it('throws when state does not match', async () => {
    sessionStorage.setItem('oauth_state', 'different-state')
    sessionStorage.setItem('pkce_verifier', 'verifier-xyz')

    await expect(exchangeCodeForTokens('code', 'wrong-state')).rejects.toThrow(
      'Invalid OAuth state',
    )
  })

  it('throws when token exchange fails', async () => {
    sessionStorage.setItem('oauth_state', 'state-abc')
    sessionStorage.setItem('pkce_verifier', 'verifier-xyz')

    global.fetch = vi.fn().mockResolvedValue({ ok: false } as Response)

    await expect(exchangeCodeForTokens('code', 'state-abc')).rejects.toThrow(
      'Token exchange failed',
    )
  })
})
