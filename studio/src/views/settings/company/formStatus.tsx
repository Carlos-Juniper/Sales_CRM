import type { ReactNode } from 'react'

/**
 * Shared success/error status line for the Company config forms. Rendered with
 * ARIA roles so tests (and screen readers) can locate the outcome: `status`
 * for a save confirmation, `alert` for a failure.
 */
export function FormStatus({
  isSuccess,
  isError,
  successText = 'Saved',
  errorText = 'Could not save. Try again.',
}: {
  isSuccess: boolean
  isError: boolean
  successText?: string
  errorText?: string
}) {
  if (isError) {
    return (
      <p role="alert" className="mt-2 text-xs text-red-600">
        {errorText}
      </p>
    )
  }
  if (isSuccess) {
    return (
      <p role="status" className="mt-2 text-xs text-green-600">
        {successText}
      </p>
    )
  }
  return null
}

/** Small label for a roster row whose ownerUserId is null (legacy company/branch). */
export function LegacyOwnerBadge({ testId }: { testId: string }) {
  return (
    <span
      data-testid={testId}
      className="ml-2 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800"
    >
      Legacy
    </span>
  )
}

/** A titled section wrapper carrying the stable `settings-section-<slug>` testid. */
export function SettingsFormShell({
  slug,
  title,
  description,
  children,
}: {
  slug: string
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <div data-testid={`settings-section-${slug}`} className="max-w-xl">
      <h2 className="text-sm font-semibold text-[var(--fg)]">{title}</h2>
      {description && (
        <p className="mt-1 mb-4 text-xs text-[var(--fg)] opacity-60">
          {description}
        </p>
      )}
      {children}
    </div>
  )
}
