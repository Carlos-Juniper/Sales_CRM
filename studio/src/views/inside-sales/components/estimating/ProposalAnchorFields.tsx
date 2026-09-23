// ---------------------------------------------------------------------------
// ProposalAnchorFields — lead + property attachment for the proposal generator.
//
// Shared by the create-from-lead flow and the Proposals page modal so both
// entry points enforce the same rule: a proposal is attached to a lead, and
// that lead has a canonical property (property_id is not null).
// ---------------------------------------------------------------------------

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { leadsApi } from '@/api/leads'
import { useUpdateLead } from '@/hooks/useLeads'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PropertySelector } from './PropertySelector'
import type { Lead } from '@/types'
import type { Property } from '@/types/estimating'

interface ProposalAnchorFieldsProps {
  lead: Lead | null
  /** When true, the rep must search for and attach a lead. The lead panel passes false. */
  pickLead: boolean
  onLeadChange: (lead: Lead | null) => void
}

export function ProposalAnchorFields({ lead, pickLead, onLeadChange }: ProposalAnchorFieldsProps) {
  const updateLead = useUpdateLead()
  const [term, setTerm] = useState('')
  const [picking, setPicking] = useState(pickLead && !lead)

  const search = useQuery({
    queryKey: ['leads', 'proposal-anchor', term.trim()],
    queryFn: () => leadsApi.list({
      search: term.trim(),
      page: 1,
      page_size: 8,
      sort_by: 'created_at',
      sort_dir: 'desc',
    }),
    enabled: pickLead && picking && term.trim().length >= 2,
    staleTime: 15_000,
  })

  const results = search.data?.data ?? []
  const showResults = pickLead && picking && term.trim().length >= 2

  async function attachProperty(property: Property | null) {
    if (!property || !lead) return
    const updated = await updateLead.mutateAsync({
      id: lead.id,
      body: { property_id: property.id },
    })
    onLeadChange({ ...lead, ...updated, property_id: updated.property_id ?? property.id })
  }

  return (
    <section
      aria-labelledby="proposal-anchor-heading"
      data-testid="proposal-anchor"
      className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4"
    >
      <h3
        id="proposal-anchor-heading"
        className="mb-1 text-[13px] font-semibold text-[hsl(var(--fg))]"
      >
        Lead and property
      </h3>
      <p className="mb-3 text-[11px] text-[hsl(var(--muted-fg))]">
        A proposal package must be attached to a lead, and that lead must have a property.
      </p>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Lead *</Label>
          {lead && !picking ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-[hsl(var(--border))] px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-[hsl(var(--fg))]">{lead.property_name}</p>
                <p className="truncate text-[11px] text-[hsl(var(--muted-fg))]">
                  {lead.city}, {lead.state}
                </p>
              </div>
              {pickLead && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPicking(true)
                    setTerm('')
                    onLeadChange(null)
                  }}
                >
                  Change
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Search leads..."
                aria-label="Search leads"
                autoComplete="off"
              />
              {showResults && (
                <div className="overflow-hidden rounded-md border border-[hsl(var(--border))]" data-testid="lead-search-results">
                  {search.isLoading && (
                    <p className="px-3 py-2 text-xs text-[hsl(var(--muted-fg))]">Searching…</p>
                  )}
                  {!search.isLoading && results.length === 0 && (
                    <p className="px-3 py-2 text-xs text-[hsl(var(--muted-fg))]">No matching leads.</p>
                  )}
                  {results.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="flex w-full items-center justify-between gap-3 border-b border-[hsl(var(--border))] px-3 py-2 text-left last:border-0 hover:bg-[hsl(var(--muted))]"
                      onClick={() => {
                        onLeadChange(item)
                        setPicking(false)
                        setTerm('')
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-[hsl(var(--fg))]">{item.property_name}</span>
                        <span className="block truncate text-[11px] text-[hsl(var(--muted-fg))]">
                          {item.city}, {item.state}
                        </span>
                      </span>
                      {!item.property_id && (
                        <span className="flex-shrink-0 text-[10px] text-amber-600">No property</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {lead && (
          <div className="space-y-1.5">
            <Label className="text-xs">Property *</Label>
            {lead.property_id ? (
              <p className="text-xs text-[hsl(var(--fg))]" data-testid="property-attached">
                Property attached · {lead.property_name}
              </p>
            ) : (
              <>
                <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="property-required">
                  Attach a property before generating this proposal.
                </p>
                <PropertySelector value={null} onSelect={(property) => { void attachProperty(property) }} />
              </>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
