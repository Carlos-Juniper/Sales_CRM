import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AuthUser } from '@/types'

interface AuthState {
  user: AuthUser | null
  isLoading: boolean
  isInitialized: boolean
  login: (user: AuthUser) => void
  logout: () => void
  setLoading: (v: boolean) => void
  setInitialized: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isLoading: false,
      isInitialized: false,
      login: (user) => set({ user }),
      logout: () => set({ user: null }),
      setLoading: (isLoading) => set({ isLoading }),
      setInitialized: () => set({ isInitialized: true }),
    }),
    {
      name: 'studio-auth',
      partialize: (state) => ({ user: state.user }),
    }
  )
)
