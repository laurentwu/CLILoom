import { describe, expect, it } from 'vitest'
import { appendBoundedText, tailText } from './terminalBuffer'

describe('terminal text buffers', () => {
  it('keeps appended text unchanged while it is within the limit', () => {
    expect(appendBoundedText('abc', 'def', 6)).toBe('abcdef')
  })

  it('keeps only the newest appended text after reaching the limit', () => {
    expect(appendBoundedText('abcdef', 'ghij', 6)).toBe('efghij')
    expect(appendBoundedText('old', '123456789', 6)).toBe('456789')
  })

  it('returns only the requested tail without changing short text', () => {
    expect(tailText('abcdef', 4)).toBe('cdef')
    expect(tailText('abc', 4)).toBe('abc')
  })
})
