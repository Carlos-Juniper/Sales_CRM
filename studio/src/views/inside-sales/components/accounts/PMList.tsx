import { PMCard } from './PMCard'
import type { ManagementCompany, HOAProperty } from '@/types/accounts'

interface PMListProps {
  companies: ManagementCompany[]
  expandedIds: Set<string>
  onToggle: (id: string) => void
  onSelectProperty: (p: HOAProperty) => void
  propertiesForCompany: Map<string, HOAProperty[]>
}

export function PMList({
  companies,
  expandedIds,
  onToggle,
  onSelectProperty,
  propertiesForCompany,
}: PMListProps) {
  if (companies.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-[hsl(var(--muted-fg))]">
        No management companies match your search.
      </div>
    )
  }

  return (
    <div className="space-y-3 max-w-5xl">
      {companies.map((company) => (
        <PMCard
          key={company.id}
          company={company}
          properties={propertiesForCompany.get(company.id) ?? []}
          expanded={expandedIds.has(company.id)}
          onToggle={() => onToggle(company.id)}
          onSelectProperty={onSelectProperty}
        />
      ))}
    </div>
  )
}
