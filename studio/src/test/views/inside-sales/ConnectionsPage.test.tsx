// Slice 12: ConnectionsPage standalone file deleted; its content was absorbed
// into ConnectionsSection (Mine settings group). The authoritative connection
// UI tests are in MineSections.test.tsx. This file is retained as a thin
// smoke-test pointing at the new location so any CI diff is obvious.

import { describe, it, expect, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render, makeUser } from '@/test/utils'
import { useAuthStore } from '@/store/authStore'
import { ConnectionsSection } from '@/views/settings/mine/ConnectionsSection'

beforeEach(() => {
  useAuthStore.setState({ user: makeUser() })
})

describe('ConnectionsSection (absorbed from ConnectionsPage)', () => {
  it('renders Microsoft Graph connection status', async () => {
    render(<ConnectionsSection />)
    await screen.findByText(/Microsoft Graph/i)
    expect(screen.getByText(/not connected/i)).toBeInTheDocument()
  })
})
