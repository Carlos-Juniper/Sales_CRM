// ---------------------------------------------------------------------------
// ContractScopeNarrative — "Services" scope-of-work prose pages for the
// Landscape Maintenance Agreement.
//
// Matches the reference (business docs/Pointe Jupiter Yacht Club.pdf, p.38-41):
// one flowing section per unique service, headed by the service name and
// followed by its scope_text paragraph. This is prose, not a table — the
// tabular Description of Services / Frequency breakdown lives on ContractLines.
//
// One entry per unique label (services repeated across sections — e.g. the
// same mowing line on two properties in one estimate — only narrate once).
// Paginates so an estimate with many distinct services doesn't overflow a
// single sheet.
// ---------------------------------------------------------------------------

import { PrintPage, chunk } from './shared'
import type { Estimate } from '@/types/estimating'

const ENTRIES_PER_PAGE = 5

interface ScopeEntry {
  label: string
  scopeText: string
}

function uniqueScopeEntries(estimate: Estimate): ScopeEntry[] {
  const sortedSections = [...estimate.sections].sort((a, b) => a.sortOrder - b.sortOrder)
  const seen = new Set<string>()
  const entries: ScopeEntry[] = []

  for (const section of sortedSections) {
    const sortedServices = [...section.services].sort((a, b) => a.sortOrder - b.sortOrder)
    for (const svc of sortedServices) {
      if (!svc.scopeText || seen.has(svc.label)) continue
      seen.add(svc.label)
      entries.push({ label: svc.label, scopeText: svc.scopeText })
    }
  }

  return entries
}

export function ContractScopeNarrative({ estimate }: { estimate: Estimate }) {
  const entries = uniqueScopeEntries(estimate)
  if (entries.length === 0) return null

  const groups = chunk(entries, ENTRIES_PER_PAGE)

  return (
    <>
      {groups.map((group, i) => (
        <PrintPage key={i} data-testid={`page-contract-services-${i}`} className="contract">
          {i === 0 && <h2 className="section-title">Services</h2>}
          <div className="contract-scope">
            {group.map((entry) => (
              <div className="scope-entry" key={entry.label}>
                <h3 className="scope-entry-title">{entry.label}</h3>
                <p className="scope-entry-text">{entry.scopeText}</p>
              </div>
            ))}
          </div>
        </PrintPage>
      ))}
    </>
  )
}
