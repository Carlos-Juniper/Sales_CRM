import { create } from 'zustand'
import type { ToastVariant } from '@/components/ui/toast'

interface ToastItem {
  id: string
  title: string
  description?: string
  variant: ToastVariant
  open: boolean
}

interface UIState {
  theme: 'light' | 'dark' | 'system'
  sidebarCollapsed: boolean
  selectedLeadId: string | null
  toasts: ToastItem[]

  setTheme: (t: 'light' | 'dark' | 'system') => void
  toggleSidebar: () => void
  setSidebarCollapsed: (v: boolean) => void
  selectLead: (id: string | null) => void
  addToast: (toast: Omit<ToastItem, 'id' | 'open'>) => void
  dismissToast: (id: string) => void
  toast: (title: string, opts?: { description?: string; variant?: ToastVariant }) => void
}

export const useUIStore = create<UIState>()((set, get) => ({
  theme: 'system',
  sidebarCollapsed: false,
  selectedLeadId: null,
  toasts: [],

  setTheme: (theme) => set({ theme }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  selectLead: (selectedLeadId) => set({ selectedLeadId }),

  addToast: (toast) => {
    const id = crypto.randomUUID()
    set((s) => ({ toasts: [...s.toasts, { ...toast, id, open: true }] }))
    setTimeout(() => get().dismissToast(id), 4500)
  },

  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, open: false } : t)) })),

  toast: (title, opts = {}) =>
    get().addToast({ title, description: opts.description, variant: opts.variant ?? 'default' }),
}))
