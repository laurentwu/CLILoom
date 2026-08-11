import {
  DEFAULT_CODE_FONT_FAMILY,
  isValidCodeFontFamily
} from '../shared/skin'

export const CODE_FONT_CHANGE_EVENT = 'cliloom:code-font-change'
export const BUNDLED_CODE_FONT_FAMILY = 'JetBrains Mono Variable'
export const SYSTEM_CODE_FONT_FAMILY = 'ui-monospace'

const SYSTEM_MONOSPACE_FALLBACKS = [
  SYSTEM_CODE_FONT_FAMILY,
  'SFMono-Regular',
  'Menlo',
  'Monaco',
  'Cascadia Mono',
  'Consolas',
  'Liberation Mono',
  'DejaVu Sans Mono',
  'monospace'
] as const

const CSS_GENERIC_FONT_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'cursive',
  'fantasy',
  'monospace',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong'
])

let bundledCodeFontPromise: Promise<void> | undefined

export function isCssGenericFontFamily(fontFamily: string): boolean {
  return CSS_GENERIC_FONT_FAMILIES.has(fontFamily.trim().toLowerCase())
}

function escapeCssString(value: string): string {
  return value.replace(/['\\]/g, '\\$&')
}

function formatFontFamily(fontFamily: string): string {
  return isCssGenericFontFamily(fontFamily)
    ? fontFamily
    : `'${escapeCssString(fontFamily)}'`
}

export function buildCodeFontStack(preferredFontFamily: unknown): string {
  const preferred = isValidCodeFontFamily(preferredFontFamily)
    ? preferredFontFamily.trim()
    : DEFAULT_CODE_FONT_FAMILY
  const preferredFamilies = preferred.toLowerCase() === DEFAULT_CODE_FONT_FAMILY.toLowerCase()
    ? []
    : [preferred]
  const families = [
    ...preferredFamilies,
    BUNDLED_CODE_FONT_FAMILY,
    ...SYSTEM_MONOSPACE_FALLBACKS
  ]
  const seen = new Set<string>()

  return families
    .filter((fontFamily) => {
      const key = fontFamily.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map(formatFontFamily)
    .join(', ')
}

export function getAppliedCodeFontStack(): string {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') {
    return buildCodeFontStack(DEFAULT_CODE_FONT_FAMILY)
  }
  return getComputedStyle(document.documentElement).getPropertyValue('--font-code').trim()
    || buildCodeFontStack(DEFAULT_CODE_FONT_FAMILY)
}

export function preloadBundledCodeFont(): Promise<void> {
  if (bundledCodeFontPromise) return bundledCodeFontPromise
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve()

  bundledCodeFontPromise = document.fonts
    .load(`13px '${BUNDLED_CODE_FONT_FAMILY}'`)
    .then(() => undefined)
    .catch(() => undefined)
  return bundledCodeFontPromise
}
