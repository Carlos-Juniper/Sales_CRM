import type {
  Commission,
  CommissionInstallment,
  CommissionInstallmentStatus,
  CommissionPayoutBucket,
  CommissionPayoutSchedule,
  CommissionRep,
  CommissionSummary,
} from '@/types/commissions'

/**
 * Mock commission ledger for the dev session and MSW.
 * Dates and amounts are the API contract, not estimates. Pending rows keep
 * null payout_date / amount_cents until a test or mark-paid updates them.
 * The schedule rollup matches api/commission_calc.py: null when every amount
 * is unknown, amount_partial when mixed, and separate undated buckets.
 */

type StoredStatus = CommissionInstallmentStatus | 'scheduled'

interface StoredInstallment extends Omit<CommissionInstallment, 'status'> {
  status: StoredStatus
}

interface StoredCommission extends Omit<Commission, 'installments'> {
  installments: StoredInstallment[]
}

export const mockCommissionReps: CommissionRep[] = [
  {
    id: 'rep-1',
    name: 'Alex Rivera',
    email: 'alex.rivera@example.com',
    commission_rate: 0.05,
    effective_date: '2026-01-01',
    plan_key: 'standard',
    plan_name: 'Standard Sales Commission',
  },
  {
    id: 'rep-legacy',
    name: 'Michelle Cady',
    email: 'michelle.cady@example.com',
    commission_rate: 0.04,
    effective_date: '2026-01-01',
    plan_key: null,
    plan_name: null,
  },
]

const SEED: StoredCommission[] = [
  {
    id: 'comm-palm',
    estimate_id: 'est-palm',
    lead_id: 'lead-palm',
    user_id: 'rep-1',
    contract_value_cents: 2_666_667,
    commission_rate: 0.03,
    commission_amount_cents: 80_000,
    status: 'paid',
    approved_at: '2026-01-15T15:00:00Z',
    paid_at: '2026-08-31T15:00:00Z',
    payment_period: 'August 2026',
    notes: 'All three installments paid.',
    created_at: '2026-01-15T15:00:00Z',
    updated_at: '2026-08-31T15:00:00Z',
    rep_name: 'Alex Rivera',
    rep_email: 'alex.rivera@example.com',
    property_name: 'Palm Court HOA',
    estimate_number: 1042,
    aspire_number: 'ASP-1042',
    estimate_type: 'maintenance',
    close_quarter: '2026-Q1',
    plan_key: 'standard',
    rep_plan_key: 'standard',
    plan_name: 'Standard Sales Commission',
    client_type: null,
    contract_start_date: '2026-01-06',
    installments: [
      installment('palm-1', 1, 'March 2026', '2026-03-31', 26_666, 'paid', null),
      installment('palm-2', 2, 'July 2026', '2026-07-15', 26_667, 'paid', 6),
      installment('palm-3', 3, 'August 2026', '2026-08-31', 26_667, 'paid', 12),
    ],
  },
  {
    id: 'comm-dobson',
    estimate_id: 'est-dobson',
    lead_id: 'lead-dobson',
    user_id: 'rep-1',
    contract_value_cents: 1_000_000,
    commission_rate: 0.03,
    commission_amount_cents: 30_000,
    status: 'approved',
    approved_at: '2026-04-08T15:00:00Z',
    paid_at: null,
    payment_period: null,
    notes: 'Payment 1 is the close-quarter check. Payments 2 and 3 wait on billing.',
    created_at: '2026-04-08T15:00:00Z',
    updated_at: '2026-04-08T15:00:00Z',
    rep_name: 'Alex Rivera',
    rep_email: 'alex.rivera@example.com',
    property_name: 'Dobson Ranch HOA',
    estimate_number: 1108,
    aspire_number: 'ASP-1108',
    estimate_type: 'maintenance',
    close_quarter: '2026-Q2',
    plan_key: 'standard',
    rep_plan_key: 'standard',
    plan_name: 'Standard Sales Commission',
    client_type: null,
    contract_start_date: '2026-04-01',
    installments: [
      installment('dob-1', 1, 'June 2026', '2026-06-30', 15_000, 'scheduled', null),
      installment('dob-2', 2, null, null, 15_000, 'pending_billing_data', 6),
      installment('dob-3', 3, null, null, null, 'pending_billing_data', 12),
    ],
  },
  {
    id: 'comm-mesa',
    estimate_id: 'est-mesa',
    lead_id: 'lead-mesa',
    user_id: 'rep-1',
    contract_value_cents: 500_000,
    commission_rate: 0.03,
    commission_amount_cents: 15_000,
    status: 'approved',
    approved_at: '2026-08-03T15:00:00Z',
    paid_at: null,
    payment_period: null,
    notes: 'First check is the end of the quarter the contract starts in.',
    created_at: '2026-08-03T15:00:00Z',
    updated_at: '2026-08-03T15:00:00Z',
    rep_name: 'Alex Rivera',
    rep_email: 'alex.rivera@example.com',
    property_name: 'Mesa Medical Plaza',
    estimate_number: 1188,
    aspire_number: 'ASP-1188',
    estimate_type: 'maintenance',
    close_quarter: '2026-Q3',
    plan_key: 'standard',
    rep_plan_key: 'standard',
    plan_name: 'Standard Sales Commission',
    client_type: null,
    contract_start_date: '2026-08-15',
    installments: [
      installment('mesa-1', 1, 'September 2026', '2026-09-30', 7_500, 'scheduled', null),
      installment('mesa-2', 2, null, null, 7_500, 'pending_billing_data', 6),
      installment('mesa-3', 3, null, null, null, 'pending_billing_data', 12),
    ],
  },
]

