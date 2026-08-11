import { describe, expect, it } from 'vitest'
import {
  BUILTIN_SKINS,
  BUILTIN_SKIN_DARK_ID,
  BUILTIN_SKIN_LIGHT_ID,
  DEFAULT_ACTIVE_SKIN_ID,
  DEFAULT_CODE_FONT_FAMILY,
  MAX_IMPORT_BYTES,
  MAX_USER_SKINS,
  SKIN_BOUNDS,
  createUserSkinId,
  defaultSkinContent,
  getBuiltinSkin,
  isBuiltinSkinId,
  isValidCodeFontFamily,
  isValidColor,
  isValidSkinName,
  parseImportedSkin,
  parseSkinContent,
  parseSkinLibrary,
  parseUserSkin,
  serializeSkinForExport
} from './skin'

function validContent() {
  return defaultSkinContent('light')
}

describe('builtin skins', () => {
  it('exposes a single light and single dark preset', () => {
    expect(BUILTIN_SKINS).toHaveLength(2)
    expect(BUILTIN_SKINS.map((skin) => skin.id).sort()).toEqual(
      [BUILTIN_SKIN_LIGHT_ID, BUILTIN_SKIN_DARK_ID].sort()
    )
    expect(DEFAULT_ACTIVE_SKIN_ID).toBe(BUILTIN_SKIN_LIGHT_ID)
  })

  it('resolves builtin skins by id', () => {
    expect(getBuiltinSkin(BUILTIN_SKIN_LIGHT_ID)?.mode).toBe('light')
    expect(getBuiltinSkin(BUILTIN_SKIN_DARK_ID)?.mode).toBe('dark')
    expect(getBuiltinSkin('builtin.light.missing')).toBeUndefined()
  })

  it('uses the stock shadcn light tokens for the default skin', () => {
    const light = getBuiltinSkin(BUILTIN_SKIN_LIGHT_ID)!
    expect(light.colors.primary).toBe('oklch(0.205 0 0)')
    expect(light.colors.background).toBe('oklch(1 0 0)')
  })
})

describe('color validation', () => {
  it('accepts oklch, hex and rgb', () => {
    expect(isValidColor('oklch(0.5 0.1 30)')).toBe(true)
    expect(isValidColor('#fff')).toBe(true)
    expect(isValidColor('#aabbcc')).toBe(true)
    expect(isValidColor('rgba(0,0,0,0.5)')).toBe(true)
  })

  it('rejects css injection and malformed colors', () => {
    expect(isValidColor('red; --x: 1')).toBe(false)
    expect(isValidColor('url(evil)')).toBe(false)
    expect(isValidColor('')).toBe(false)
    expect(isValidColor('not-a-color')).toBe(false)
    expect(isValidColor('#zzz')).toBe(false)
  })

  it('rejects malformed function bodies', () => {
    expect(isValidColor('rgb(foo)')).toBe(false)
    expect(isValidColor('oklch()')).toBe(false)
    expect(isValidColor('oklch(none none none)')).toBe(true)
  })
})

describe('parseSkinContent bounds', () => {
  it('clamps numeric fields into range', () => {
    const content = {
      ...validContent(),
      radius: 999,
      spacingScale: 10,
      typography: { codeFontFamily: 'Fira Code', fontSize: 999, lineHeight: 99 }
    }
    const parsed = parseSkinContent(content)
    expect(parsed?.radius).toBe(SKIN_BOUNDS.radiusMax)
    expect(parsed?.spacingScale).toBe(SKIN_BOUNDS.spacingMax)
    expect(parsed?.typography.fontSize).toBe(SKIN_BOUNDS.fontSizeMax)
    expect(parsed?.typography.lineHeight).toBe(SKIN_BOUNDS.lineHeightMax)
  })

  it('rejects invalid mode, colors, background and fonts', () => {
    expect(parseSkinContent({ ...validContent(), mode: 'purple' })).toBeNull()
    expect(parseSkinContent({ ...validContent(), colors: { ...validContent().colors, primary: 'evil;' } })).toBeNull()
    expect(parseSkinContent({ ...validContent(), typography: { codeFontFamily: 'a\nb', fontSize: 16, lineHeight: 1.5 } })).toBeNull()
    expect(parseSkinContent({ ...validContent(), background: { kind: 'gradient', stops: ['#fff'], angle: 10 } })).toBeNull()
  })

  it('migrates legacy UI font settings to the default code font', () => {
    const parsed = parseSkinContent({
      ...validContent(),
      typography: { fontFamily: 'Noto Sans SC Variable', fontSize: 15, lineHeight: 1.6 }
    })

    expect(parsed?.typography).toEqual({
      codeFontFamily: DEFAULT_CODE_FONT_FAMILY,
      fontSize: 15,
      lineHeight: 1.6
    })
  })

  it('validates a single code font family name', () => {
    expect(isValidCodeFontFamily('JetBrains Mono')).toBe(true)
    expect(isValidCodeFontFamily('  Fira Code  ')).toBe(true)
    expect(isValidCodeFontFamily('Writer\'s & Co. Mono')).toBe(true)
    expect(isValidCodeFontFamily('文泉驛（等寬）')).toBe(true)
    expect(isValidCodeFontFamily('Fira Code, monospace')).toBe(true)
    expect(isValidCodeFontFamily('x'.repeat(SKIN_BOUNDS.codeFontFamilyMax))).toBe(true)
    expect(isValidCodeFontFamily('x'.repeat(SKIN_BOUNDS.codeFontFamilyMax + 1))).toBe(false)
    expect(isValidCodeFontFamily('Fira\nCode')).toBe(false)
    expect(isValidCodeFontFamily('   ')).toBe(false)
  })

  it('defaults spacing scale to 1 when missing', () => {
    const { spacingScale, ...rest } = validContent()
    void spacingScale
    expect(parseSkinContent(rest)?.spacingScale).toBe(1)
  })
})

