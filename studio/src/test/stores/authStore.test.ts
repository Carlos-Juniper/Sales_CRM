import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore } from '@/store/authStore'
import { makeUser } from '../utils'

beforeEach(() => {
  useAuthStore.setState({ user: null, isLoading: false })
  localStorage.clear()
})

describe('authStore — initial state', () => {
  it('starts with user=null', () => {
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('starts with isLoading=false', () => {
    expect(useAuthStore.getState().isLoading).toBe(false)
  })
})

describe('authStore — login', () => {
  it('sets user with all fields', () => {
    const user = makeUser()
    useAuthStore.getState().login(user)
    const stored = useAuthStore.getState().user
    expect(stored).toEqual(user)
  })

  it('getState().user returns the logged-in user', () => {
    const user = makeUser({ id: 'u99', name: 'Jane' })
    useAuthStore.getState().login(user)
    expect(useAuthStore.getState().user?.id).toBe('u99')
    expect(useAuthStore.getState().user?.name).toBe('Jane')
  })

  it('writes studio-auth to localStorage', () => {
    useAuthStore.getState().login(makeUser())
    expect(localStorage.getItem('studio-auth')).not.toBeNull()
  })

  it('persists user WITHOUT token in localStorage', () => {
    const user = makeUser({ token: 'super-secret' })
    useAuthStore.getState().login(user)
    const raw = localStorage.getItem('studio-auth')!
    const parsed = JSON.parse(raw)
    expect(parsed.state.user).toBeDefined()
    expect(parsed.state.user.token).toBeUndefined()
  })

  it('in-memory state retains the token', () => {
    const user = makeUser({ token: 'keep-in-memory' })
    useAuthStore.getState().login(user)
    expect(useAuthStore.getState().user?.token).toBe('keep-in-memory')
  })

  it('stores correct role values', () => {
    const roles = ['inside_sales', 'outside_sales', 'manager'] as const
    for (const role of roles) {
      useAuthStore.getState().login(makeUser({ role }))
      expect(useAuthStore.getState().user?.role).toBe(role)
    }
  })
})

describe('authStore — logout', () => {
  it('clears user back to null', () => {
    useAuthStore.getState().login(makeUser())
    useAuthStore.getState().logout()
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('persists null user to localStorage after logout', () => {
    useAuthStore.getState().login(makeUser())
    useAuthStore.getState().logout()
    const raw = localStorage.getItem('studio-auth')!
    const parsed = JSON.parse(raw)
    expect(parsed.state.user).toBeNull()
  })

  it('calling logout when already logged out does not throw', () => {
    expect(() => useAuthStore.getState().logout()).not.toThrow()
    expect(useAuthStore.getState().user).toBeNull()
  })
})

describe('authStore — setLoading', () => {
  it('setLoading(true) sets isLoading to true', () => {
    useAuthStore.getState().setLoading(true)
    expect(useAuthStore.getState().isLoading).toBe(true)
  })

  it('setLoading(false) sets isLoading to false', () => {
    useAuthStore.getState().setLoading(true)
    useAuthStore.getState().setLoading(false)
    expect(useAuthStore.getState().isLoading).toBe(false)
  })
})
