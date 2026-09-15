// ---------------------------------------------------------------------------
// ChapterReorderPanel.test.tsx
//
// Actually driving @dnd-kit's pointer-sensor drag in jsdom is unreliable, so
// this covers the panel's real contract instead: it lists the given chapter
// keys as readable titles in order, and "Save order" persists the CURRENT
// (possibly-reordered) list via useUpdateProposal, then closes. The list-
// reconciliation logic itself (what order results from a drag) is covered
// behaviourally in lib/proposal/chapters.test.ts and ProposalPreview.test.tsx.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest'
import { screen, within, fireEvent } from '@testing-library/react'
import { render } from '@/test/utils'
import { ChapterReorderPanel } from '@/views/inside-sales/components/estimating/ChapterReorderPanel'

vi.mock('@/hooks/useProposals', () => ({
  useUpdateProposal: vi.fn(),
}))

import { useUpdateProposal } from '@/hooks/useProposals'

const mockUseUpdateProposal = useUpdateProposal as MockedFunction<typeof useUpdateProposal>

function makeMutation(overrides?: Partial<ReturnType<typeof useUpdateProposal>>) {
  return {
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
    ...overrides,
  } as unknown as ReturnType<typeof useUpdateProposal>
}

beforeEach(() => {
  mockUseUpdateProposal.mockReturnValue(makeMutation())
})

const CHAPTER_KEYS = ['rooted-in-florida', 'our-services', 'portfolio']

describe('ChapterReorderPanel', () => {
  it('lists each chapter key as a readable title, in order', () => {
    render(
      <ChapterReorderPanel proposalId="prop-001" chapterKeys={CHAPTER_KEYS} onClose={vi.fn()} />,
    )
    const list = screen.getByTestId('chapter-reorder-list')
    const rows = within(list).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      'Rooted in Florida',
      'Our Services',
      'Portfolio',
    ])
  })

  it('Cancel closes without saving', () => {
    const onClose = vi.fn()
    const mutateAsync = vi.fn()
    mockUseUpdateProposal.mockReturnValue(makeMutation({ mutateAsync }))
    render(<ChapterReorderPanel proposalId="prop-001" chapterKeys={CHAPTER_KEYS} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mutateAsync).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('Save order persists the current chapter list for this proposal and closes', async () => {
    const onClose = vi.fn()
    const mutateAsync = vi.fn().mockResolvedValue({})
    mockUseUpdateProposal.mockReturnValue(makeMutation({ mutateAsync }))
    render(<ChapterReorderPanel proposalId="prop-001" chapterKeys={CHAPTER_KEYS} onClose={onClose} />)

    fireEvent.click(screen.getByTestId('chapter-reorder-save'))

    await vi.waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({
      id: 'prop-001',
      patch: { chapterOrder: CHAPTER_KEYS },
    }))
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('disables Save while the mutation is pending', () => {
    mockUseUpdateProposal.mockReturnValue(makeMutation({ isPending: true }))
    render(<ChapterReorderPanel proposalId="prop-001" chapterKeys={CHAPTER_KEYS} onClose={vi.fn()} />)
    expect(screen.getByTestId('chapter-reorder-save')).toBeDisabled()
  })
})
