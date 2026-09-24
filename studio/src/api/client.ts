import { useAuthStore } from '@/store/authStore'
import { isAuthCallbackPath } from '@/lib/azureAuth'

const BASE_URL = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api'

export interface ApiValidationIssue {
  loc: Array<string | number>
  msg: string
}

class ApiError extends Error {
  status: number
  /** FastAPI/Pydantic issues when `detail` is an array. Empty otherwise. */
  issues: ApiValidationIssue[]
  constructor(status: number, message: string, issues: ApiValidationIssue[] = []) {
    super(message)
    this.status = status
    this.name = 'ApiError'
    this.issues = issues
  }
}

function apiErrorFromBody(
  body: { detail?: unknown; error?: unknown },
  statusText: string,
): { message: string; issues: ApiValidationIssue[] } {
  const { detail, error } = body
  if (typeof detail === 'string') return { message: detail, issues: [] }
  if (Array.isArray(detail)) {
    const issues: ApiValidationIssue[] = []
    for (const item of detail) {
      if (!item || typeof item !== 'object') continue
      const rec = item as { loc?: unknown; msg?: unknown }
      if (typeof rec.msg !== 'string' || !rec.msg) continue
      const loc = Array.isArray(rec.loc)
        ? rec.loc.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number')
        : []
      issues.push({ loc, msg: rec.msg })
    }
    const message = issues.map((issue) => issue.msg).join('; ')
    return { message: message || statusText, issues }
  }
  if (typeof error === 'string') return { message: error, issues: [] }
  return { message: statusText, issues: [] }
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
    const { message, issues } = apiErrorFromBody(body, res.statusText)
    throw new ApiError(res.status, message, issues)
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
