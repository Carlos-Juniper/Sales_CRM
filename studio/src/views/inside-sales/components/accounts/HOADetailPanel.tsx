import { useState } from 'react'
import { MapPin, Building2, ArrowRight, Pencil } from 'lucide-react'
import { SlideOverPanel } from '@/components/shared/SlideOverPanel'
import { Button } from '@/components/ui/button'
import { AccountStatusBadge } from './AccountStatusBadge'
import { AddHOAPanel } from './AddHOAPanel'
import { usePatchHOAProperty } from '@/hooks/useHOAProperties'
import type { HOAProperty, ManagementCompany } from '@/types/accounts'

interface HOADetailPanelProps {
  property: HOAProperty
  company: ManagementCompany | null
  managementCompanies: ManagementCompany[]
  isOpen: boolean
  onClose: () => void
  onCreateBid: (property: HOAProperty) => void
}

function MetricBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-[hsl(var(--border))] rounded-lg p-3">
      <div className="text-[9px] font-bold uppercase tracking-widest text-[#2E7D52] mb-1">{label}</div>
      <div className="text-lg font-bold text-[hsl(var(--fg))] tabular-nums">{value}</div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-3 py-2 border-b border-[hsl(var(--border))]">
      <div className="text-xs text-[hsl(var(--muted-fg))] w-28 flex-shrink-0 pt-0.5">{label}</div>
      <div className="text-sm text-[hsl(var(--fg))] font-medium flex-1">{value}</div>
    </div>
  )
}

export function HOADetailPanel({ property, company, managementCompanies, isOpen, onClose, onCreateBid }: HOADetailPanelProps) {
  const [editOpen, setEditOpen] = useState(false)
  const patchHOAProperty = usePatchHOAProperty()

  const acreage = property.acreage != null ? `${property.acreage} ac` : '—'
  const units = property.units != null ? property.units.toLocaleString() : '—'

  return (
    <>
    <SlideOverPanel isOpen={isOpen} onClose={onClose} title={property.property_name}>
      <div className="p-5 space-y-5">
        {/* Status + branch badges + edit button */}
        <div className="flex items-center gap-2">
          <AccountStatusBadge status={property.status} />
          {property.branch && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold border border-[hsl(var(--border))] rounded-full px-2.5 py-0.5 text-[hsl(var(--muted-fg))]">
              <MapPin className="h-3 w-3" />
              {property.branch}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 w-7 p-0"
            aria-label="Edit property"
            onClick={() => setEditOpen(true)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Key metrics */}
        <div className="grid grid-cols-3 gap-2.5">
          <MetricBox label="Acreage" value={acreage} />
          <MetricBox label="Units" value={units} />
          <MetricBox label="County" value={property.county ?? '—'} />
        </div>

        {/* Location */}
        <section className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-fg))]">Location</p>
          <div className="text-sm text-[hsl(var(--fg))] leading-relaxed space-y-0.5">
            {property.address && <div>{property.address}</div>}
            <div>{[property.city, property.state, property.zip].filter(Boolean).join(', ')}</div>
            {property.county && (
              <div className="text-xs text-[hsl(var(--muted-fg))]">{property.county} County</div>
            )}
          </div>
        </section>

        {/* Property details */}
        <section className="space-y-0.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-fg))] mb-2">
            Property details
          </p>
          <InfoRow label="Association" value={property.association_name} />
          <InfoRow label="Assigned to" value={property.assigned_to} />
          <InfoRow label="Contact status" value={property.contact_status} />
          <InfoRow label="Last contacted" value={property.last_contacted} />
        </section>

        {/* Management company */}
        <section className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-fg))]">
            Managed by
          </p>
          {company ? (
            <div className="flex items-center gap-3 border border-[hsl(var(--border))] rounded-xl p-3 bg-[hsl(var(--card))]">
              <div className="w-9 h-9 rounded-lg bg-[#2E7D52]/10 text-[#2E7D52] flex items-center justify-center flex-shrink-0">
                <Building2 className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-[hsl(var(--fg))] truncate">{company.company_name}</div>
                <div className="text-xs text-[hsl(var(--muted-fg))]">
                  {company.phone}
                  {company.contacts.length > 0 && ` · ${company.contacts.length} contact${company.contacts.length !== 1 ? 's' : ''}`}
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-[hsl(var(--muted-fg))] flex-shrink-0" />
            </div>
          ) : (
            <div className="border border-dashed border-[hsl(var(--border))] rounded-xl p-3 text-xs text-[hsl(var(--muted-fg))]">
              Self-managed — no management company on file.
            </div>
          )}
        </section>
      </div>

      {/* Footer */}
      <div className="border-t border-[hsl(var(--border))] px-5 py-3 flex items-center gap-2">
        <Button size="sm" onClick={() => onCreateBid(property)} className="ml-auto">
          Create bid
          <ArrowRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      </div>
    </SlideOverPanel>

    <AddHOAPanel
      isOpen={editOpen}
      onClose={() => setEditOpen(false)}
      initialValues={property}
      managementCompanies={managementCompanies}
      onSave={async () => {}}
      onUpdate={async (body) => {
        await patchHOAProperty.mutateAsync({ id: property.id, body })
        setEditOpen(false)
      }}
    />
    </>
  )
}
