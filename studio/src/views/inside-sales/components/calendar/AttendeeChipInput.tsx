import { useState, useRef, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface AttendeeChipInputProps {
  value: string[]
  onChange: (emails: string[]) => void
}

export function AttendeeChipInput({ value, onChange }: AttendeeChipInputProps) {
  const [inputValue, setInputValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function commit(raw: string) {
    const email = raw.trim()
    if (!email) return

    if (!EMAIL_REGEX.test(email)) {
      setError('Invalid email address')
      return
    }

    if (value.includes(email)) {
      setInputValue('')
      return
    }

    onChange([...value, email])
    setInputValue('')
    setError(null)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit(inputValue)
    } else if (e.key === ',') {
      e.preventDefault()
      commit(inputValue)
    }
  }

  function handleBlur() {
    if (inputValue.trim()) {
      commit(inputValue)
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    if (val.endsWith(',')) {
      commit(val.slice(0, -1))
    } else {
      setInputValue(val)
      if (error && !val) setError(null)
    }
  }

  function removeChip(email: string) {
    onChange(value.filter((v) => v !== email))
  }

  return (
    <div className="space-y-1.5">
      <div
        className={cn(
          'flex flex-wrap gap-1.5 min-h-[36px] w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-1.5',
          'focus-within:ring-2 focus-within:ring-[#2E7D52] focus-within:ring-offset-1',
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((email) => (
          <span
            key={email}
            data-chip
            className="inline-flex items-center gap-1 rounded-full bg-[#2E7D52]/10 px-2 py-0.5 text-xs text-[#2E7D52] font-medium"
          >
            {email}
            <button
              type="button"
              aria-label={`Remove ${email}`}
              onClick={(e) => {
                e.stopPropagation()
                removeChip(email)
              }}
              className="rounded-full hover:bg-[#2E7D52]/20 p-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={value.length === 0 ? 'Add attendees…' : ''}
          className="flex-1 min-w-[120px] bg-transparent text-sm text-[hsl(var(--fg))] placeholder:text-[hsl(var(--muted-fg))] outline-none"
          aria-label="Add attendees"
        />
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      )}
    </div>
  )
}
