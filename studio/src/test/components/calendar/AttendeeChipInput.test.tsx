import { describe, it, expect, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { screen } from '@testing-library/react'
import { render } from '@/test/utils'
import { AttendeeChipInput } from '@/views/inside-sales/components/calendar/AttendeeChipInput'

function setup(value: string[] = [], onChange = vi.fn()) {
  return { user: userEvent.setup(), onChange, ...render(<AttendeeChipInput value={value} onChange={onChange} />) }
}

describe('AttendeeChipInput', () => {
  it('renders existing chips', () => {
    setup(['alice@example.com', 'bob@example.com'])
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    expect(screen.getByText('bob@example.com')).toBeInTheDocument()
  })

  it('commits a valid email on Enter', async () => {
    const { user, onChange } = setup()
    const input = screen.getByRole('textbox')
    await user.type(input, 'charlie@example.com')
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenCalledWith(['charlie@example.com'])
  })

  it('commits a valid email on comma key', async () => {
    const { user, onChange } = setup()
    const input = screen.getByRole('textbox')
    await user.type(input, 'dave@example.com,')
    expect(onChange).toHaveBeenCalledWith(['dave@example.com'])
  })

  it('commits a valid email on blur', async () => {
    const { user, onChange } = setup()
    const input = screen.getByRole('textbox')
    await user.type(input, 'eve@example.com')
    await user.tab()
    expect(onChange).toHaveBeenCalledWith(['eve@example.com'])
  })

  it('does not commit invalid email; shows inline error instead', async () => {
    const { user, onChange } = setup()
    const input = screen.getByRole('textbox')
    await user.type(input, 'not-an-email')
    await user.keyboard('{Enter}')
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('clears inline error when input is cleared', async () => {
    const { user } = setup()
    const input = screen.getByRole('textbox')
    await user.type(input, 'bad')
    await user.keyboard('{Enter}')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await user.clear(input)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('removes a chip when × is clicked', async () => {
    const onChange = vi.fn()
    const { user } = setup(['alice@example.com'], onChange)
    const removeBtn = screen.getByRole('button', { name: /remove alice@example\.com/i })
    await user.click(removeBtn)
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('does not add duplicate chips', async () => {
    const { user, onChange } = setup(['alice@example.com'])
    const input = screen.getByRole('textbox')
    await user.type(input, 'alice@example.com')
    await user.keyboard('{Enter}')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clears input text after successful commit', async () => {
    setup()
    const input = screen.getByRole('textbox') as HTMLInputElement
    await userEvent.setup().type(input, 'frank@example.com')
    await userEvent.setup().keyboard('{Enter}')
    expect(input.value).toBe('')
  })
})