function installment(
  id: string,
  installmentNumber: number,
  payoutPeriod: string | null,
  payoutDate: string | null,
  amountCents: number | null,
  status: StoredStatus,
  billingInstallmentNumber: number | null,
): StoredInstallment {
  return {
    id,
    installment_number: installmentNumber,
    payout_period: payoutPeriod,
    payout_date: payoutDate,
    amount_cents: amountCents,
    status,
    billing_installment_number: billingInstallmentNumber,
    collected_amount_cents: null,
  }
}

let deals: StoredCommission[] = structuredClone(SEED)

export function resetMockCommissions() {
  deals = structuredClone(SEED)
}

function etToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}

function deriveStatus(
  stored: StoredStatus,
  commissionStatus: Commission['status'],
  payoutDate: string | null,
  today: string,
): CommissionInstallmentStatus {
  if (stored === 'paid' || commissionStatus === 'paid') return 'paid'
  if (stored === 'cancelled' || commissionStatus === 'cancelled') return 'cancelled'
  if (stored === 'pending_billing_data' || payoutDate == null) return 'pending_billing_data'
  return payoutDate <= today ? 'due' : 'upcoming'
}

function assignmentFor(userId: string): { rep_plan_key: string | null; plan_name: string | null } {
  const rep = mockCommissionReps.find((item) => item.id === userId)
  return {
    rep_plan_key: rep?.plan_key ?? null,
    plan_name: rep?.plan_name ?? null,
  }
}

function present(deal: StoredCommission, today: string): Commission {
  const assignment = assignmentFor(deal.user_id)
  return {
    ...deal,
    plan_key: deal.plan_key,
    rep_plan_key: assignment.rep_plan_key,
    plan_name: assignment.plan_name,
    installments: deal.installments.map((row) => ({
      ...row,
      status: deriveStatus(row.status, deal.status, row.payout_date, today),
    })),
  }
}

function presentedDeals(): Commission[] {
  const today = etToday()
  return deals.map((deal) => present(deal, today))
}

function inWindow(createdAt: string, start: string | null, end: string | null): boolean {
  const day = createdAt.slice(0, 10)
  if (start && day < start) return false
  if (end && day > end) return false
  return true
}

export function mockCommissionList(params: {
  user_id?: string | null
  status?: string | null
  estimate_type?: string | null
  start_date?: string | null
  end_date?: string | null
}): Commission[] {
  return presentedDeals().filter((deal) => {
    if (params.user_id && deal.user_id !== params.user_id) return false
    if (params.status && deal.status !== params.status) return false
    if (params.estimate_type && deal.estimate_type !== params.estimate_type) return false
    return inWindow(deal.created_at, params.start_date ?? null, params.end_date ?? null)
  })
}

function rollupStatus(statuses: CommissionInstallmentStatus[]): CommissionInstallmentStatus {
  const active = statuses.filter((status) => status !== 'cancelled')
  if (active.length === 0) return 'cancelled'
  if (active.every((status) => status === 'paid')) return 'paid'
  if (active.some((status) => status === 'due')) return 'due'
  if (active.some((status) => status === 'upcoming')) return 'upcoming'
  if (active.some((status) => status === 'pending_billing_data')) return 'pending_billing_data'
  return 'upcoming'
}

