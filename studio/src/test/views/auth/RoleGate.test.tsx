import { describe, it, expect, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from '@/test/utils'
import { RoleGate } from '@/views/auth/RoleGate'
import { useAuthStore } from '@/store/authStore'
import { makeUser } from '@/test/utils'
import type { UserRole } from '@/types'

function setUser(role: UserRole) {
  useAuthStore.setState({ user: makeUser({ role }) })
}

describe('RoleGate', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null })
  })

  it('renders children when user has allowed role', () => {
    setUser('inside_sales')
    render(
      <RoleGate roles={['inside_sales']}>
        <div>Protected Content</div>
      </RoleGate>,
    )
    expect(screen.getByText('Protected Content')).toBeInTheDocument()
  })

  it('redirects to /login when no user is authenticated', () => {
    render(
      <RoleGate roles={['inside_sales']}>
        <div>Protected Content</div>
      </RoleGate>,
      { initialEntries: ['/inside-sales'] },
    )
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
  })

  it('redirects outside_sales user away from inside-sales routes', () => {
    setUser('outside_sales')
    render(
      <RoleGate roles={['inside_sales']}>
        <div>Protected Content</div>
      </RoleGate>,
    )
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
  })

  it('allows manager to access any route', () => {
    setUser('manager')
    render(
      <RoleGate roles={['inside_sales']}>
        <div>Protected Content</div>
      </RoleGate>,
    )
    expect(screen.getByText('Protected Content')).toBeInTheDocument()
  })

  it('uses custom redirectTo when role is denied', () => {
    setUser('outside_sales')
    render(
      <RoleGate roles={['inside_sales']} redirectTo="/outside-sales">
        <div>Protected Content</div>
      </RoleGate>,
    )
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
  })

  it('renders children when role matches inside roles list', () => {
    setUser('inside_sales')
    render(
      <RoleGate roles={['outside_sales', 'inside_sales']}>
        <span>Allowed</span>
      </RoleGate>,
    )
    expect(screen.getByText('Allowed')).toBeInTheDocument()
  })

  it('denies inside_sales user when only outside_sales is allowed', () => {
    setUser('inside_sales')
    render(
      <RoleGate roles={['outside_sales']}>
        <div>Protected</div>
      </RoleGate>,
    )
    expect(screen.queryByText('Protected')).not.toBeInTheDocument()
  })
})
