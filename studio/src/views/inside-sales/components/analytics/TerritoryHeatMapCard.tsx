import { MapContainer, TileLayer, CircleMarker, Tooltip as MapTooltip } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { MapPin } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/shared/LoadingSkeleton'
import { useAllLeads } from '@/hooks/useLeads'
import { formatCurrency } from '@/lib/utils'
import { PIPELINE_STAGES, stageForStatus } from '@/lib/pipelineStages'
import type { LeadStatus } from '@/types'

const PHOENIX_CENTER: [number, number] = [33.45, -112.07]

// Hidden/terminal statuses aren't a kanban stage, so they keep their own
// marker color; active statuses resolve through PIPELINE_STAGES.
const HIDDEN_STATUS_COLORS: Partial<Record<LeadStatus, string>> = {
  proposal_sent: '#818cf8',
  won:           '#34d399',
  lost:          '#f87171',
  disqualified:  '#94a3b8',
}

function colorForStatus(status: LeadStatus): string {
  return stageForStatus(status)?.hexColor ?? HIDDEN_STATUS_COLORS[status] ?? '#94a3b8'
}

function markerRadius(value: number) {
  return Math.max(6, Math.min(18, Math.sqrt(value / 10000)))
}

const LEGEND = [
  ...PIPELINE_STAGES.map((stage) => ({ color: stage.hexColor, label: stage.label })),
  { color: '#818cf8', label: 'Proposal Sent' },
  { color: '#34d399', label: 'Won' },
  { color: '#f87171', label: 'Lost' },
]

export function TerritoryHeatMapCard() {
  const { data: leadsData, isLoading } = useAllLeads()
  const leads = leadsData?.data ?? []

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md bg-[hsl(var(--muted))] flex items-center justify-center">
              <MapPin className="h-4 w-4 text-[hsl(var(--muted-fg))]" />
            </div>
            <CardTitle className="text-sm font-semibold">Territory Heat Map</CardTitle>
          </div>
          <p className="text-xs text-[hsl(var(--muted-fg))]">{leads.length} leads mapped</p>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {isLoading ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : (
          <div className="h-64 w-full rounded-lg overflow-hidden border border-[hsl(var(--border))]">
            <MapContainer
              center={PHOENIX_CENTER}
              zoom={10}
              style={{ height: '100%', width: '100%' }}
              zoomControl={false}
              attributionControl={false}
            >
              <TileLayer
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
              />
              {leads.map((lead) => (
                <CircleMarker
                  key={lead.id}
                  center={[lead.lat, lead.lng]}
                  radius={markerRadius(lead.estimated_contract_value)}
                  pathOptions={{
                    fillColor: colorForStatus(lead.status),
                    fillOpacity: 0.75,
                    color: '#fff',
                    weight: 1.5,
                  }}
                >
                  <MapTooltip>
                    <div style={{ minWidth: 160 }}>
                      <p style={{ fontWeight: 600, fontSize: 12, marginBottom: 2 }}>{lead.property_name}</p>
                      <p style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>{lead.city}, {lead.state}</p>
                      <p style={{ fontSize: 11, fontWeight: 500 }}>{formatCurrency(lead.estimated_contract_value)}</p>
                      <p style={{ fontSize: 11, color: '#6b7280', textTransform: 'capitalize' }}>{lead.status.replace('_', ' ')}</p>
                    </div>
                  </MapTooltip>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {LEGEND.map((item) => (
            <div key={item.label} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
              <span className="text-[10px] text-[hsl(var(--muted-fg))]">{item.label}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