const OWN_PAGE_PLAN = {
  plan_key: 'standard',
  plan_name: 'Standard Sales Commission',
} as const

function planForRequestedRep(userId: string | null | undefined): { plan_key: string | null; plan_name: string | null } {
  if (!userId) return OWN_PAGE_PLAN
  const rep = mockCommissionReps.find((item) => item.id === userId)
  if (!rep) return OWN_PAGE_PLAN
  return { plan_key: rep.plan_key, plan_name: rep.plan_name }
}

export function mockCommissionSummary(params: {
  user_id?: string | null
  start_date?: string | null
  end_date?: string | null
}): CommissionSummary {
  const all = presentedDeals().filter((deal) => {
    if (deal.status === 'cancelled') return false
    if (params.user_id && deal.user_id !== params.user_id) return false
    return true
  })
  const inPeriod = all.filter((deal) => inWindow(deal.created_at, params.start_date ?? null, params.end_date ?? null))
  let scheduled = 0
  let paid = 0
  for (const deal of inPeriod) {
    if (deal.status === 'approved' || deal.status === 'paid') scheduled += deal.commission_amount_cents
    if (deal.status === 'paid') paid += deal.commission_amount_cents
  }

  let due = 0
  let upcoming = 0
  const byDate = new Map<string, { payout_period: string; payout_date: string; amount_cents: number }>()
  for (const deal of all) {
    for (const row of deal.installments) {
      const amount = row.amount_cents ?? 0
      if (row.status === 'due') due += amount
      if (row.status === 'upcoming') upcoming += amount
      if (row.status !== 'due' && row.status !== 'upcoming') continue
      if (!row.payout_date) continue
      const slot = byDate.get(row.payout_date) ?? {
        payout_period: row.payout_period ?? '',
        payout_date: row.payout_date,
        amount_cents: 0,
      }
      slot.amount_cents += amount
      byDate.set(row.payout_date, slot)
    }
  }
  const nextKey = [...byDate.keys()].sort()[0]
  const plan = planForRequestedRep(params.user_id)
  return {
    scheduled_ytd_cents: scheduled,
    paid_ytd_cents: paid,
    next_payout: nextKey ? byDate.get(nextKey)! : null,
    due_cents: due,
    upcoming_cents: upcoming,
    balances_period_filtered: false,
    plan_key: plan.plan_key,
    plan_name: plan.plan_name,
  }
}

const UNSCHEDULED_LABEL = 'Unscheduled'
const BUCKET_ORDER: Record<CommissionPayoutBucket, number> = {
  dated: 0,
  unscheduled: 1,
  pending_billing_data: 2,
}

interface AmountGroup {
  knownCents: number
  known: number
  unknown: number
  statuses: CommissionInstallmentStatus[]
  labels: string[]
  payoutDate: string | null
  installmentNumber: number
  bucket: CommissionPayoutBucket
}

function newAmountGroup(bucket: CommissionPayoutBucket, installmentNumber = 0): AmountGroup {
  return {
    knownCents: 0,
    known: 0,
    unknown: 0,
    statuses: [],
    labels: [],
    payoutDate: null,
    installmentNumber,
    bucket,
  }
}

function installmentBucket(row: CommissionInstallment): CommissionPayoutBucket {
  if (row.payout_date) return 'dated'
  if (row.amount_cents == null) return 'pending_billing_data'
  return 'unscheduled'
}

function addToAmountGroup(group: AmountGroup, row: CommissionInstallment) {
  group.statuses.push(row.status)
  if (row.payout_period) group.labels.push(row.payout_period)
  if (group.payoutDate == null && row.payout_date) group.payoutDate = row.payout_date
  if (row.status === 'cancelled') return
  if (row.amount_cents == null) {
    group.unknown += 1
    return
  }
  group.known += 1
  group.knownCents += row.amount_cents
}

