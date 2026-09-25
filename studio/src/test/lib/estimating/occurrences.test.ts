import { describe, expect, it } from 'vitest'
import {
  occurrenceCountError,
  parseOccurrenceInput,
} from '@/lib/estimating/occurrences'

describe('parseOccurrenceInput', () => {
  it('maps a blank input to null and keeps 0', () => {
    expect(parseOccurrenceInput('')).toBeNull()
    expect(parseOccurrenceInput('   ')).toBeNull()
    expect(parseOccurrenceInput('0')).toBe(0)
  })

  it('parses whole numbers in range as integers', () => {
    expect(parseOccurrenceInput('42')).toBe(42)
    expect(parseOccurrenceInput('366')).toBe(366)
    expect(parseOccurrenceInput(' 12 ')).toBe(12)
  })

  it('rejects decimals and values outside 0 to 366', () => {
    expect(parseOccurrenceInput('1.5')).toBe('invalid')
    expect(parseOccurrenceInput('1.0')).toBe('invalid')
    expect(parseOccurrenceInput('-1')).toBe('invalid')
    expect(parseOccurrenceInput('367')).toBe('invalid')
    expect(parseOccurrenceInput('42e0')).toBe('invalid')
  })
})

describe('occurrenceCountError', () => {
  it('accepts null and integers, and names the field on a bad JSON value', () => {
    expect(occurrenceCountError('mowingOccurrences', null)).toBeNull()
    expect(occurrenceCountError('mowingOccurrences', 0)).toBeNull()
    expect(occurrenceCountError('mowingOccurrences', 366)).toBeNull()
    expect(occurrenceCountError('mowingOccurrences', 1.5)).toBe(
      'mowingOccurrences must be an integer from 0 to 366, or null',
    )
    expect(occurrenceCountError('ipmOccurrences', '4')).toMatch(/^ipmOccurrences/)
    expect(occurrenceCountError('pruningOccurrences', true)).toMatch(/^pruningOccurrences/)
  })
})
