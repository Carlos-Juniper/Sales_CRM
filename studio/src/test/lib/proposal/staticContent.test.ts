import { afterEach, describe, expect, it, vi } from 'vitest'

import { findTodoStrings } from '@/lib/proposal/staticContent'

describe('findTodoStrings', () => {
  it('returns every TODO string value from a nested object/array structure', () => {
    const content = {
      heading: 'All good here',
      body: [
        'A clean paragraph.',
        'TODO: real copy from Caitlyn',
        { note: 'nested todo: verify this bullet' },
      ],
      nested: {
        deeper: ['fine', 'Another TODO here'],
      },
    }

    const hits = findTodoStrings(content)

    expect(hits).toContain('TODO: real copy from Caitlyn')
    expect(hits).toContain('nested todo: verify this bullet')
    expect(hits).toContain('Another TODO here')
    expect(hits).toHaveLength(3)
  })

  it('matches TODO case-insensitively', () => {
    expect(findTodoStrings('todo lowercase')).toEqual(['todo lowercase'])
    expect(findTodoStrings('ToDo mixed')).toEqual(['ToDo mixed'])
  })

  it('returns an empty array for content with no TODO strings', () => {
    const content = {
      heading: 'Rooted in Florida',
      body: ['Fully finalized marketing copy.', { text: 'done' }],
    }

    expect(findTodoStrings(content)).toEqual([])
  })

  it('ignores non-string leaves (numbers, booleans, null, undefined)', () => {
    const content = { a: 1, b: true, c: null, d: undefined, e: 'TODO keep me' }

    expect(findTodoStrings(content)).toEqual(['TODO keep me'])
  })

  it('handles a bare string input', () => {
    expect(findTodoStrings('TODO: bare')).toEqual(['TODO: bare'])
    expect(findTodoStrings('clean')).toEqual([])
  })
})

describe('warnOnTodoStrings (dev warn path)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls console.warn for each TODO string in the content', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { warnOnTodoStrings } = await import('@/lib/proposal/staticContent')

    warnOnTodoStrings({ body: ['TODO one', 'clean', 'TODO two'] })

    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('does not call console.warn for clean content', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { warnOnTodoStrings } = await import('@/lib/proposal/staticContent')

    warnOnTodoStrings({ body: ['all clean', 'finalized'] })

    expect(warn).not.toHaveBeenCalled()
  })
})
