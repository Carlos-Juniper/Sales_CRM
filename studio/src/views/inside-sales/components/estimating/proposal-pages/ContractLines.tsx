// ---------------------------------------------------------------------------
// ContractLines — scope text table for Landscape Maintenance Agreement
//
// Displays one row per service (section_services), ordered by section/service
// sortOrder. Each row shows the service label and its scope narrative
// (catalog_items.scope_text).
// ---------------------------------------------------------------------------

import type { Estimate } from '@/types/estimating'

export function ContractLines({ estimate }: { estimate: Estimate }) {
  // Sort sections by sortOrder
  const sortedSections = [...estimate.sections].sort((a, b) => a.sortOrder - b.sortOrder)

  const rows: Array<{ label: string; scopeText: string }> = []

  for (const section of sortedSections) {
    // Sort services within section by sortOrder
    const sortedServices = [...section.services].sort((a, b) => a.sortOrder - b.sortOrder)

    for (const svc of sortedServices) {
      const scopeText = svc.scopeText || ''
      rows.push({
        label: svc.label,
        scopeText,
      })
    }
  }

  if (rows.length === 0) {
    return null
  }

  return (
    <div className="contract-lines">
      <table className="scope-table">
        <thead>
          <tr>
            <th>Service</th>
            <th>Scope of Work</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td className="service-label">{row.label}</td>
              <td className="scope-text">{row.scopeText}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
