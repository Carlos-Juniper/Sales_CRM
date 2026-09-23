import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { router } from './router'
import { me } from '@/api/auth'
import { useAuthStore } from '@/store/authStore'
import { isAuthCallbackPath } from '@/lib/azureAuth'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
})

function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const { login, logout, setInitialized, isInitialized } = useAuthStore()

  useEffect(() => {
    if (isAuthCallbackPath(window.location.pathname)) {
      setInitialized()
      return
    }
    me()
      .then(login)
      .catch(() => logout())
      .finally(() => setInitialized())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--bg))]">
        <div className="h-8 w-8 rounded-full border-2 border-[#2E7D52] border-t-transparent animate-spin" />
      </div>
    )
  }

  return <>{children}</>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthBootstrap>
        <RouterProvider router={router} />
      </AuthBootstrap>
    </QueryClientProvider>
  )
}
