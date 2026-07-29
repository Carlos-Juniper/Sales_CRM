/**
 * Small controlled selects backed by the vendored Aspire option lists.
 * Native <select> elements keep them trivially testable and accessible.
 */
import { useId } from 'react'
import {
  ASPIRE_BRANCH_CITIES,
  SERVICE_LINES,
  ASPIRE_LOST_REASONS,
} from '@/lib/estimating/aspireOptions'

const selectClass =
  'w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none'

interface StringSelectProps {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder?: string
  id?: string
}

export function BranchPicker({ value, onChange, label, placeholder = 'Select a branch…', id }: StringSelectProps) {
  const autoId = useId()
  const selectId = id ?? autoId
  return (
    <div>
      <label htmlFor={selectId} className="mb-1 block text-xs font-medium text-gray-600">
        {label}
      </label>
      <select id={selectId} className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {ASPIRE_BRANCH_CITIES.map((city) => (
          <option key={city} value={city}>
            {city}
          </option>
        ))}
      </select>
    </div>
  )
}

export function ServiceLineSelect({ value, onChange, label, placeholder, id }: StringSelectProps) {
  const autoId = useId()
  const selectId = id ?? autoId
  return (
    <div>
      <label htmlFor={selectId} className="mb-1 block text-xs font-medium text-gray-600">
        {label}
      </label>
      <select id={selectId} className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {placeholder && <option value="">{placeholder}</option>}
        {SERVICE_LINES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  )
}

interface LostReasonProps {
  value: number | null
  onChange: (id: number) => void
  label: string
  id?: string
}

export function LostReasonSelect({ value, onChange, label, id }: LostReasonProps) {
  const autoId = useId()
  const selectId = id ?? autoId
  return (
    <div>
      <label htmlFor={selectId} className="mb-1 block text-xs font-medium text-gray-600">
        {label}
      </label>
      <select
        id={selectId}
        className={selectClass}
        value={value ?? ''}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        <option value="">Select a reason…</option>
        {ASPIRE_LOST_REASONS.map((r) => (
          <option key={r.id} value={r.id}>
            {r.label}
          </option>
        ))}
      </select>
    </div>
  )
}
