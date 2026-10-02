// MultiSelectFilter: toggling uses the shared lib/selection helper; the
// Set-based contract is unchanged.
import { useState } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MultiSelectFilter } from '@/components/shared/MultiSelectFilter'

function Harness() {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  return (
    <>
      <MultiSelectFilter
        label="Status"
        options={['Open', 'Won', 'Lost']}
        selected={selected}
        onChange={setSelected}
      />
      <output data-testid="selected">{[...selected].sort().join(',')}</output>
    </>
  )
}

const selectedText = () => screen.getByTestId('selected').textContent

describe('MultiSelectFilter', () => {
  it('toggles options on and off and clears them all', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Status' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    fireEvent.click(screen.getByRole('button', { name: 'Won' }))
    expect(selectedText()).toBe('Open,Won')
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(selectedText()).toBe('Won')
    fireEvent.click(screen.getByRole('button', { name: 'Clear status' }))
    expect(selectedText()).toBe('')
  })
})
