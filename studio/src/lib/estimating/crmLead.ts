// ---------------------------------------------------------------------------
// REAL CRM lead context for the intake modals (the L-TBD stub is
// gone). Maps a lead row (leads API) to the banner/pre-fill context.
// ---------------------------------------------------------------------------

import type { Lead } from '@/types'

export interface CrmLeadContext {
  leadNumber: string
  rep: string
  /** 0.20–1.00 */
  winProbability: number
  /** WS1: pre-fill the intake contact fields when present on the linked lead. */
  contactName?: string | null
  contactEmail?: string | null
}

/** Default win probability when the linked lead carries no score yet. */
export const DEFAULT_WIN_PROBABILITY = 0.5

/**
 * Map a REAL lead (leads API row) to the intake's CRM context.
 * leadNumber ← lead id, rep ← assigned_to, winProbability ← score/100 clamped
 * to the 0.20–1.00 band. (Exact field mapping flagged as an open item —
 * confirm with Carlos.)
 */
export function crmLeadFromLead(lead: Lead): CrmLeadContext {
  return {
    leadNumber: lead.id,
    rep: lead.assigned_to ?? 'Unassigned',
    winProbability:
      lead.score != null
        ? Math.min(1, Math.max(0.2, lead.score / 100))
        : DEFAULT_WIN_PROBABILITY,
    contactName: lead.contact_name ?? null,
    contactEmail: lead.contact_email ?? null,
  }
}
