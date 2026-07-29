import { useState, useMemo } from 'react'
import './MapPage.css'
import { MapContainer, TileLayer, CircleMarker, Tooltip as MapTooltip } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { MapPin } from 'lucide-react'
import { TopNav } from '@/components/layout/TopNav'
import { LeadDetailPanel } from './components/LeadDetailPanel'
import { useAllLeads } from '@/hooks/useLeads'
import { useUIStore } from '@/store/uiStore'
import { formatCurrency } from '@/lib/utils'
import { cn } from '@/lib/utils'
import type { Lead } from '@/types'

const PHOENIX_CENTER: [number, number] = [33.45, -112.07]
const DEFAULT_ZOOM = 10

const TYPE_COLORS: Record<string, string> = {
  HOA: '#2E7D52',
  commercial: '#f59e0b',
  deathcare: '#64748b',
  resort: '#3b82f6',
}

const STATUS_OPACITY: Record<string, number> = {
  new: 1, contacted: 1, qualified: 1, proposal_sent: 1,
  won: 0.6, lost: 0.35, disqualified: 0.25, handed_off: 0.5,
}

const LEAD_TYPE_FILTERS = ['HOA', 'commercial', 'deathcare', 'resort'] as const

function markerRadius(value: number) {
  return Math.max(9, Math.min(20, Math.sqrt(value / 8000)))
}

interface TooltipContentProps { lead: Lead; color: string }
function TooltipContent({ lead, color }: TooltipContentProps) {
  return (
    <div className="map-tooltip">
      <p className="map-tooltip-title">{lead.property_name}</p>
      <p className="map-tooltip-subtitle">{lead.city}, {lead.state}</p>
      <div className="map-tooltip-row">
        <span className="map-tooltip-value">{formatCurrency(lead.estimated_contract_value)}</span>
        <span className="map-tooltip-muted">{lead.estimated_acreage} ac</span>
        <span className="map-tooltip-score" style={{ '--score-color': color } as React.CSSProperties}>{lead.score} pts</span>
      </div>
    </div>
  )
}

export default function MapPage() {
  const { data: leadsData } = useAllLeads()
  const selectedLeadId = useUIStore((s) => s.selectedLeadId)
  const selectLead = useUIStore((s) => s.selectLead)
  const [filterTypes, setFilterTypes] = useState<Set<string>>(new Set())

  const filteredLeads = useMemo(() => {
    const leads = (leadsData?.data ?? []).filter((l) => l.lat != null && l.lng != null)
    if (filterTypes.size === 0) return leads
    return leads.filter((l) => filterTypes.has(l.lead_type))
  }, [leadsData, filterTypes])

  function toggleType(type: string) {
    setFilterTypes((prev) => {
      const next = new Set(prev)
      next.has(type) ? next.delete(type) : next.add(type)
      return next
    })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopNav
        title="Map View"
        subtitle={`${filteredLeads.length} lead${filteredLeads.length !== 1 ? 's' : ''} in Phoenix metro`}
      />

      {/* Filter bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[hsl(var(--border))] bg-[hsl(var(--bg))] flex-shrink-0 flex-wrap">
        <span className="text-xs text-[hsl(var(--muted-fg))] font-medium mr-1">Filter:</span>
        {LEAD_TYPE_FILTERS.map((type) => {
          const active = filterTypes.has(type)
          return (
            <button
              key={type}
              onClick={() => toggleType(type)}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium border transition-all',
                active
                  ? 'text-white border-transparent filter-btn-active'
                  : 'border-[hsl(var(--border))] text-[hsl(var(--muted-fg))] hover:border-[hsl(var(--fg))]'
              )}
              style={{ '--btn-color': TYPE_COLORS[type] } as React.CSSProperties}
            >
              {type}
            </button>
          )
        })}
        {filterTypes.size > 0 && (
          <button
            onClick={() => setFilterTypes(new Set())}
            className="px-2 py-1 text-xs text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))] transition-colors"
          >
            Clear
          </button>
        )}
        <div className="ml-auto hidden sm:flex items-center gap-1 text-xs text-[hsl(var(--muted-fg))]">
          <MapPin className="h-3 w-3" />
          Click a lead to view details
        </div>
      </div>

      {/* Map area */}
      <div className="flex-1 relative overflow-hidden">
        <MapContainer
          center={PHOENIX_CENTER}
          zoom={DEFAULT_ZOOM}
          style={{ height: '100%', width: '100%' }}
          zoomControl
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          />

          {filteredLeads.map((lead) => {
            const color = TYPE_COLORS[lead.lead_type] ?? '#6b7280'
            const r = markerRadius(lead.estimated_contract_value)
            const fillOpacity = STATUS_OPACITY[lead.status] ?? 1
            const isSelected = selectedLeadId === lead.id

            return (
              <CircleMarker
                key={lead.id}
                center={[lead.lat, lead.lng]}
                radius={r}
                pathOptions={{
                  color: 'white',
                  weight: isSelected ? 3 : 2,
                  fillColor: color,
                  fillOpacity,
                  ...(isSelected && { color, weight: 4 }),
                }}
                eventHandlers={{ click: () => selectLead(lead.id) }}
              >
                <MapTooltip direction="top" offset={[0, -r - 4]}>
                  <TooltipContent lead={lead} color={color} />
                </MapTooltip>
              </CircleMarker>
            )
          })}
        </MapContainer>

        {/* Legend */}
        <div className="absolute bottom-6 left-3 z-[1000] bg-white/90 backdrop-blur-sm rounded-lg shadow border border-[hsl(var(--border))] px-3 py-2 flex flex-wrap items-center gap-3">
          {Object.entries(TYPE_COLORS).map(([type, color]) => (
            <div key={type} className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-full border border-white/50 map-legend-dot" style={{ '--dot-color': color } as React.CSSProperties} />
              <span className="text-xs text-[hsl(var(--muted-fg))] font-medium">{type}</span>
            </div>
          ))}
          <div className="w-px h-3 bg-[hsl(var(--border))]" />
          <span className="text-[10px] text-[hsl(var(--muted-fg))]">Dot size = contract value</span>
        </div>

        {/* Stats overlay */}
        <div className="absolute top-3 right-3 z-[1000] bg-white/90 backdrop-blur-sm rounded-lg shadow border border-[hsl(var(--border))] px-3 py-2 hidden sm:block">
          <div className="flex gap-4">
            {LEAD_TYPE_FILTERS.map((type) => {
              const count = filteredLeads.filter((l) => l.lead_type === type).length
              return (
                <div key={type} className="text-center">
                  <p className="text-xs font-bold text-[hsl(var(--fg))]">{count}</p>
                  <p className="text-[10px] text-[hsl(var(--muted-fg))]">{type}</p>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <LeadDetailPanel
        leadId={selectedLeadId}
        onClose={() => selectLead(null)}
        onPrev={(() => {
          const idx = filteredLeads.findIndex((l) => l.id === selectedLeadId)
          return idx > 0 ? () => selectLead(filteredLeads[idx - 1].id) : undefined
        })()}
        onNext={(() => {
          const idx = filteredLeads.findIndex((l) => l.id === selectedLeadId)
          return idx !== -1 && idx < filteredLeads.length - 1 ? () => selectLead(filteredLeads[idx + 1].id) : undefined
        })()}
      />
    </div>
  )
}
