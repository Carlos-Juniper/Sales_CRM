import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/utils'
import LoginPage from '@/views/auth/LoginPage'
import { useAuthStore } from '@/store/authStore'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async (importOriginal) => {
  const mod = await importOriginal<typeof import('react-router-dom')>()
  return { ...mod, useNavigate: () => mockNavigate }
})

const mockRedirectToAzureLogin = vi.fn()

vi.mock('@/lib/azureAuth', () => ({
  redirectToAzureLogin: () => mockRedirectToAzureLogin(),
}))

describe('LoginPage (SSO-only)', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    mockRedirectToAzureLogin.mockReset()
    mockRedirectToAzureLogin.mockResolvedValue(undefined)
    useAuthStore.setState({ user: null, isLoading: false })
  })

  it('renders a single "Sign in with Microsoft" action', () => {
    render(<LoginPage />)
    expect(
      screen.getByRole('button', { name: /microsoft|entra/i }),
    ).toBeInTheDocument()
  })

  it('does not render any email or password field', () => {
    render(<LoginPage />)
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument()
    // No password inputs anywhere in the DOM.
    expect(
      document.querySelector('input[type="password"]'),
    ).not.toBeInTheDocument()
  })

  it('clicking the SSO button starts the Azure redirect', async () => {
    const user = userEvent.setup()
    render(<LoginPage />)
    await user.click(screen.getByRole('button', { name: /microsoft|entra/i }))
    expect(mockRedirectToAzureLogin).toHaveBeenCalledTimes(1)
  })
})