describe('user skin library parsing', () => {
  it('parses valid user skins and dedupes by id', () => {
    const id = createUserSkinId()
    const skin = { ...validContent(), id, builtin: false, name: 'My skin' }
    expect(parseUserSkin(skin)?.id).toBe(id)
    const library = parseSkinLibrary([skin, { ...skin, name: 'Dup' }])
    expect(library).toHaveLength(1)
  })

  it('rejects builtin ids and bad names', () => {
    expect(parseUserSkin({ ...validContent(), id: 'builtin.light.neutral', builtin: false, name: 'x' })).toBeNull()
    expect(parseUserSkin({ ...validContent(), id: createUserSkinId(), builtin: false, name: '' })).toBeNull()
  })

  it('migrates complete legacy library entries without dropping user skins', () => {
    const id = createUserSkinId()
    const library = parseSkinLibrary([{
      ...validContent(),
      id,
      builtin: false,
      name: 'Legacy skin',
      typography: { fontFamily: 'Noto Sans SC Variable', fontSize: 14, lineHeight: 1.4 }
    }])

    expect(library).toHaveLength(1)
    expect(library[0].id).toBe(id)
    expect(library[0].typography).toEqual({
      codeFontFamily: DEFAULT_CODE_FONT_FAMILY,
      fontSize: 14,
      lineHeight: 1.4
    })
  })

  it('caps the library size', () => {
    const one = { ...validContent(), id: createUserSkinId(), builtin: false, name: 'a' }
    const library = parseSkinLibrary(Array.from({ length: MAX_USER_SKINS + 5 }, () => ({
      ...one,
      id: createUserSkinId()
    })))
    expect(library).toHaveLength(MAX_USER_SKINS)
  })

  it('isBuiltinSkinId distinguishes namespaces', () => {
    expect(isBuiltinSkinId(BUILTIN_SKIN_LIGHT_ID)).toBe(true)
    expect(isBuiltinSkinId(createUserSkinId())).toBe(false)
  })
})

describe('import / export', () => {
  it('round-trips a skin through export and import', () => {
    const content = validContent()
    const exported = serializeSkinForExport('Exported', content)
    expect(exported.version).toBe(2)
    const raw = JSON.stringify(exported)
    const parsed = parseImportedSkin(raw)
    expect(parsed?.name).toBe('Exported')
    expect(parsed?.content.colors.primary).toBe(content.colors.primary)
  })

  it('imports v1 themes without reusing their former UI font', () => {
    const content = validContent()
    const parsed = parseImportedSkin(JSON.stringify({
      format: 'cliloom-skin',
      version: 1,
      name: 'Legacy',
      content: {
        ...content,
        typography: { fontFamily: 'Inter Variable', fontSize: 14, lineHeight: 1.4 }
      }
    }))

    expect(parsed?.content.typography).toEqual({
      codeFontFamily: DEFAULT_CODE_FONT_FAMILY,
      fontSize: 14,
      lineHeight: 1.4
    })
  })

  it('rejects oversized payloads', () => {
    expect(MAX_IMPORT_BYTES).toBeGreaterThan(0)
    expect(parseImportedSkin('not json')).toBeNull()
    expect(parseImportedSkin(JSON.stringify({ format: 'other', version: 1 }))).toBeNull()
    expect(parseImportedSkin(JSON.stringify({ format: 'cliloom-skin', version: 3 }))).toBeNull()
  })

  it('validates skin names', () => {
    expect(isValidSkinName('ok')).toBe(true)
    expect(isValidSkinName('   ')).toBe(false)
    expect(isValidSkinName('x'.repeat(41))).toBe(false)
  })
})
