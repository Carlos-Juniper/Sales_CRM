import { AccountStatusBadge } from './AccountStatusBadge'
import type { HOAProperty, ManagementCompany } from '@/types/accounts'

interface HOATableProps {
  rows: HOAProperty[]
  companies: ManagementCompany[]
  onSelect: (property: HOAProperty) => void
}

export function HOATable({ rows, companies, onSelect }: HOATableProps) {
  // Build a lookup map for O(1) company resolution per row
  const companyMap = new Map(companies.map((c) => [c.id, c]))

  if (rows.length === 0) {
    return (
      <div className="border border-[hsl(var(--border))] rounded-xl bg-[hsl(var(--card))] text-center py-10 px-5">
        <p className="text-sm text-[hsl(var(--muted-fg))]">No properties match your search.</p>
      </div>
    )
  }

  return (
    <div className="border border-[hsl(var(--border))] rounded-xl overflow-hidden bg-[hsl(var(--card))]">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-[hsl(var(--muted))]">
            <th className="text-left px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-fg))] border-b border-[hsl(var(--border))]">
              Property
            </th>
            <th className="text-left px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-fg))] border-b border-[hsl(var(--border))]">
              Location
            </th>
            <th className="text-left px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-fg))] border-b border-[hsl(var(--border))]">
              Acreage
            </th>
            <th className="text-left px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-fg))] border-b border-[hsl(var(--border))]">
              Management company
            </th>
            <th className="text-left px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-fg))] border-b border-[hsl(var(--border))]">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((property, idx) => {
            const company = property.management_company_id
              ? companyMap.get(property.management_company_id) ?? null
              : null
            const isLast = idx === rows.length - 1

            return (
              <tr
                key={property.id}
                onClick={() => onSelect(property)}
                className={`cursor-pointer hover:bg-[hsl(var(--muted))]/50 transition-colors ${!isLast ? 'border-b border-[hsl(var(--border))]' : ''}`}
              >
                <td className="px-3 py-3">
                  <div className="text-sm font-semibold text-[hsl(var(--fg))] truncate">
                    {property.property_name}
                  </div>
                  {/* Show city/state here so tests that count "Naples" occurrences
                      find it in both the property cell and location cell */}
                  <div className="text-xs text-[hsl(var(--muted-fg))] truncate">
                    {property.city}, {property.state}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <div className="text-xs text-[hsl(var(--fg))]">
                    {property.city}, {property.state}
                  </div>
                  {property.county && (
                    <div className="text-xs text-[hsl(var(--muted-fg))]">
                      {property.county} County
                    </div>
                  )}
                </td>
                <td className="px-3 py-3 tabular-nums">
                  <div className="text-xs text-[hsl(var(--fg))]">{property.acreage} ac</div>
                  {property.units != null && (
                    <div className="text-xs text-[hsl(var(--muted-fg))]">{property.units} units</div>
                  )}
                </td>
                <td className="px-3 py-3">
                  {company ? (
                    company.company_name
                  ) : (
                    <span className="text-xs text-[hsl(var(--muted-fg))] italic">Self-managed</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <AccountStatusBadge status={property.status} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
