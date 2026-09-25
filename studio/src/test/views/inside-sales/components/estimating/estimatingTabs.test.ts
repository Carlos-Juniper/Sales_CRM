import { describe, it, expect } from 'vitest'
import {
  ESTIMATING_TABS,
  visibleTabs,
  type EstimatingTabKey,
} from '@/views/inside-sales/components/estimating/estimatingTabs'

describe('ESTIMATING_TABS config', () => {
  it('defines the 9 redesign tabs in design order', () => {
    expect(ESTIMATING_TABS.map((t) => t.key)).toEqual<EstimatingTabKey[]>([
      'queue',
      'editor',
      'takeoff',
      'materials',
      'margins',
      'discrepancy',
      'approval',
      'approvalQueue',
      'itb',
    ])
  })

  it('carries a label and icon for every tab (config-driven, no hardcoded JSX)', () => {
    for (const tab of ESTIMATING_TABS) {
      expect(tab.label).toBeTruthy()
      expect(tab.icon).toBeTruthy()
      expect(tab.visibleForTypes.length).toBeGreaterThan(0)
    }
  })

  it('uses the design labels', () => {
    expect(ESTIMATING_TABS.map((t) => t.label)).toEqual([
      'Estimate Queue',
      'Line-Item Editor',
      'Takeoff Insert',
      'Materials Calculator',
      'Margin Analysis',
      'Discrepancy Review',
      'Approval & Handoff',
      'Approval Queue',
      'ITB Tracker',
    ])
  })
})

describe('visibleTabs (estimateType-aware visibility)', () => {
  it('returns every tab when no estimate is open (estimator role)', () => {
    expect(visibleTabs(null, 'maintenance_estimating')).toEqual(ESTIMATING_TABS)
  })

  it('maintenance hides Materials Calculator and Discrepancy Review but keeps Takeoff Insert', () => {
    const keys = visibleTabs('maintenance', 'maintenance_estimating').map((t) => t.key)
    expect(keys).not.toContain('materials')
    expect(keys).not.toContain('discrepancy')
    expect(keys).toContain('takeoff')
    expect(keys).toContain('queue')
    expect(keys).toContain('editor')
    expect(keys).toContain('margins')
    expect(keys).toContain('approval')
    expect(keys).toContain('approvalQueue')
    expect(keys).toContain('itb')
  })

  it('install hides Takeoff Insert but keeps Materials Calculator and Discrepancy Review', () => {
    const keys = visibleTabs('install', 'install_estimating').map((t) => t.key)
    expect(keys).not.toContain('takeoff')
    expect(keys).toContain('materials')
    expect(keys).toContain('discrepancy')
    expect(keys).toContain('queue')
    expect(keys).toContain('editor')
    expect(keys).toContain('margins')
  })
})

describe('visibleTabs (role-aware visibility — Handoff 50 §2)', () => {
  it('sales sees ONLY the queue tab, with no estimate open', () => {
    expect(visibleTabs(null, 'sales').map((t) => t.key)).toEqual(['queue'])
  })

  it('sales sees ONLY the queue tab, with an estimate open', () => {
    expect(visibleTabs('maintenance', 'sales').map((t) => t.key)).toEqual(['queue'])
    expect(visibleTabs('install', 'sales').map((t) => t.key)).toEqual(['queue'])
  })

  it('estimators see every estimator tab (no regression) with no estimate open', () => {
    expect(visibleTabs(null, 'maintenance_estimating')).toEqual(ESTIMATING_TABS)
    expect(visibleTabs(null, 'install_estimating')).toEqual(ESTIMATING_TABS)
  })

  it('manager-tier approver roles see every tab', () => {
    for (const role of ['manager', 'regional_director', 'vice_president', 'ceo', 'admin', 'regional_sales_rep', 'vp_sales'] as const) {
      expect(visibleTabs(null, role)).toEqual(ESTIMATING_TABS)
    }
  })

  it('marketing does not reach estimator tabs — sees only the queue at most', () => {
    const keys = visibleTabs(null, 'marketing').map((t) => t.key)
    expect(keys).not.toContain('editor')
    expect(keys).not.toContain('takeoff')
  })

  it('procurement sees ONLY the queue tab, same as sales', () => {
    expect(visibleTabs(null, 'procurement').map((t) => t.key)).toEqual(['queue'])
    expect(visibleTabs('maintenance', 'procurement').map((t) => t.key)).toEqual(['queue'])
    expect(visibleTabs('install', 'procurement').map((t) => t.key)).toEqual(['queue'])
  })

  it('stays a pure function of config — every returned tab is a config row', () => {
    for (const role of ['sales', 'maintenance_estimating', 'manager'] as const) {
      for (const tab of visibleTabs(null, role)) {
        expect(ESTIMATING_TABS).toContain(tab)
      }
    }
  })

  it('applies role and type filters together', () => {
    expect(visibleTabs('install', 'sales').map((t) => t.key)).toEqual(['queue'])
  })
})
