import { describe, it, expect } from 'vitest'
import { teamMemberTitleLabel, TEAM_MEMBER_TITLE_LABELS } from '@/lib/proposal/titleLabels'

describe('teamMemberTitleLabel', () => {
  it('returns mapped label for known title', () => {
    expect(teamMemberTitleLabel('regional_director')).toBe('Regional Director')
  })
  it('returns mapped label for sales_rep', () => {
    expect(teamMemberTitleLabel('sales_rep')).toBe('Sales Representative')
  })
  it('falls back to title-cased snake_case for unknown titles', () => {
    expect(teamMemberTitleLabel('unknown_title')).toBe('Unknown Title')
  })
  it('all values in TEAM_MEMBER_TITLE_LABELS are non-empty strings', () => {
    Object.values(TEAM_MEMBER_TITLE_LABELS).forEach(label => {
      expect(label.length).toBeGreaterThan(0)
    })
  })
  it('returns mapped label for branch_manager', () => {
    expect(teamMemberTitleLabel('branch_manager')).toBe('Branch Manager')
  })
  it('returns mapped label for account_manager', () => {
    expect(teamMemberTitleLabel('account_manager')).toBe('Account Manager')
  })
  it('returns mapped label for manager (canonical alias)', () => {
    expect(teamMemberTitleLabel('manager')).toBe('Branch Manager')
  })
})
