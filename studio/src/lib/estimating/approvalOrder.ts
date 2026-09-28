import type { ApprovalRoleKey, ApprovalTier } from '@/types/estimating'

/**
 * Canonical ladder, then the admin-equivalent ceiling rows. Used when two
 * tiers share a `order` value (migration 068 gives admin and vp_sales the
 * same tier_order) so routing and the settings form do not follow whatever
 * order the API happened to return.
 */
export const APPROVAL_ROLE_ORDER = [
  'manager',
  'regional_director',
  'vice_president',
  'ceo',
  'admin',
  'vp_sales',
] as const satisfies readonly ApprovalRoleKey[]

export function approvalRoleRank(role: ApprovalRoleKey): number {
  const index = APPROVAL_ROLE_ORDER.indexOf(role)
  return index === -1 ? APPROVAL_ROLE_ORDER.length : index
}

/** DB `order` first, then canonical role rank for ties. */
export function compareApprovalTiers(a: ApprovalTier, b: ApprovalTier): number {
  if (a.order !== b.order) return a.order - b.order
  return approvalRoleRank(a.roleKey) - approvalRoleRank(b.roleKey)
}

/** One group per roleKey, groups and rows inside a group in compareApprovalTiers order. */
export function groupApprovalTiersByRole(tiers: readonly ApprovalTier[]): ApprovalTier[][] {
  const byRole = new Map<ApprovalRoleKey, ApprovalTier[]>()
  for (const tier of tiers) {
    const group = byRole.get(tier.roleKey)
    if (group) group.push(tier)
    else byRole.set(tier.roleKey, [tier])
  }
  for (const group of byRole.values()) group.sort(compareApprovalTiers)
  return [...byRole.values()].sort((a, b) => compareApprovalTiers(a[0], b[0]))
}
