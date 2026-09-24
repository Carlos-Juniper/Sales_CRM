import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock environment variables before importing the module
vi.stubEnv('VITE_ENTRA_CLIENT_ID', 'test-client-id')
vi.stubEnv('VITE_ENTRA_TENANT_ID', 'test-tenant-id')

// Re-import after env setup
const { redirectToAzureLogin, consumePkce, isAuthCallbackPath, AUTH_CALLBACK_PATH } =
  await import('@/lib/azureAuth')

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

describe('azureAuth — redirect target', () => {
  beforeEach(() => {
    sessionStorage.clear()
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { origin: 'http://localhost:5174', href: '' },
    })
  })

  it('sends the Web-platform callback path, not the old SPA one', async () => {
    await redirectToAzureLogin()
    const url = new URL(window.location.href as string)
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:5174/auth/entra-complete',
    )
  })

  it('stores the redirect_uri it sent, so redemption can echo it back exactly', async () => {
    await redirectToAzureLogin()
    expect(sessionStorage.getItem('oauth_redirect_uri')).toBe(
      `http://localhost:5174${AUTH_CALLBACK_PATH}`,
    )
  })
})

describe('azureAuth — isAuthCallbackPath', () => {
  it('matches the current and the legacy callback routes', () => {
    expect(isAuthCallbackPath('/auth/entra-complete')).toBe(true)
    expect(isAuthCallbackPath('/auth/callback')).toBe(true)
  })

  it('does not match ordinary routes', () => {
    expect(isAuthCallbackPath('/login')).toBe(false)
    expect(isAuthCallbackPath('/inside-sales')).toBe(false)
  })
})

describe('azureAuth — consumePkce', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('returns the verifier and redirect_uri for backend redemption', () => {
    sessionStorage.setItem('oauth_state', 'state-abc')
    sessionStorage.setItem('pkce_verifier', 'verifier-xyz')
    sessionStorage.setItem('oauth_redirect_uri', 'http://localhost:5174/auth/entra-complete')

    expect(consumePkce('state-abc')).toEqual({
      code_verifier: 'verifier-xyz',
      redirect_uri: 'http://localhost:5174/auth/entra-complete',
    })
  })

  it('clears the stored material so a replayed callback cannot redeem twice', () => {
    sessionStorage.setItem('oauth_state', 'state-abc')
    sessionStorage.setItem('pkce_verifier', 'verifier-xyz')
    sessionStorage.setItem('oauth_redirect_uri', 'http://localhost:5174/auth/entra-complete')

    consumePkce('state-abc')

    expect(sessionStorage.getItem('pkce_verifier')).toBeNull()
    expect(sessionStorage.getItem('oauth_state')).toBeNull()
    expect(sessionStorage.getItem('oauth_redirect_uri')).toBeNull()
    expect(() => consumePkce('state-abc')).toThrow('Invalid OAuth state')
  })

  it('throws when state does not match', () => {
    sessionStorage.setItem('oauth_state', 'different-state')
    sessionStorage.setItem('pkce_verifier', 'verifier-xyz')
    sessionStorage.setItem('oauth_redirect_uri', 'http://localhost:5174/auth/entra-complete')

    expect(() => consumePkce('wrong-state')).toThrow('Invalid OAuth state')
  })

  it('throws when the redirect_uri was never stored', () => {
    sessionStorage.setItem('oauth_state', 'state-abc')
    sessionStorage.setItem('pkce_verifier', 'verifier-xyz')

    expect(() => consumePkce('state-abc')).toThrow('Invalid OAuth state')
  })
})
