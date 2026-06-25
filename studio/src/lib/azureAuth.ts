const CLIENT_ID = import.meta.env.VITE_ENTRA_CLIENT_ID as string
const TENANT_ID = import.meta.env.VITE_ENTRA_TENANT_ID as string

// Graph scopes requested in addition to the base OpenID scopes.
// GRAPH_SCOPES can be overridden via env (e.g. for testing without M365 licenses).
const GRAPH_SCOPES = (import.meta.env.VITE_GRAPH_SCOPES as string | undefined)
  ?? 'Mail.Send Mail.Read Calendars.ReadWrite offline_access'

function getRedirectUri(): string {
  return `${window.location.origin}/auth/callback`
}

function randomString(len: number): string {
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
    .slice(0, len)
}

async function sha256base64url(plain: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain))
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

export async function redirectToAzureLogin(): Promise<void> {
  const verifier = randomString(64)
  const challenge = await sha256base64url(verifier)
  const state = randomString(32)

  sessionStorage.setItem('pkce_verifier', verifier)
  sessionStorage.setItem('oauth_state', state)

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: getRedirectUri(),
    response_mode: 'query',
    scope: `openid profile email ${GRAPH_SCOPES}`,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })

  window.location.href =
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?${params}`
}

export interface TokenResponse {
  id_token: string
  access_token: string
  refresh_token: string
  expires_in: number
  scope: string
}

export async function exchangeCodeForTokens(code: string, state: string): Promise<TokenResponse> {
  const storedState = sessionStorage.getItem('oauth_state')
  const verifier = sessionStorage.getItem('pkce_verifier')

  sessionStorage.removeItem('oauth_state')
  sessionStorage.removeItem('pkce_verifier')

  if (!verifier || state !== storedState) {
    throw new Error('Invalid OAuth state or missing PKCE verifier')
  }

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'authorization_code',
    code,
    redirect_uri: getRedirectUri(),
    code_verifier: verifier,
  })

  const resp = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
  )

  if (!resp.ok) throw new Error('Token exchange failed')

  const data = await resp.json()
  if (!data.id_token) throw new Error('No id_token in response')
  return {
    id_token: data.id_token as string,
    access_token: data.access_token as string,
    refresh_token: data.refresh_token as string,
    expires_in: data.expires_in as number,
    scope: data.scope as string,
  }
}

/** @deprecated Use exchangeCodeForTokens instead — kept for backwards compat */
export async function exchangeCodeForIdToken(code: string, state: string): Promise<string> {
  const tokens = await exchangeCodeForTokens(code, state)
  return tokens.id_token
}