function finishAmountGroup(group: AmountGroup) {
  let amount: number | null
  let partial: boolean
  if (group.known === 0 && group.unknown > 0) {
    amount = null
    partial = false
  } else if (group.unknown > 0) {
    amount = group.knownCents
    partial = true
  } else {
    amount = group.knownCents
    partial = false
  }
  const labels = group.labels
  const defaultLabel = group.bucket === 'unscheduled' ? UNSCHEDULED_LABEL : null
  const period = labels.length > 0 && labels.every((label) => label === labels[0]) ? labels[0] : defaultLabel
  return {
    payout_period: period,
    payout_date: group.payoutDate,
    amount_cents: amount,
    amount_partial: partial,
    status: rollupStatus(group.statuses),
    bucket: group.bucket,
  }
}

export function mockPayoutSchedule(userId: string, year: number): CommissionPayoutSchedule {
  const source = presentedDeals().filter((deal) => {
    if (deal.status === 'cancelled') return false
    if (deal.user_id !== userId) return false
    return (deal.close_quarter ?? '').startsWith(`${year}-Q`)
  })

  const quarters = new Map<string, {
    close_quarter: string
    sales_count: number
    commission_total_cents: number
    groups: Map<string, AmountGroup>
  }>()
  const periods = new Map<string, AmountGroup>()

  for (const deal of source) {
    const quarterKey = deal.close_quarter ?? 'unknown'
    const quarter = quarters.get(quarterKey) ?? {
      close_quarter: quarterKey,
      sales_count: 0,
      commission_total_cents: 0,
      groups: new Map(),
    }
    quarter.sales_count += 1
    quarter.commission_total_cents += deal.commission_amount_cents
    quarters.set(quarterKey, quarter)

    for (const row of deal.installments) {
      const kind = installmentBucket(row)
      const groupKey = `${kind}|${row.installment_number}|${row.payout_date ?? ''}`
      const agg = quarter.groups.get(groupKey) ?? newAmountGroup(kind, row.installment_number)
      addToAmountGroup(agg, row)
      quarter.groups.set(groupKey, agg)

      const periodKey = kind === 'dated' ? `dated|${row.payout_date ?? ''}` : kind
      const period = periods.get(periodKey) ?? newAmountGroup(kind)
      addToAmountGroup(period, row)
      periods.set(periodKey, period)
    }
  }

  const quarterRows = [...quarters.keys()].sort().map((key) => {
    const quarter = quarters.get(key)!
    const installments = [...quarter.groups.values()]
      .sort((a, b) => {
        const numberDiff = a.installmentNumber - b.installmentNumber
        if (numberDiff !== 0) return numberDiff
        const bucketDiff = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket]
        if (bucketDiff !== 0) return bucketDiff
        return (a.payoutDate ?? '').localeCompare(b.payoutDate ?? '')
      })
      .map((group) => ({
        installment_number: group.installmentNumber,
        ...finishAmountGroup(group),
      }))
    return {
      close_quarter: quarter.close_quarter,
      sales_count: quarter.sales_count,
      commission_total_cents: quarter.commission_total_cents,
      installments,
    }
  })

  const byPayoutPeriod = [...periods.values()]
    .sort((a, b) => {
      const bucketDiff = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket]
      if (bucketDiff !== 0) return bucketDiff
      return (a.payoutDate ?? '').localeCompare(b.payoutDate ?? '')
    })
    .map((group) => finishAmountGroup(group))

  return {
    user_id: userId,
    year,
    quarters: quarterRows,
    by_payout_period: byPayoutPeriod,
  }
}

export function markMockInstallmentPaid(installmentId: string): boolean {
  for (const deal of deals) {
    const row = deal.installments.find((item) => item.id === installmentId)
    if (!row) continue
    if (row.status === 'cancelled' || deal.status === 'cancelled') return false
    row.status = 'paid'
    if (deal.installments.every((item) => item.status === 'paid')) {
      const finalRow = [...deal.installments].sort((a, b) => b.installment_number - a.installment_number)[0]
      deal.status = 'paid'
      deal.paid_at = new Date().toISOString()
      deal.payment_period = finalRow?.payout_period ?? null
    }
    deal.updated_at = new Date().toISOString()
    return true
  }
  return false
}

export function markMockCommissionPaid(commissionId: string, paymentPeriod: string): boolean {
  const deal = deals.find((item) => item.id === commissionId)
  if (!deal) return false
  deal.status = 'paid'
  deal.paid_at = new Date().toISOString()
  deal.payment_period = paymentPeriod
  deal.updated_at = deal.paid_at
  for (const row of deal.installments) row.status = 'paid'
  return true
}
