import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '@/mocks/server'
import { render } from '@/test/utils'
import LoginPage from '@/views/auth/LoginPage'
import { useAuthStore } from '@/store/authStore'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async (importOriginal) => {
  const mod = await importOriginal<typeof import('react-router-dom')>()
  return { ...mod, useNavigate: () => mockNavigate }
})

describe('LoginPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    useAuthStore.setState({ user: null, isLoading: false })
  })

  it('renders email input, password input, and submit button', () => {
    render(<LoginPage />)
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })

  it('shows validation error when both fields empty', async () => {
    const user = userEvent.setup()
    render(<LoginPage />)
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    expect(await screen.findByText(/email and password are required/i)).toBeInTheDocument()
  })

  it('shows validation error when email is empty', async () => {
    const user = userEvent.setup()
    render(<LoginPage />)
    await user.type(screen.getByLabelText(/password/i), 'demo')
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    expect(await screen.findByText(/email and password are required/i)).toBeInTheDocument()
  })

  it('shows validation error when password is empty', async () => {
    const user = userEvent.setup()
    render(<LoginPage />)
    await user.type(screen.getByLabelText(/email/i), 'carlos.hernandez@juniperlandscaping.com')
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    expect(await screen.findByText(/email and password are required/i)).toBeInTheDocument()
  })

  it('shows error message on wrong password (401 from MSW)', async () => {
    const user = userEvent.setup()
    render(<LoginPage />)
    await user.type(screen.getByLabelText(/email/i), 'carlos.hernandez@juniperlandscaping.com')
    await user.type(screen.getByLabelText(/password/i), 'wrongpassword')
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument()
  })

  it('shows loading state while request is in-flight', async () => {
    server.use(
      http.post('/api/auth/login', async () => {
        await new Promise(() => {}) // never resolves
        return HttpResponse.json({})
      }),
    )
    const user = userEvent.setup()
    render(<LoginPage />)
    await user.type(screen.getByLabelText(/email/i), 'carlos.hernandez@juniperlandscaping.com')
    await user.type(screen.getByLabelText(/password/i), 'demo')
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    expect(await screen.findByText(/signing in/i)).toBeInTheDocument()
  })

  it.each([
    ['carlos.hernandez@juniperlandscaping.com', '/inside-sales'],
    ['maria.garcia@juniperlandscaping.com', '/outside-sales'],
    ['david.lee@juniperlandscaping.com', '/estimating'],
    ['robert.chen@juniperlandscaping.com', '/branch-manager'],
  ])('successful login for %s navigates to %s', async (email, route) => {
    const user = userEvent.setup()
    render(<LoginPage />)
    await user.type(screen.getByLabelText(/email/i), email)
    await user.type(screen.getByLabelText(/password/i), 'demo')
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith(route, { replace: true }))
    expect(useAuthStore.getState().user).not.toBeNull()
  })

  it('sets authStore.user after successful login', async () => {
    const user = userEvent.setup()
    render(<LoginPage />)
    await user.type(screen.getByLabelText(/email/i), 'carlos.hernandez@juniperlandscaping.com')
    await user.type(screen.getByLabelText(/password/i), 'demo')
    await user.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => expect(useAuthStore.getState().user?.role).toBe('inside_sales'))
  })

  it('pressing Enter in password field submits the form', async () => {
    const user = userEvent.setup()
    render(<LoginPage />)
    await user.type(screen.getByLabelText(/email/i), 'carlos.hernandez@juniperlandscaping.com')
    await user.type(screen.getByLabelText(/password/i), 'demo{Enter}')
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/inside-sales', { replace: true }))
  })
})
