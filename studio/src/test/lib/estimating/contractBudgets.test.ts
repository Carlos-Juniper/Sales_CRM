import { describe, it, expect } from 'vitest'
import {
  formatOptionalBudget,
  parseContractBudget,
  resolveContractBudgets,
} from '@/lib/estimating/contractBudgets'

describe('parseContractBudget', () => {
  it('treats blank and whitespace as null, never 0', () => {
    expect(parseContractBudget('', 'homesBudget')).toEqual({ ok: true, value: null })
    expect(parseContractBudget('   ', 'homesBudget')).toEqual({ ok: true, value: null })
    expect(parseContractBudget(null, 'homesBudget')).toEqual({ ok: true, value: null })
    expect(parseContractBudget(undefined, 'homesBudget')).toEqual({ ok: true, value: null })
  })

  it('keeps a typed 0', () => {
    expect(parseContractBudget(0, 'homesBudget')).toEqual({ ok: true, value: 0 })
    expect(parseContractBudget('0', 'homesBudget')).toEqual({ ok: true, value: 0 })
    expect(parseContractBudget('0.00', 'homesBudget')).toEqual({ ok: true, value: 0 })
  })

  it('parses dollars and rounds half-up to cents', () => {
    expect(parseContractBudget('120000', 'homesBudget')).toEqual({ ok: true, value: 120000 })
    expect(parseContractBudget('10.005', 'commonAreaBudget')).toEqual({ ok: true, value: 10.01 })
    expect(parseContractBudget(10.004, 'commonAreaBudget')).toEqual({ ok: true, value: 10 })
  })

  it('rejects negatives and non-numeric values', () => {
    expect(parseContractBudget(-1, 'homesBudget').ok).toBe(false)
    expect(parseContractBudget('-5', 'homesBudget').ok).toBe(false)
    expect(parseContractBudget('abc', 'homesBudget').ok).toBe(false)
    expect(parseContractBudget('1e2', 'homesBudget').ok).toBe(false)
  })
})

describe('resolveContractBudgets', () => {
  it('lets a top-level value win over intake.payload', () => {
    const body = {
      homesBudget: 10,
      intake: { payload: { homesBudget: '', commonAreaBudget: '0' } },
    }
    expect(resolveContractBudgets(body)).toEqual({
      ok: true,
      homesBudget: 10,
      commonAreaBudget: 0,
    })
    expect(body.intake.payload.homesBudget).toBe(10)
    expect(body.intake.payload.commonAreaBudget).toBe(0)
  })

  it('stores null when a budget is omitted from both places', () => {
    expect(resolveContractBudgets({ intake: { payload: {} } })).toEqual({
      ok: true,
      homesBudget: null,
      commonAreaBudget: null,
    })
  })
})

describe('formatOptionalBudget', () => {
  it('renders null as an em dash and a real zero as $0', () => {
    expect(formatOptionalBudget(null)).toBe('—')
    expect(formatOptionalBudget(undefined)).toBe('—')
    expect(formatOptionalBudget(0)).toBe('$0')
    expect(formatOptionalBudget(120000)).toBe('$120,000')
  })
})
