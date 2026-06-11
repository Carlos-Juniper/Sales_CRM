import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useUIStore } from '@/store/uiStore'

const defaultState = {
  theme: 'system' as const,
  sidebarCollapsed: false,
  selectedLeadId: null,
  toasts: [],
}

beforeEach(() => {
  useUIStore.setState(defaultState)
  vi.useRealTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('uiStore — initial state', () => {
  it('theme defaults to system', () => {
    expect(useUIStore.getState().theme).toBe('system')
  })

  it('sidebarCollapsed defaults to false', () => {
    expect(useUIStore.getState().sidebarCollapsed).toBe(false)
  })

  it('selectedLeadId defaults to null', () => {
    expect(useUIStore.getState().selectedLeadId).toBeNull()
  })

  it('toasts defaults to empty array', () => {
    expect(useUIStore.getState().toasts).toEqual([])
  })
})

describe('uiStore — setTheme', () => {
  it('setTheme(dark) sets theme to dark', () => {
    useUIStore.getState().setTheme('dark')
    expect(useUIStore.getState().theme).toBe('dark')
  })

  it('setTheme(light) sets theme to light', () => {
    useUIStore.getState().setTheme('light')
    expect(useUIStore.getState().theme).toBe('light')
  })

  it('setTheme(system) sets theme to system', () => {
    useUIStore.getState().setTheme('dark')
    useUIStore.getState().setTheme('system')
    expect(useUIStore.getState().theme).toBe('system')
  })
})

describe('uiStore — sidebar', () => {
  it('toggleSidebar flips false to true', () => {
    useUIStore.getState().toggleSidebar()
    expect(useUIStore.getState().sidebarCollapsed).toBe(true)
  })

  it('toggleSidebar flips true to false', () => {
    useUIStore.setState({ sidebarCollapsed: true })
    useUIStore.getState().toggleSidebar()
    expect(useUIStore.getState().sidebarCollapsed).toBe(false)
  })

  it('setSidebarCollapsed(true) sets to true', () => {
    useUIStore.getState().setSidebarCollapsed(true)
    expect(useUIStore.getState().sidebarCollapsed).toBe(true)
  })

  it('setSidebarCollapsed(false) sets to false', () => {
    useUIStore.setState({ sidebarCollapsed: true })
    useUIStore.getState().setSidebarCollapsed(false)
    expect(useUIStore.getState().sidebarCollapsed).toBe(false)
  })
})

describe('uiStore — selectLead', () => {
  it('selectLead(id) sets selectedLeadId', () => {
    useUIStore.getState().selectLead('abc')
    expect(useUIStore.getState().selectedLeadId).toBe('abc')
  })

  it('selectLead(null) clears selectedLeadId', () => {
    useUIStore.getState().selectLead('abc')
    useUIStore.getState().selectLead(null)
    expect(useUIStore.getState().selectedLeadId).toBeNull()
  })

  it('selecting a different lead updates selectedLeadId', () => {
    useUIStore.getState().selectLead('l1')
    useUIStore.getState().selectLead('l2')
    expect(useUIStore.getState().selectedLeadId).toBe('l2')
  })
})

describe('uiStore — toasts', () => {
  it('addToast adds a toast with generated id and open=true', () => {
    useUIStore.getState().addToast({ title: 'Saved', variant: 'success' })
    const { toasts } = useUIStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].title).toBe('Saved')
    expect(toasts[0].variant).toBe('success')
    expect(toasts[0].open).toBe(true)
    expect(toasts[0].id).toBeDefined()
    expect(typeof toasts[0].id).toBe('string')
  })

  it('addToast with description stores description', () => {
    useUIStore.getState().addToast({ title: 'Error', description: 'Something went wrong', variant: 'error' })
    const { toasts } = useUIStore.getState()
    expect(toasts[0].description).toBe('Something went wrong')
  })

  it('adding multiple toasts accumulates them', () => {
    useUIStore.getState().addToast({ title: 'First', variant: 'default' })
    useUIStore.getState().addToast({ title: 'Second', variant: 'success' })
    useUIStore.getState().addToast({ title: 'Third', variant: 'error' })
    expect(useUIStore.getState().toasts).toHaveLength(3)
  })

  it('each toast gets a unique id', () => {
    useUIStore.getState().addToast({ title: 'A', variant: 'default' })
    useUIStore.getState().addToast({ title: 'B', variant: 'default' })
    const { toasts } = useUIStore.getState()
    expect(toasts[0].id).not.toBe(toasts[1].id)
  })

  it('dismissToast sets open=false for that toast (does not remove from array)', () => {
    useUIStore.getState().addToast({ title: 'Hello', variant: 'default' })
    const id = useUIStore.getState().toasts[0].id
    useUIStore.getState().dismissToast(id)
    const { toasts } = useUIStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].open).toBe(false)
  })

  it('dismissToast only affects the targeted toast', () => {
    useUIStore.getState().addToast({ title: 'A', variant: 'default' })
    useUIStore.getState().addToast({ title: 'B', variant: 'default' })
    const id = useUIStore.getState().toasts[0].id
    useUIStore.getState().dismissToast(id)
    const { toasts } = useUIStore.getState()
    expect(toasts[0].open).toBe(false)
    expect(toasts[1].open).toBe(true)
  })

  it('dismissToast on non-existent id is a no-op', () => {
    useUIStore.getState().addToast({ title: 'Hi', variant: 'default' })
    expect(() => useUIStore.getState().dismissToast('does-not-exist')).not.toThrow()
    expect(useUIStore.getState().toasts[0].open).toBe(true)
  })

  it('toast() convenience method adds a toast with the provided title', () => {
    useUIStore.getState().toast('Quick message')
    const { toasts } = useUIStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].title).toBe('Quick message')
    expect(toasts[0].variant).toBe('default')
  })

  it('toast() with opts sets variant and description', () => {
    useUIStore.getState().toast('Saved!', { variant: 'success', description: 'All changes saved.' })
    const t = useUIStore.getState().toasts[0]
    expect(t.variant).toBe('success')
    expect(t.description).toBe('All changes saved.')
  })

  it('toast auto-dismisses after 4500ms', () => {
    vi.useFakeTimers()
    useUIStore.getState().addToast({ title: 'Temp', variant: 'default' })
    const id = useUIStore.getState().toasts[0].id
    expect(useUIStore.getState().toasts[0].open).toBe(true)
    vi.advanceTimersByTime(4500)
    expect(useUIStore.getState().toasts.find(t => t.id === id)?.open).toBe(false)
  })

  it('toast does not auto-dismiss before 4500ms', () => {
    vi.useFakeTimers()
    useUIStore.getState().addToast({ title: 'Persist', variant: 'default' })
    vi.advanceTimersByTime(4499)
    expect(useUIStore.getState().toasts[0].open).toBe(true)
  })
})
