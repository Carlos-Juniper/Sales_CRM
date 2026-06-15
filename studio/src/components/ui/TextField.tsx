import type { InputHTMLAttributes } from 'react'

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  required?: boolean
}

export function TextField({ label, required, className, ...props }: TextFieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-semibold text-[hsl(var(--fg))]">
        {label}{required && <span className="text-red-600 ml-0.5">*</span>}
      </span>
      <input
        className={`h-8 px-2.5 text-sm border border-[hsl(var(--border))] rounded-md bg-[hsl(var(--card))] text-[hsl(var(--fg))] focus:outline-none focus:ring-1 focus:ring-[#2E7D52]/50 ${className ?? ''}`}
        {...props}
      />
    </label>
  )
}
