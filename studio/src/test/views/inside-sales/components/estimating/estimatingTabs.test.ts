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
  it('returns every tab when no estimate is open', () => {
    expect(visibleTabs(null)).toEqual(ESTIMATING_TABS)
  })

  it('maintenance hides Materials Calculator and Discrepancy Review but keeps Takeoff Insert', () => {
    const keys = visibleTabs('maintenance').map((t) => t.key)
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
    const keys = visibleTabs('install').map((t) => t.key)
    expect(keys).not.toContain('takeoff')
    expect(keys).toContain('materials')
    expect(keys).toContain('discrepancy')
    expect(keys).toContain('queue')
    expect(keys).toContain('editor')
    expect(keys).toContain('margins')
  })
})
