import { useEffect, useRef } from 'react'
import type { HeaderState } from './branchSelection'

/**
 * A native checkbox with an indeterminate ("some") state. `indeterminate` is a
 * DOM property with no HTML attribute, so it is set through a ref; browsers
 * then expose it to assistive tech as aria-checked="mixed".
 */
export function TriStateCheckbox({
  state,
  onChange,
  label,
  testId,
  disabled,
}: {
  state: HeaderState
  onChange: () => void
  label: string
  testId: string
  disabled?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some'
  }, [state])

  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      data-testid={testId}
      checked={state === 'all'}
      disabled={disabled}
      onChange={onChange}
    />
  )
}
