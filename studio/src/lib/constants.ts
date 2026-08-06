import { PIPELINE_STAGES } from './pipelineStages'

export const BRAND_GREEN = '#2E7D52'

export const COMPANY_INFO = {
  name: import.meta.env.VITE_COMPANY_NAME as string,
  tagline: import.meta.env.VITE_COMPANY_TAGLINE as string,
  phone: import.meta.env.VITE_COMPANY_PHONE as string,
  email: import.meta.env.VITE_COMPANY_EMAIL as string,
  address: import.meta.env.VITE_COMPANY_ADDRESS as string,
  website: import.meta.env.VITE_COMPANY_WEBSITE as string,
} as const

export const LEAD_TYPE_COLORS = {
  HOA: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', border: 'border-green-200 dark:border-green-700' },
  commercial: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-700' },
  deathcare: { bg: 'bg-slate-100 dark:bg-slate-900/30', text: 'text-slate-700 dark:text-slate-300', border: 'border-slate-200 dark:border-slate-700' },
  resort: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200 dark:border-blue-700' },
} as const

export const STATUS_COLORS = {
  new: { bg: 'bg-sky-100 dark:bg-sky-900/30', text: 'text-sky-700 dark:text-sky-300' },
  reviewed: { bg: 'bg-cyan-100 dark:bg-cyan-900/30', text: 'text-cyan-700 dark:text-cyan-300' },
  contacted: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300' },
  qualified: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300' },
  disqualified: { bg: 'bg-zinc-100 dark:bg-zinc-800', text: 'text-zinc-500 dark:text-zinc-400' },
  proposal_sent: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300' },
  won: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300' },
  lost: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-700 dark:text-red-300' },
  estimating: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300' },
  op_review: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300' },
  approved: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300' },
} as const

export const BID_STATUS_LABELS = {
  pending: 'Pending',
  pursuing: 'Pursuing',
  submitted: 'Submitted',
  no_bid: 'No Bid',
  won: 'Won',
  lost: 'Lost',
} as const

export const LEAD_STATUS_LABELS = {
  new: 'New',
  reviewed: 'Reviewed',
  contacted: 'Contacted',
  qualified: 'Qualified',
  disqualified: 'Disqualified',
  proposal_sent: 'Proposal Sent',
  won: 'Won',
  lost: 'Lost',
  estimating: 'Estimating',
  op_review: 'OP Review',
  approved: 'Approved',
} as const

export const KANBAN_COLUMNS = PIPELINE_STAGES.map((stage) => ({
  id: stage.key,
  title: stage.label,
  color: stage.borderColor,
}))

export const DISQUALIFY_REASONS = [
  'Out of service area',
  'Budget mismatch',
  'Wrong contact / no decision maker',
  'Already under contract',
  'Not interested',
  'Duplicate lead',
  'Other',
]

export const PAGE_SIZE = 25

export const MS_PER_DAY = 86_400_000
export const BID_URGENCY_THRESHOLD_DAYS = 7

export const STRONG_FIT_SCORE = 85
export const GOOD_FIT_SCORE = 65

export const HOA_STATUS_VARIANTS: Record<string, string> = {
  Prospect: 'sky',
  Bidding: 'purple',
  Active: 'green',
  'At Risk': 'amber',
  Lost: 'red',
}

export const PM_STATUS_VARIANTS: Record<string, string> = {
  Partner: 'green',
  Engaged: 'blue',
  Target: 'amber',
  Inactive: 'secondary',
}

export const ASPIRE_DIVISIONS: { label: string; value: number }[] = [
  { label: 'Maintenance: Contract',           value: 1574 },
  { label: 'Maintenance: Enhancements',       value: 1570 },
  { label: 'Maintenance: Irrigation Service', value: 1588 },
  { label: 'Install: Landscape',              value: 1569 },
  { label: 'Install: Enhancements',           value: 1576 },
  { label: 'Install: Hardscape',              value: 2594 },
  { label: 'Install: Irrigation',             value: 1577 },
  { label: 'Install: Sod',                    value: 1578 },
]
