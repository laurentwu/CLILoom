import { getFonts } from 'font-list'
import { isValidCodeFontFamily } from '../shared/skin'

export type FontFamilyEnumerator = () => Promise<unknown>

function compareFontFamilies(left: string, right: string): number {
  const leftKey = left.toLocaleLowerCase()
  const rightKey = right.toLocaleLowerCase()
  if (leftKey < rightKey) return -1
  if (leftKey > rightKey) return 1
  return left < right ? -1 : left > right ? 1 : 0
}

export function normalizeInstalledFontFamilies(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const families = new Map<string, string>()

  for (const entry of value) {
    if (!isValidCodeFontFamily(entry)) continue
    const fontFamily = entry.trim()
    const key = fontFamily.toLocaleLowerCase()
    if (!families.has(key)) families.set(key, fontFamily)
  }

  return [...families.values()].sort(compareFontFamilies)
}

async function enumerateInstalledFontFamilies(): Promise<string[]> {
  return getFonts({ disableQuoting: true })
}

function requireInstalledFontFamilies(value: unknown): string[] {
  const fontFamilies = normalizeInstalledFontFamilies(value)
  if (fontFamilies.length === 0) {
    throw new Error('No installed font families were found')
  }
  return fontFamilies
}

export class InstalledFontService {
  private request: Promise<string[]> | null = null

  constructor(
    private readonly enumerate: FontFamilyEnumerator = enumerateInstalledFontFamilies
  ) {}

  list(): Promise<string[]> {
    if (this.request) return this.request
    const request = this.enumerate().then(requireInstalledFontFamilies)
    this.request = request
    void request.catch(() => {
      if (this.request === request) this.request = null
    })
    return request
  }
}
