import { describe, expect, it } from 'vitest'
import { groupApprovalTiersByRole } from '@/lib/estimating/approvalOrder'
import type { ApprovalTier } from '@/types/estimating'

function tier(over: Partial<ApprovalTier> & Pick<ApprovalTier, 'id' | 'roleKey' | 'order'>): ApprovalTier {
  return {
    label: over.roleKey,
    minValueCents: 0,
    maxValueCents: null,
    estimateType: 'maintenance',
    ...over,
  }
}

describe('groupApprovalTiersByRole', () => {
  it('orders the ladder before equal-order admin and vp_sales rows', () => {
    const groups = groupApprovalTiersByRole([
      tier({ id: 'vp-i', roleKey: 'vp_sales', label: 'VP of Sales', order: 5, estimateType: 'install' }),
      tier({ id: 'admin-m', roleKey: 'admin', label: '', order: 5, estimateType: 'maintenance' }),
      tier({ id: 'ceo-m', roleKey: 'ceo', label: 'CEO', order: 4 }),
      tier({ id: 'mgr-i', roleKey: 'manager', label: 'Branch Manager', order: 1, estimateType: 'install' }),
      tier({ id: 'admin-i', roleKey: 'admin', label: 'Admin', order: 5, estimateType: 'install' }),
      tier({ id: 'mgr-m', roleKey: 'manager', label: 'Branch Manager', order: 1 }),
      tier({ id: 'vp-m', roleKey: 'vp_sales', label: 'VP of Sales', order: 5 }),
    ])

    expect(groups.map((group) => group[0].roleKey)).toEqual([
      'manager',
      'ceo',
      'admin',
      'vp_sales',
    ])
    expect(groups.find((group) => group[0].roleKey === 'admin')?.map((row) => row.id)).toEqual([
      'admin-m',
      'admin-i',
    ])
    expect(groups.find((group) => group[0].roleKey === 'manager')?.map((row) => row.estimateType)).toEqual([
      'install',
      'maintenance',
    ])
  })
})
