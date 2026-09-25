/**
 * Server errors arrive as `{ detail }` and apiClient puts that string on
 * Error.message. Prefer it; fall back when the failure has no body.
 */
export function errorDetail(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}
