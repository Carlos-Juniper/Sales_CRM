import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from '@/test/utils'
import { ScoreMeter } from '@/components/shared/ScoreMeter'

function getColor(container: HTMLElement): string {
  const fill = container.querySelector('.score-meter-fill') as HTMLElement
  return fill?.style.getPropertyValue('--meter-color') ?? ''
}

describe('ScoreMeter', () => {
  it('renders the numeric score', () => {
    render(<ScoreMeter score={72} />)
    expect(screen.getByText('72')).toBeInTheDocument()
  })

  it('score >= 75 renders green color', () => {
    const { container } = render(<ScoreMeter score={75} />)
    expect(getColor(container)).toBe('#2E7D52')
  })

  it('score 90-100 renders green (high-score) color', () => {
    const { container } = render(<ScoreMeter score={90} />)
    expect(getColor(container)).toBe('#2E7D52')
  })

  it('score 50-74 renders amber/yellow color', () => {
    const { container } = render(<ScoreMeter score={60} />)
    expect(getColor(container)).toBe('#D97706')
  })

  it('score 25-49 renders orange color', () => {
    const { container } = render(<ScoreMeter score={35} />)
    expect(getColor(container)).toBe('#EA580C')
  })

  it('score 0-24 renders red color', () => {
    const { container } = render(<ScoreMeter score={10} />)
    expect(getColor(container)).toBe('#DC2626')
  })

  // Edge values
  it('score 0 renders without crash', () => {
    const { container } = render(<ScoreMeter score={0} />)
    expect(screen.getByText('0')).toBeInTheDocument()
    expect(getColor(container)).toBe('#DC2626')
  })

  it('score 49 renders orange (25-49 range)', () => {
    const { container } = render(<ScoreMeter score={49} />)
    expect(getColor(container)).toBe('#EA580C')
  })

  it('score 50 renders amber (50-74 range)', () => {
    const { container } = render(<ScoreMeter score={50} />)
    expect(getColor(container)).toBe('#D97706')
  })

  it('score 74 renders amber (50-74 range)', () => {
    const { container } = render(<ScoreMeter score={74} />)
    expect(getColor(container)).toBe('#D97706')
  })

  it('score 75 renders green (>=75 range)', () => {
    const { container } = render(<ScoreMeter score={75} />)
    expect(getColor(container)).toBe('#2E7D52')
  })

  it('score 89 renders green (>=75 range)', () => {
    const { container } = render(<ScoreMeter score={89} />)
    expect(getColor(container)).toBe('#2E7D52')
  })

  it('score 100 renders green and shows label', () => {
    const { container } = render(<ScoreMeter score={100} />)
    expect(screen.getByText('100')).toBeInTheDocument()
    expect(getColor(container)).toBe('#2E7D52')
  })

  it('score 101 renders without crash', () => {
    expect(() => render(<ScoreMeter score={101} />)).not.toThrow()
  })

  it('score -1 renders without crash', () => {
    expect(() => render(<ScoreMeter score={-1} />)).not.toThrow()
  })

  it('showLabel=false hides the score number', () => {
    render(<ScoreMeter score={80} showLabel={false} />)
    expect(screen.queryByText('80')).not.toBeInTheDocument()
  })
})
