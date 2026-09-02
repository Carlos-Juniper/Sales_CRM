import { useUIStore } from '@/store/uiStore'

type Theme = 'light' | 'dark' | 'system'

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System default' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

export function ThemeSection() {
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)

  return (
    <div data-testid="settings-section-theme" className="space-y-4 max-w-sm">
      <div>
        <h2 className="text-sm font-semibold text-[var(--fg)] mb-1">Theme</h2>
        <p className="text-xs text-[var(--fg)] opacity-60">
          Choose the color scheme for the application.
        </p>
      </div>
      <div>
        <label
          htmlFor="mine-theme-select"
          className="block text-xs font-medium text-[var(--fg)] mb-1"
        >
          Theme
        </label>
        <select
          id="mine-theme-select"
          value={theme}
          onChange={(e) => setTheme(e.target.value as Theme)}
          className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm w-full"
        >
          {THEME_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
