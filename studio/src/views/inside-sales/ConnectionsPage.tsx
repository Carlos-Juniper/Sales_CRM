import { useConnections } from '@/hooks/useConnections'
import { CheckCircle, XCircle } from 'lucide-react'

export default function ConnectionsPage() {
  const { data, isLoading } = useConnections()

  if (isLoading) return <div>Loading...</div>

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold">Connections</h1>

      <div className="border rounded-lg p-4">
        <div className="flex items-center gap-2">
          {data?.graph.connected
            ? <CheckCircle className="text-green-600" />
            : <XCircle className="text-gray-400" />}
          <span className="font-medium">Microsoft Graph</span>
          <span className="text-sm text-gray-500">
            {data?.graph.connected ? 'Connected' : 'Not connected'}
          </span>
        </div>
        {!data?.graph.connected && (
          <button className="mt-2 text-sm text-blue-600 hover:underline">
            Connect Microsoft 365
          </button>
        )}
      </div>

    </div>
  )
}
