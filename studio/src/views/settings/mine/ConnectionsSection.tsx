import { CheckCircle, XCircle } from 'lucide-react'
import { useConnections } from '@/hooks/useConnections'
import { redirectToAzureLogin } from '@/lib/azureAuth'
import { useUIStore } from '@/store/uiStore'

/**
 * M365 connections body — absorbed from the standalone ConnectionsPage (Slice 12).
 * The outer shell is removed; this component is the new home for Graph connection
 * status + the connect button.
 */
export function ConnectionsSection() {
  const { data, isLoading } = useConnections()
  const toast = useUIStore((s) => s.toast)

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
          {!data?.graph.connected && (
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
