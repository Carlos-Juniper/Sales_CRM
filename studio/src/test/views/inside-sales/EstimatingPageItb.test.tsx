// ---------------------------------------------------------------------------
// ITB tab renders REAL bids (no more empty arrays).
//
// EstimatingPage feeds ItbTracker from GET /api/estimating/itb/projects (via
// useItbProjects) and scopes from the config API. The tracker's own
// grouping/filter/legend logic is covered by ItbTracker.test.tsx — here we
// prove the wiring: seeded active estimates appear as rows with their
// auto-initialized scope statuses.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import EstimatingPage from '@/views/inside-sales/EstimatingPage'

describe('EstimatingPage — ITB Tracker tab (wiring)', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: makeUser({ name: 'Carlos Hernandez', role: 'inside_sales' }) })
  })

  it('renders real ITB projects fetched from the API', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage />)

    await user.click(screen.getByRole('tab', { name: 'ITB Tracker' }))
    expect(screen.getByTestId('itb-tracker')).toBeInTheDocument()

    // Seeded active estimates surface as tracker rows (auto-generated projects).
    await waitFor(() => {
      expect(
        screen.getByText('Dobson Ranch HOA — Grounds Maintenance'),
      ).toBeInTheDocument()
    })
    expect(screen.getByText('Silverleaf — Phase 2 Installation')).toBeInTheDocument()

    // The rebid de-dup stat computes from the real (non-empty) data set.
    await waitFor(() => {
      const count = Number(screen.getByTestId('stat-project-count').textContent)
      expect(count).toBeGreaterThanOrEqual(2)
    })
    expect(screen.getByTestId('stat-rebids')).toHaveTextContent('0')
  })
})
