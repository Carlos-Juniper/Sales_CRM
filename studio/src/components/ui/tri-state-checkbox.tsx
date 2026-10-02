import * as React from 'react'
import { cn } from '@/lib/utils'

/** Checked state of a tri-state checkbox: every, some, or none of its items. */
export type CheckState = 'all' | 'some' | 'none'

export interface TriStateCheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked' | 'defaultChecked'> {
  state: CheckState
}

/**
 * A native checkbox with an indeterminate ("some") state. `indeterminate` is a
 * DOM property with no HTML attribute, so it is set through a ref; browsers
 * then expose it to assistive tech as aria-checked="mixed". Give it a stable
 * accessible name (e.g. "All branches"): the checked state carries the rest.
 */
const TriStateCheckbox = React.forwardRef<HTMLInputElement, TriStateCheckboxProps>(
  ({ state, className, ...props }, ref) => {
    const innerRef = React.useRef<HTMLInputElement>(null)
    React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement, [])

    // Layout effect so the box never paints a stale state, and no dependency
    // array: clicking an indeterminate box clears `indeterminate` in the DOM,
    // so it is re-asserted from props on every render.
    React.useLayoutEffect(() => {
      if (innerRef.current) innerRef.current.indeterminate = state === 'some'
    })

    return (
      <input
        ref={innerRef}
        type="checkbox"
        checked={state === 'all'}
        className={cn('accent-[#2E7D52] disabled:cursor-not-allowed', className)}
        {...props}
      />
    )
  }
)
TriStateCheckbox.displayName = 'TriStateCheckbox'

export { TriStateCheckbox }
