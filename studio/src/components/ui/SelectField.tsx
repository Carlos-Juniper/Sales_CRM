import type { SelectHTMLAttributes } from 'react'

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  required?: boolean
}

export function SelectField({ label, required, className, children, ...props }: SelectFieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-[hsl(var(--fg))]">
        {label}{required && <span className="text-red-600 ml-0.5">*</span>}
      </span>
      <select
        className={`h-8 px-2.5 text-sm border border-[hsl(var(--border))] rounded-md bg-[hsl(var(--card))] text-[hsl(var(--fg))] focus:outline-none focus:ring-1 focus:ring-[#2E7D52]/50 ${className ?? ''}`}
        {...props}
      >
        {children}
      </select>
    </label>
  )
}
