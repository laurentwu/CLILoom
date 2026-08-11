// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { colorToHex } from './color-picker'

describe('colorToHex', () => {
  it('passes through and expands hex values', () => {
    expect(colorToHex('#fff')).toBe('#ffffff')
    expect(colorToHex('#aabbcc')).toBe('#aabbcc')
  })

  it('converts oklch tokens (the builtin defaults) to hex', () => {
    // oklch(1 0 0) is pure white
    expect(colorToHex('oklch(1 0 0)')).toBe('#ffffff')
    // oklch(0 0 0) is pure black
    expect(colorToHex('oklch(0 0 0)')).toBe('#000000')
  })

  it('converts oklab values', () => {
    expect(colorToHex('oklab(1 0 0)')).toBe('#ffffff')
    expect(colorToHex('oklab(0 0 0)')).toBe('#000000')
  })

  it('returns black for unparseable values instead of throwing', () => {
    expect(colorToHex('#zzz')).toBe('#000000')
  })
})
