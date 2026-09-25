import { describe, it, expect, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import { Sidebar } from '@/components/layout/Sidebar'
import type { UserRole } from '@/types'

const MANAGEMENT: UserRole[] = ['admin', 'manager', 'regional_director', 'vice_president', 'ceo']
const DENIED: UserRole[] = [
  'sales',
  'inside_sales',
  'maintenance_estimating',
  'install_estimating',
  'procurement',
  'marketing',
]

function renderSidebar(role: UserRole) {
  useAuthStore.setState({ user: makeUser({ role }) })
  render(<Sidebar />)
}

describe('Sidebar Analytics nav', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null })
  })

  it.each(MANAGEMENT)('%s sees the Analytics nav item', (role) => {
    renderSidebar(role)
    expect(screen.getByRole('link', { name: 'Analytics' })).toHaveAttribute('href', '/inside-sales')
  })

  it.each(DENIED)('%s does not see the Analytics nav item', (role) => {
    renderSidebar(role)
    expect(screen.queryByRole('link', { name: 'Analytics' })).not.toBeInTheDocument()
  })

  it('sales still sees the other sales nav items', () => {
    renderSidebar('sales')
    expect(screen.getByRole('link', { name: 'Pipeline' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Proposals' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Leads' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Public Leads' })).not.toBeInTheDocument()
  })

  it('estimators see Estimating and no proposal entry point', () => {
    renderSidebar('maintenance_estimating')
    expect(screen.getByRole('link', { name: 'Estimating' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Proposals' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Analytics' })).not.toBeInTheDocument()
  })
})
