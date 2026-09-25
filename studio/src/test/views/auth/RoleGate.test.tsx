// ---------------------------------------------------------------------------
// RoleGate under the canonical 10-role model:
//   * `inside_sales` is canonical; only legacy `outside_sales` maps to `sales`
//   * `admin` is the super-role; `manager` narrows to its approval tier
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from '@/test/utils'
import { RoleGate } from '@/views/auth/RoleGate'
import { useAuthStore } from '@/store/authStore'
import { makeUser } from '@/test/utils'
import type { LegacyUserRole, UserRole } from '@/types'

function setUser(role: UserRole | LegacyUserRole) {
  useAuthStore.setState({ user: makeUser({ role }) })
}

describe('RoleGate', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null })
  })

  it('renders children when user has allowed role', () => {
    setUser('sales')
    render(
      <RoleGate roles={['sales']}>
        <div>Protected Content</div>
      </RoleGate>,
    )
    expect(screen.getByText('Protected Content')).toBeInTheDocument()
  })

  it('redirects to /login when no user is authenticated', () => {
    render(
      <RoleGate roles={['sales']}>
        <div>Protected Content</div>
      </RoleGate>,
      { initialEntries: ['/inside-sales'] },
    )
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
  })

  it('legacy outside_sales users normalize to sales and pass sales gates', () => {
    useAuthStore.setState({ user: null })
    setUser('outside_sales')
    render(
      <RoleGate roles={['sales']}>
        <div>Sales Content</div>
      </RoleGate>,
    )
    expect(screen.getByText('Sales Content')).toBeInTheDocument()
  })

  it('inside_sales is canonical — it passes its own gate, not the sales gate', () => {
    useAuthStore.setState({ user: null })
    setUser('inside_sales')
    render(
      <RoleGate roles={['inside_sales']}>
        <div>Inside Sales Content</div>
      </RoleGate>,
    )
    expect(screen.getByText('Inside Sales Content')).toBeInTheDocument()
  })

  it('admin is the super-role and passes any gate', () => {
    setUser('admin')
    render(
      <RoleGate roles={['manager']}>
        <div>Protected Content</div>
      </RoleGate>,
    )
    expect(screen.getByText('Protected Content')).toBeInTheDocument()
  })

  it('vp_sales shares the admin super-role and passes any gate', () => {
    setUser('vp_sales')
    render(
      <RoleGate roles={['manager']}>
        <div>Protected Content</div>
      </RoleGate>,
    )
    expect(screen.getByText('Protected Content')).toBeInTheDocument()
  })

  it('regional_director is not a super-role', () => {
    setUser('regional_director')
    render(
      <RoleGate roles={['sales']} redirectTo="/inside-sales">
        <div>Protected Content</div>
      </RoleGate>,
    )
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
  })

  it('manager is NOT a super-role: denied on gates that exclude it', () => {
    setUser('manager')
    render(
      <RoleGate roles={['sales']} redirectTo="/inside-sales">
        <div>Protected Content</div>
      </RoleGate>,
    )
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument()
  })

  it('estimating roles pass estimating gates', () => {
    setUser('maintenance_estimating')
    render(
      <RoleGate roles={['maintenance_estimating', 'install_estimating']}>
        <div>Estimating Content</div>
      </RoleGate>,
    )
    expect(screen.getByText('Estimating Content')).toBeInTheDocument()
  })

  it('denies a role not in the allowed list', () => {
    setUser('procurement')
    render(
      <RoleGate roles={['manager']}>
        <div>Protected</div>
      </RoleGate>,
    )
    expect(screen.queryByText('Protected')).not.toBeInTheDocument()
  })
})
