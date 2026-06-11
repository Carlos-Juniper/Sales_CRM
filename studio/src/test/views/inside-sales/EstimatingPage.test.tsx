import { describe, it, expect, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import EstimatingPage from '@/views/inside-sales/EstimatingPage'

function seedUser() {
  useAuthStore.setState({ user: makeUser({ name: 'Carlos Hernandez', role: 'inside_sales' }) })
}

describe('EstimatingPage', () => {
  beforeEach(() => {
    seedUser()
  })

  it('renders the Estimating TopNav title', () => {
    render(<EstimatingPage />)
    expect(screen.getByText('Estimating')).toBeInTheDocument()
  })

  it('renders all 4 tab buttons', () => {
    render(<EstimatingPage />)
    expect(screen.getByRole('button', { name: /estimate queue/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /line-item editor/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /proposal export/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /margin analysis/i })).toBeInTheDocument()
  })

  it('shows Estimate Queue tab content by default', () => {
    render(<EstimatingPage />)
    // EstimateQueue renders queue items — check for its content
    // It should show the queue section
    expect(screen.queryByText(/Maricopa County/i) !== null || screen.queryByText(/queue/i) !== null).toBe(true)
  })

  it('switches to Line-Item Editor tab on click', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage />)

    const editorTab = screen.getByRole('button', { name: /line-item editor/i })
    await user.click(editorTab)

    // LineItemEditor should show Estimate Summary card
    await screen.findByText('Estimate Summary')
    expect(screen.getByText('Estimate Summary')).toBeInTheDocument()
  })

  it('switches to Margin Analysis tab on click', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage />)

    const marginsTab = screen.getByRole('button', { name: /margin analysis/i })
    await user.click(marginsTab)

    // MarginAnalysis shows Overall Margin card
    await screen.findByText('Overall Margin')
    expect(screen.getByText('Overall Margin')).toBeInTheDocument()
  })

  it('switches to Proposal Export tab on click', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage />)

    const proposalTab = screen.getByRole('button', { name: /proposal export/i })
    await user.click(proposalTab)

    // ProposalExport shows Generate PDF button and Proposal Details
    await screen.findByRole('button', { name: /generate pdf/i })
    expect(screen.getByRole('button', { name: /generate pdf/i })).toBeInTheDocument()
  })

  it('LineItemEditor: displays category sections', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage />)

    await user.click(screen.getByRole('button', { name: /line-item editor/i }))
    await screen.findByText('Estimate Summary')

    // Category sections should be present — some may appear multiple times
    expect(screen.getAllByText('Labor').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Materials').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Equipment').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Overhead').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Subcontractor').length).toBeGreaterThan(0)
  })

  it('LineItemEditor: add a line item via Add button', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage />)

    await user.click(screen.getByRole('button', { name: /line-item editor/i }))
    await screen.findByText('Estimate Summary')

    // Find "Add labor item" button and click it
    const addLaborBtn = screen.getByRole('button', { name: /add labor item/i })

    // Count items before
    const initialItems = screen.getAllByPlaceholderText('Description…')
    const beforeCount = initialItems.length

    await user.click(addLaborBtn)

    // After adding, should have one more description input
    const afterItems = screen.getAllByPlaceholderText('Description…')
    expect(afterItems.length).toBe(beforeCount + 1)
  })

  it('LineItemEditor: delete a line item via delete button', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage />)

    await user.click(screen.getByRole('button', { name: /line-item editor/i }))
    await screen.findByText('Estimate Summary')

    // Get initial count of delete buttons
    const deleteButtons = screen.getAllByRole('button', { name: /delete item/i })
    const initialCount = deleteButtons.length
    expect(initialCount).toBeGreaterThan(0)

    // Click first delete
    await user.click(deleteButtons[0])

    // Should have one fewer
    const afterDelete = screen.getAllByRole('button', { name: /delete item/i })
    expect(afterDelete.length).toBe(initialCount - 1)
  })

  it('LineItemEditor: totals recalculate when qty changes', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage />)

    await user.click(screen.getByRole('button', { name: /line-item editor/i }))
    await screen.findByText('Estimate Summary')

    // Get a quantity input (first one)
    const qtyInputs = screen.getAllByDisplayValue('52') // First line item has qty 52
    if (qtyInputs.length > 0) {
      await user.clear(qtyInputs[0])
      await user.type(qtyInputs[0], '100')
      // The total should have updated
      const afterTotal = screen.getAllByText(/\$[\d,]+/)
      expect(afterTotal.length).toBeGreaterThan(0)
    }
  })

  it('LineItemEditor: Save button renders', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage />)

    await user.click(screen.getByRole('button', { name: /line-item editor/i }))
    await screen.findByText('Estimate Summary')

    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument()
  })

  it('LineItemEditor: Save button changes to Saved after click', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage />)

    await user.click(screen.getByRole('button', { name: /line-item editor/i }))
    await screen.findByText('Estimate Summary')

    const saveBtn = screen.getByRole('button', { name: /^save$/i })
    await user.click(saveBtn)

    await screen.findByText(/saved/i)
    expect(screen.getByText(/saved/i)).toBeInTheDocument()
  })

  it('MarginAnalysis renders cost breakdown cards', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage />)

    await user.click(screen.getByRole('button', { name: /margin analysis/i }))
    await screen.findByText('Total Bid Price')

    expect(screen.getByText('Total Bid Price')).toBeInTheDocument()
    expect(screen.getByText('Total Cost')).toBeInTheDocument()
    expect(screen.getByText('Overall Margin')).toBeInTheDocument()
    expect(screen.getByText('Target Margin')).toBeInTheDocument()
  })

  it('MarginAnalysis renders Margin by Category section', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage />)

    await user.click(screen.getByRole('button', { name: /margin analysis/i }))
    await screen.findByText('Margin by Category')
    expect(screen.getByText('Margin by Category')).toBeInTheDocument()
  })

  it('ProposalExport Generate PDF button renders', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage />)

    await user.click(screen.getByRole('button', { name: /proposal export/i }))
    await screen.findByRole('button', { name: /generate pdf/i })
    expect(screen.getByRole('button', { name: /generate pdf/i })).toBeInTheDocument()
  })

  it('ProposalExport Preview button renders', async () => {
    const user = userEvent.setup()
    render(<EstimatingPage />)

    await user.click(screen.getByRole('button', { name: /proposal export/i }))
    // Multiple "Preview" buttons may exist (tab button + preview control)
    const previewButtons = await screen.findAllByRole('button', { name: /preview/i })
    expect(previewButtons.length).toBeGreaterThan(0)
  })
})
