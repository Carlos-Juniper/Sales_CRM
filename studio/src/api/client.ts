import { useAuthStore } from '@/store/authStore'
import { isAuthCallbackPath } from '@/lib/azureAuth'

const BASE_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api'

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, options: RequestInit = {}, skipContentType = false): Promise<T> {
  const defaultHeaders: HeadersInit = skipContentType ? {} : { 'Content-Type': 'application/json' }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  })
  if (res.status === 401) {
    useAuthStore.getState().logout()
    const { pathname } = window.location
    // DEV-only routes under /dev/ are fixture-driven and deliberately have no
    // session (see router.tsx). Without this exemption AuthBootstrap's me()
    // 401 bounces them to /login before they can ever mount. `import.meta.env.DEV`
    // is a literal false in a production build, so this collapses away there.
    const onDevRoute = import.meta.env.DEV && pathname.startsWith('/dev/')
    if (pathname !== '/login' && !isAuthCallbackPath(pathname) && !onDevRoute) {
      window.location.href = '/login'
    }
    throw new ApiError(401, 'Session expired')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new ApiError(res.status, body.detail ?? body.error ?? res.statusText)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  /**
   * Multipart form-data POST. Omits Content-Type so the browser sets the
   * multipart boundary automatically when body is a FormData instance.
   */
  postForm: <T>(path: string, form: FormData) =>
    request<T>(path, { method: 'POST', body: form }, /* skipContentType */ true),
}

export { ApiError }
