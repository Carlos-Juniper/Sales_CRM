import { describe, it, expect, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import ConnectionsPage from '@/views/inside-sales/ConnectionsPage'

beforeEach(() => {
  useAuthStore.setState({ user: makeUser() })
})

describe('ConnectionsPage', () => {
  it('renders Microsoft Graph connection status', async () => {
    render(<ConnectionsPage />)
    await screen.findByText(/Microsoft Graph/i)
    expect(screen.getByText(/not connected/i)).toBeInTheDocument()
  })

})
