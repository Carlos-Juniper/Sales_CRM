import { cva } from 'class-variance-authority'

export const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-[#2E7D52] text-white',
        secondary: 'border-transparent bg-[hsl(var(--muted))] text-[hsl(var(--muted-fg))]',
        destructive: 'border-transparent bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
        outline: 'border-[hsl(var(--border))] text-[hsl(var(--fg))]',
        blue: 'border-transparent bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
        amber: 'border-transparent bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
        green: 'border-transparent bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
        red: 'border-transparent bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
        purple: 'border-transparent bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
        indigo: 'border-transparent bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
        zinc: 'border-transparent bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)
