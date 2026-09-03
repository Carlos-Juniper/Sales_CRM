import { render as rtlRender, type RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { AuthUser } from '@/types'
import { TooltipProvider } from '@/components/ui/tooltip'

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

// Router entries may carry state ("Request estimate" passes the
// canonical property + its lead via location.state).
export type TestRouterEntry = string | { pathname: string; state?: unknown }

export function createWrapper(initialEntries?: TestRouterEntry[]) {
  const queryClient = createQueryClient()
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries ?? ['/']}>
        <TooltipProvider>
          {/*
            Real `:estimateId`/`:tab` route matches so components that call
            useParams() (EstimatingPage) see them when a test's initialEntries
            targets that URL — mirrors router.tsx's three concrete routes. Any
            other path (including the default '/') falls through to the
            wildcard, which renders the same element with no params, matching
            pre-refactor behavior for every non-estimating test.
          */}
          <Routes>
            <Route path="/inside-sales/estimating" element={children} />
            <Route path="/inside-sales/estimating/tab/:tab" element={children} />
            <Route path="/inside-sales/estimating/:estimateId" element={children} />
            <Route path="/inside-sales/estimating/:estimateId/:tab" element={children} />
            <Route path="*" element={children} />
          </Routes>
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return { wrapper: Wrapper, queryClient }
}

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  initialEntries?: TestRouterEntry[]
}

export function render(ui: React.ReactElement, options: CustomRenderOptions = {}) {
  const { initialEntries, ...renderOptions } = options
  const { wrapper } = createWrapper(initialEntries)
  return rtlRender(ui, { wrapper, ...renderOptions })
}

export function makeUser(overrides?: Partial<AuthUser>): AuthUser {
  return {
    id: 'u1',
    email: 'test@example.com',
    name: 'Test User',
    role: 'sales',
    branch_id: 'b1',
    avatar_initials: 'TU',
    token: 'test-jwt-token',
    ...overrides,
  }
}

export * from '@testing-library/react'
