import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MultiSelectFilterProps {
  label: string
  options: string[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}

export function MultiSelectFilter({ label, options, selected, onChange }: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const count = selected.size
  const isActive = count > 0

  useEffect(() => {
    if (!open) return

    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  function toggle(value: string) {
    const next = new Set(selected)
    if (next.has(value)) {
      next.delete(value)
    } else {
      next.add(value)
    }
    onChange(next)
  }

  function clearAll() {
    onChange(new Set())
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-1.5 h-[30px] px-2.5 rounded-lg text-xs font-medium border transition-colors',
          isActive
            ? 'border-[#2E7D52] bg-[#2E7D52]/10 text-[#2E7D52] font-semibold'
            : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--fg))]'
        )}
      >
        {label}
        {isActive && (
          <span className="text-[10px] font-bold bg-[#2E7D52] text-white rounded-full min-w-[16px] h-4 inline-flex items-center justify-center px-1">
            {count}
          </span>
        )}
        <ChevronDown
          className={cn(
            'h-3 w-3 transition-transform',
            open && 'rotate-180',
            isActive ? 'text-[#2E7D52]' : 'text-[hsl(var(--muted-fg))]'
          )}
        />
      </button>

      {open && (
        <div className="absolute top-[calc(100%+6px)] left-0 z-60 min-w-[180px] bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-lg shadow-lg py-1">
          <div className="max-h-[280px] overflow-y-auto">
            {options.map((opt) => {
              const on = selected.has(opt)
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggle(opt)}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-[hsl(var(--fg))] hover:bg-[hsl(var(--muted))] transition-colors text-left"
                >
                  <span
                    className={cn(
                      'w-4 h-4 rounded flex-shrink-0 border flex items-center justify-center',
                      on ? 'bg-[#2E7D52] border-[#2E7D52] text-white' : 'border-[hsl(var(--border))]'
                    )}
                  >
                    {on && <Check className="h-2.5 w-2.5" />}
                  </span>
                  {opt}
                </button>
              )
            })}
          </div>

          {isActive && (
            <div className="border-t border-[hsl(var(--border))] mt-1 pt-1">
              <button
                type="button"
                onClick={clearAll}
                className="flex items-center justify-center w-full px-3 py-1.5 text-xs text-[hsl(var(--muted-fg))] hover:bg-[hsl(var(--muted))] transition-colors"
              >
                Clear {label.toLowerCase()}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
