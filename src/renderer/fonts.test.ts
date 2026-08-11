// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import {
  BUNDLED_CODE_FONT_FAMILY,
  buildCodeFontStack,
  getAppliedCodeFontStack,
  SYSTEM_CODE_FONT_FAMILY
} from './fonts'

describe('code font stack', () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty('--font-code')
  })

  it('quotes every named family while preserving CSS generic families', () => {
    expect(buildCodeFontStack('0xProto')).toMatch(/^'0xProto', 'JetBrains Mono Variable'/)
    expect(buildCodeFontStack('M+1m')).toMatch(/^'M\+1m', 'JetBrains Mono Variable'/)
    expect(buildCodeFontStack('Writer\'s & Co. Mono'))
      .toMatch(/^'Writer\\'s & Co\. Mono', 'JetBrains Mono Variable'/)
    expect(buildCodeFontStack('Back\\Slash Mono'))
      .toMatch(/^'Back\\\\Slash Mono', 'JetBrains Mono Variable'/)
    expect(buildCodeFontStack('Font\'; color: red'))
      .toMatch(/^'Font\\'; color: red', 'JetBrains Mono Variable'/)
    expect(buildCodeFontStack(SYSTEM_CODE_FONT_FAMILY)).toMatch(/^ui-monospace, 'JetBrains Mono Variable'/)
  })

  it('trims custom names and always keeps the bundled fallback', () => {
    expect(buildCodeFontStack('  Fira Code  ')).toMatch(
      /^'Fira Code', 'JetBrains Mono Variable', ui-monospace/
    )
  })

  it('deduplicates the bundled family', () => {
    const stack = buildCodeFontStack(BUNDLED_CODE_FONT_FAMILY)
    expect(stack.match(/JetBrains Mono Variable/g)).toHaveLength(1)
  })

  it('falls back safely for empty or control-character values', () => {
    expect(buildCodeFontStack('')).toBe(buildCodeFontStack('JetBrains Mono'))
    expect(buildCodeFontStack('Fira\nCode')).toBe(buildCodeFontStack('JetBrains Mono'))
  })

  it('reads the applied variable and falls back when it is empty', () => {
    expect(getAppliedCodeFontStack()).toBe(buildCodeFontStack('JetBrains Mono'))

    document.documentElement.style.setProperty('--font-code', "'Iosevka Term', monospace")
    expect(getAppliedCodeFontStack()).toBe("'Iosevka Term', monospace")
  })
})
