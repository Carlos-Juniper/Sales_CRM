const CLIENT_ID = import.meta.env.VITE_ENTRA_CLIENT_ID as string
const TENANT_ID = import.meta.env.VITE_ENTRA_TENANT_ID as string

// Graph scopes requested in addition to the base OpenID scopes.
// GRAPH_SCOPES can be overridden via env (e.g. for testing without M365 licenses).
const GRAPH_SCOPES = (import.meta.env.VITE_GRAPH_SCOPES as string | undefined)
  ?? 'Mail.Send Mail.Read Calendars.ReadWrite offline_access'

// Where Entra sends the browser after sign-in. Registered under the **Web**
// platform in Entra, not SPA, because the authorization code is redeemed by our
// backend rather than by this file. That is the whole point of the path change:
// a code redeemed in the browser yields a SPA-bound refresh token that no
// server can ever redeem (AADSTS9002327), which left Calendar and Mail stuck in
// a reconnect loop no amount of reconnecting could clear.
export const AUTH_CALLBACK_PATH = '/auth/entra-complete'

// The previous SPA path. Still recognised as a callback route so a sign-in that
// was already in flight when a deploy landed doesn't strand the user somewhere
// that renders nothing; its code will fail the exchange and bounce to /login.
const LEGACY_CALLBACK_PATH = '/auth/callback'

/** True on either sign-in callback route — the pre-session part of the app. */
export function isAuthCallbackPath(pathname: string): boolean {
  return pathname === AUTH_CALLBACK_PATH || pathname === LEGACY_CALLBACK_PATH
}

function getRedirectUri(): string {
  return `${window.location.origin}${AUTH_CALLBACK_PATH}`
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
  const redirectUri = getRedirectUri()

  sessionStorage.setItem('pkce_verifier', verifier)
  sessionStorage.setItem('oauth_state', state)
  // Entra requires the redirect_uri on redemption to match the one sent here
  // byte for byte. Storing it means the backend is handed the exact value that
  // was used, rather than one re-derived from wherever the browser ended up.
  sessionStorage.setItem('oauth_redirect_uri', redirectUri)

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: `openid profile email ${GRAPH_SCOPES}`,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })

  window.location.href =
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize?${params}`
}

export interface PkceExchange {
  code_verifier: string
  redirect_uri: string
}

/**
 * Validate the returned state and hand back the PKCE material for redemption.
 *
 * Clears the stored values first so a replayed callback URL cannot be exchanged
 * twice, then throws if state doesn't match — the CSRF check that makes the
 * authorization code safe to carry through the browser.
 */
export function consumePkce(state: string): PkceExchange {
  const storedState = sessionStorage.getItem('oauth_state')
  const verifier = sessionStorage.getItem('pkce_verifier')
  const redirectUri = sessionStorage.getItem('oauth_redirect_uri')

  sessionStorage.removeItem('oauth_state')
  sessionStorage.removeItem('pkce_verifier')
  sessionStorage.removeItem('oauth_redirect_uri')

  if (!verifier || !redirectUri || state !== storedState) {
    throw new Error('Invalid OAuth state or missing PKCE verifier')
  }
  return { code_verifier: verifier, redirect_uri: redirectUri }
}
