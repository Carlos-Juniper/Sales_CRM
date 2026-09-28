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
  /**
   * Raw FastAPI `detail`. A string for most errors, a validation array for
   * Pydantic, or an object when the API returns a structured error code.
   */
  detail: unknown
  constructor(
    status: number,
    message: string,
    issues: ApiValidationIssue[] = [],
    detail: unknown = undefined,
  ) {
    super(message)
    this.status = status
    this.name = 'ApiError'
    this.issues = issues
    this.detail = detail
  }
}

function apiErrorFromBody(
  body: { detail?: unknown; error?: unknown },
  statusText: string,
): { message: string; issues: ApiValidationIssue[]; detail: unknown } {
  const { detail, error } = body
  if (typeof detail === 'string') return { message: detail, issues: [], detail }
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
    return { message: message || statusText, issues, detail }
  }
  if (detail && typeof detail === 'object') {
    // Structured error (code + payload). Wording stays in the frontend map.
    return { message: statusText, issues: [], detail }
  }
  if (typeof error === 'string') return { message: error, issues: [], detail: undefined }
  return { message: statusText, issues: [], detail: undefined }
}

async function send(path: string, options: RequestInit = {}, skipContentType = false): Promise<Response> {
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
    const { message, issues, detail } = apiErrorFromBody(body, res.statusText)
    throw new ApiError(res.status, message, issues, detail)
  }
  return res
}

async function request<T>(path: string, options: RequestInit = {}, skipContentType = false): Promise<T> {
  const res = await send(path, options, skipContentType)
  if (res.status === 204) return undefined as T
  return res.json()
}

async function requestWithHeaders<T>(path: string): Promise<{ data: T; headers: Headers }> {
  const res = await send(path)
  const data = (res.status === 204 ? undefined : await res.json()) as T
  return { data, headers: res.headers }
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  /**
   * GET that also returns response headers. Same-origin callers can read
   * every header. Cross-origin callers only see headers listed in
   * Access-Control-Expose-Headers; anything else is null from `headers.get`.
   */
  getWithHeaders: <T>(path: string) => requestWithHeaders<T>(path),
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
