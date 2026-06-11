import { cva } from 'class-variance-authority'

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
  {
    variants: {
      variant: {
        default: 'bg-[#2E7D52] text-white hover:bg-[#256644] focus-visible:ring-[#2E7D52]',
        destructive: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600',
        outline: 'border border-[hsl(var(--border))] bg-transparent hover:bg-[hsl(var(--muted))] text-[hsl(var(--fg))]',
        secondary: 'bg-[hsl(var(--muted))] text-[hsl(var(--fg))] hover:bg-[hsl(var(--border))]',
        ghost: 'hover:bg-[hsl(var(--muted))] text-[hsl(var(--fg))]',
        link: 'text-[#2E7D52] underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-7 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-9 w-9',
        'icon-sm': 'h-7 w-7',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)
