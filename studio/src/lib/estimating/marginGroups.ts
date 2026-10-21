/**
 * Maintenance margin groups. Must stay in lockstep with `api/margin_groups.py`.
 *
 * Four commercial groups, fixed order. A line with no group is an error —
 * it is never dropped and never parked in an "Other" bucket.
 */

export const MARGIN_GROUP_NAMES = [
  'Mowing',
  'Pest Control',
  'Optional Services',
  'Subcontractors',
] as const

export type MarginGroupName = (typeof MARGIN_GROUP_NAMES)[number]

const KNOWN: ReadonlySet<string> = new Set(MARGIN_GROUP_NAMES)

export class UnassignedMarginGroupError extends Error {
  readonly labels: string[]

  constructor(labels: string[]) {
    super(`Service has no margin group: ${labels.join(', ')}`)
    this.name = 'UnassignedMarginGroupError'
    this.labels = labels
  }
}

export function resolveMarginGroup(
  label: string,
  serviceType?: string | null,
  marginGroup?: string | null,
): MarginGroupName | null {
  const explicit = (marginGroup ?? '').trim()
  if (explicit) {
    return KNOWN.has(explicit) ? (explicit as MarginGroupName) : null
  }
  const blob = `${label} ${serviceType ?? ''}`
    .replace(/\/+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  if (blob.includes('subcontract')) return 'Subcontractors'
  if (blob.includes('optional')) return 'Optional Services'
  if (['pest', 'insect', 'disease', 'ipm'].some((token) => blob.includes(token))) {
    return 'Pest Control'
  }
  if (/\bmow/.test(blob) || blob.includes('small area island production')) return 'Mowing'
  return null
}

/** Largest-remainder integer percents. Sum to 100 when contract > 0. */
export function roundedSharePercents(prices: number[], contract: number): number[] {
  if (contract <= 0) return prices.map(() => 0)
  const floors = prices.map((price) => Math.floor((price * 100) / contract))
  const leftover = 100 - floors.reduce((sum, n) => sum + n, 0)
  const ranked = floors
    .map((_, i) => i)
    .sort((a, b) => {
      const restA = prices[a] * 100 - floors[a] * contract
      const restB = prices[b] * 100 - floors[b] * contract
      if (restA !== restB) return restB - restA
      return a - b
    })
  const out = [...floors]
  for (const index of ranked.slice(0, leftover)) out[index] += 1
  return out
}
