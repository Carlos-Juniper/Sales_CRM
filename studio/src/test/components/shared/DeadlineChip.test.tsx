import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from '@/test/utils'
import { DeadlineChip } from '@/components/shared/DeadlineChip'

const future = (days: number) =>
  new Date(Date.now() + days * 24 * 3600 * 1000).toISOString()

const past = (days: number) =>
  new Date(Date.now() - days * 24 * 3600 * 1000).toISOString()

describe('DeadlineChip', () => {
  it('30 days away renders with green (normal) styling', () => {
    const { container } = render(<DeadlineChip deadline={future(30)} />)
    const chip = container.firstChild as HTMLElement
    expect(chip).toBeInTheDocument()
    expect(chip.className).toContain('bg-green-100')
    expect(screen.getByText(/30d left/i)).toBeInTheDocument()
  })

  it('3 days away renders with red urgent styling', () => {
    const { container } = render(<DeadlineChip deadline={future(3)} />)
    const chip = container.firstChild as HTMLElement
    expect(chip.className).toContain('bg-red-100')
    expect(screen.getByText(/3d left/i)).toBeInTheDocument()
  })

  it('past deadline renders "Overdue" with red styling', () => {
    const { container } = render(<DeadlineChip deadline={past(2)} />)
    const chip = container.firstChild as HTMLElement
    expect(chip.className).toContain('bg-red-100')
    expect(screen.getByText('Overdue')).toBeInTheDocument()
  })

  it('14 days away renders with amber warning styling', () => {
    const { container } = render(<DeadlineChip deadline={future(14)} />)
    const chip = container.firstChild as HTMLElement
    expect(chip.className).toContain('bg-amber-100')
  })

  it('deadline null renders nothing', () => {
    const { container } = render(<DeadlineChip deadline={null} />)
    expect(container.firstChild).toBeNull()
  })
})
