import { describe, it, expect, beforeEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import { useUIStore } from '@/store/uiStore'
import { Sidebar } from '@/components/layout/Sidebar'
import ProposalsPage from '@/views/inside-sales/ProposalsPage'
import { filterProposalPackages } from '@/views/inside-sales/proposalPackageFilters'
import { mockProposalPackages } from '@/mocks/data'

function seedUser() {
  useAuthStore.setState({ user: makeUser({ name: 'Morgan Lee', role: 'sales' }) })
  useUIStore.setState({ selectedLeadId: null, toasts: [] })
}

describe('filterProposalPackages', () => {
  it('filters by status and search without using section names', () => {
    expect(filterProposalPackages(mockProposalPackages, '', 'won')).toHaveLength(1)
    expect(filterProposalPackages(mockProposalPackages, '', 'won')[0].title).toMatch(/Gilbert/)
    expect(filterProposalPackages(mockProposalPackages, 'dobson', 'all')).toHaveLength(1)
    expect(filterProposalPackages(mockProposalPackages, 'P-2026-SUSD', 'all')).toHaveLength(1)
    expect(filterProposalPackages(mockProposalPackages, 'introductory letter', 'all')).toHaveLength(0)
  })
})

describe('Sidebar proposals nav', () => {
  beforeEach(seedUser)

  it('labels the tab Proposals and drops Bid Tracker', () => {
    render(<Sidebar />)
    const link = screen.getByRole('link', { name: 'Proposals' })
    expect(link).toHaveAttribute('href', '/inside-sales/proposals')
    expect(screen.queryByRole('link', { name: /bid tracker/i })).not.toBeInTheDocument()
  })
})

describe('ProposalsPage', () => {
  beforeEach(seedUser)

  it('renders the package list without section chips', async () => {
    render(<ProposalsPage />)
    expect(screen.getByRole('heading', { name: 'Proposal Packages' })).toBeInTheDocument()
    expect(screen.getByLabelText('Search proposals')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new proposal package/i })).toBeInTheDocument()

    expect(await screen.findByText('City of Tempe — Parks RFP')).toBeInTheDocument()
    expect(screen.getByText('Dobson Ranch HOA')).toBeInTheDocument()
    expect(screen.queryByText('Town of Gilbert Parks RFP')).not.toBeInTheDocument()
    expect(screen.getByText('$420K')).toBeInTheDocument()
    expect(screen.getByText('$780K')).toBeInTheDocument()
    expect(screen.getByText('P-2026-TEMP01 · v2.0 · 18 pg')).toBeInTheDocument()

    const rows = screen.getAllByTestId('proposal-row')
    for (const row of rows) {
      expect(row).not.toHaveTextContent('Proposal Sent')
      expect(row).not.toHaveTextContent('Won')
      expect(row).not.toHaveTextContent('Lost')
      expect(row).not.toHaveTextContent('Contacted')
    }

    const maricopa = screen.getByRole('button', { name: /Maricopa County/ })
    expect(maricopa).toHaveTextContent('Unassigned')
    expect(maricopa).toHaveTextContent('P-2026-MARI01')
    expect(maricopa).not.toHaveTextContent(/\d+ pg/)

    expect(screen.queryByText(/introductory letter/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/scope of services/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/schedule of values/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/schedule of frequency/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/license information/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/insurance information/i)).not.toBeInTheDocument()
  })

  it('filters the visible rows from the search box', async () => {
    const user = userEvent.setup()
    render(<ProposalsPage />)
    await screen.findByText('Dobson Ranch HOA')
    await user.type(screen.getByLabelText('Search proposals'), 'dobson')
    expect(screen.getByText('Dobson Ranch HOA')).toBeInTheDocument()
    expect(screen.queryByText('City of Tempe — Parks RFP')).not.toBeInTheDocument()
  })

  it('opens the associated lead when a package row is clicked', async () => {
    const user = userEvent.setup()
    render(<ProposalsPage />)
    const row = await screen.findByRole('button', { name: /City of Tempe — Parks RFP/ })
    await user.click(row)

    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Mark Benson')).toBeInTheDocument()
    expect(useUIStore.getState().selectedLeadId).toBe('l2')
  })

  it('opens the shared generator and requires a lead and a property', async () => {
    const user = userEvent.setup()
    render(<ProposalsPage />)
    await screen.findByText('City of Tempe — Parks RFP')

    await user.click(screen.getByRole('button', { name: /new proposal package/i }))
    const dialog = await screen.findByRole('dialog', { name: /new proposal package/i })
    expect(within(dialog).getByText(/same generator used on a lead/i)).toBeInTheDocument()

    const search = within(dialog).getByLabelText('Search leads')
    await user.type(search, 'Silverleaf')
    const silverleaf = await within(dialog).findByRole('button', { name: /Silverleaf HOA/ })
    await user.click(silverleaf)

    expect(within(dialog).getByTestId('property-required')).toBeInTheDocument()
    expect(within(dialog).getByTestId('submit-proposal')).toBeDisabled()

    await user.click(within(dialog).getByRole('button', { name: 'Change' }))
    await user.type(within(dialog).getByLabelText('Search leads'), 'Tempe')
    const tempe = await within(dialog).findByRole('button', { name: /City of Tempe — Parks RFP/ })
    await user.click(tempe)

    expect(within(dialog).getByTestId('property-attached')).toBeInTheDocument()
    expect(within(dialog).getByTestId('submit-proposal')).toBeEnabled()
  })
})
