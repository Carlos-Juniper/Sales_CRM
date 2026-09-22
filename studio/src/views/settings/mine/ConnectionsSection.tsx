import { useState } from 'react'
import { CheckCircle, XCircle } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useConnections } from '@/hooks/useConnections'
import { redirectToAzureLogin } from '@/lib/azureAuth'
import { disconnectMsGraph } from '@/api/auth'
import { useUIStore } from '@/store/uiStore'

export function ConnectionsSection() {
  const { data, isLoading } = useConnections()
  const toast = useUIStore((s) => s.toast)
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)

  const disconnect = useMutation({
    mutationFn: disconnectMsGraph,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connections'] })
      toast('Microsoft account disconnected.', { variant: 'success' })
      setConfirming(false)
    },
    onError: () => {
      toast('Could not disconnect. Try again.', { variant: 'error' })
      setConfirming(false)
    },
  })

  async function handleConnectClick() {
    try {
      await redirectToAzureLogin()
    } catch {
      toast('Could not reach Microsoft sign-in. Try again.', { variant: 'error' })
    }
  }

  return (
    <div data-testid="settings-section-connections" className="space-y-4 max-w-sm">
      <div>
        <h2 className="text-sm font-semibold text-[var(--fg)] mb-1">Connections</h2>
        <p className="text-xs text-[var(--fg)] opacity-60">
          Link external accounts to enable email and calendar features.
        </p>
      </div>

      {isLoading ? (
        <div className="text-xs text-[var(--fg)] opacity-60">Loading…</div>
      ) : (
        <div className="rounded-lg border border-[var(--border)] p-4">
          <div className="flex items-center gap-2">
            {data?.graph.connected ? (
              <CheckCircle className="text-green-600" />
            ) : (
              <XCircle className="text-gray-400" />
            )}
            <span className="font-medium text-sm">Microsoft Graph</span>
            <span className="text-xs text-gray-500">
              {data?.graph.connected ? 'Connected' : 'Not connected'}
            </span>
          </div>

          {data?.graph.connected ? (
            <div className="mt-2 flex items-center gap-3">
              {confirming ? (
                <>
                  <span className="text-xs text-[var(--fg)] opacity-70">Disconnect Microsoft 365?</span>
                  <button
                    type="button"
                    onClick={() => disconnect.mutate()}
                    disabled={disconnect.isPending}
                    className="text-xs text-red-600 hover:underline disabled:opacity-50"
                  >
                    {disconnect.isPending ? 'Disconnecting…' : 'Yes, disconnect'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="text-xs text-[var(--fg)] opacity-60 hover:opacity-100"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="text-xs text-[var(--fg)] opacity-50 hover:opacity-80 hover:text-red-600 transition-colors"
                >
                  Disconnect
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={handleConnectClick}
              className="mt-2 text-sm text-blue-600 hover:underline"
            >
              Connect Microsoft 365
            </button>
          )}
        </div>
      )}
    </div>
  )
}
