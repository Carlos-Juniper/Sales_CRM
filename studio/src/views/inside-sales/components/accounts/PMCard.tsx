import { ChevronDown } from 'lucide-react'
import { PMStatusBadge } from './PMStatusBadge'
import type { ManagementCompany, HOAProperty } from '@/types/accounts'

interface PMCardProps {
  company: ManagementCompany
  properties: HOAProperty[]
  expanded: boolean
  onToggle: () => void
  onSelectProperty: (property: HOAProperty) => void
}

export function PMCard({ company, properties, expanded, onToggle, onSelectProperty }: PMCardProps) {
  return (
    <div className="border border-[hsl(var(--border))] rounded-xl bg-[hsl(var(--card))] overflow-hidden">
      {/* Header — click triggers onToggle */}
      <div
        onClick={onToggle}
        className="flex items-center gap-3 px-4 py-3.5 cursor-pointer hover:bg-[hsl(var(--muted))]/50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <span className="text-sm font-bold text-[hsl(var(--fg))] truncate block">
            {company.company_name}
          </span>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-[hsl(var(--muted-fg))]">
            {company.phone && <span>{company.phone}</span>}
            {company.city && company.state && (
              <span>{company.city}, {company.state}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <PMStatusBadge status={company.status} />
          <ChevronDown
            className={`h-4 w-4 text-[hsl(var(--muted-fg))] transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-[hsl(var(--border))] grid grid-cols-2 gap-6 px-4 pt-3 pb-4">
          {/* Contacts column */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-fg))] mb-2">
              Contacts
            </p>
            {company.contacts.length > 0 ? (
              <div className="space-y-2">
                {company.contacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="py-2 border-b border-[hsl(var(--border))] last:border-0"
                  >
                    <div className="text-sm font-semibold text-[hsl(var(--fg))]">{contact.name}</div>
                    {contact.title && (
                      <div className="text-xs text-[hsl(var(--muted-fg))]">{contact.title}</div>
                    )}
                    {contact.email && (
                      <a
                        href={`mailto:${contact.email}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-[#2E7D52] hover:underline block mt-0.5"
                      >
                        {contact.email}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[hsl(var(--muted-fg))]">No additional contacts on file.</p>
            )}
          </div>

          {/* Managed properties column */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-fg))] mb-2">
              Managed properties · {properties.length}
            </p>
            {properties.length > 0 ? (
              <div className="space-y-1">
                {properties.map((property) => (
                  <button
                    key={property.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectProperty(property)
                    }}
                    className="w-full text-left py-2 border-b border-[hsl(var(--border))] last:border-0 hover:opacity-70 transition-opacity"
                  >
                    <div className="text-xs font-semibold text-[hsl(var(--fg))] truncate">
                      {property.property_name}
                    </div>
                    <div className="text-xs text-[hsl(var(--muted-fg))]">
                      {property.city}, {property.state}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[hsl(var(--muted-fg))]">No properties linked yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
