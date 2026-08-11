export type SkinMode = 'light' | 'dark'

export type SkinColorTokens = {
  background: string
  foreground: string
  card: string
  cardForeground: string
  popover: string
  popoverForeground: string
  primary: string
  primaryForeground: string
  secondary: string
  secondaryForeground: string
  muted: string
  mutedForeground: string
  accent: string
  accentForeground: string
  destructive: string
  border: string
  input: string
  ring: string
  chart1: string
  chart2: string
  chart3: string
  chart4: string
  chart5: string
  sidebar: string
  sidebarForeground: string
  sidebarPrimary: string
  sidebarPrimaryForeground: string
  sidebarAccent: string
  sidebarAccentForeground: string
  sidebarBorder: string
  sidebarRing: string
}

export const SKIN_COLOR_TOKEN_KEYS = [
  'background',
  'foreground',
  'card',
  'cardForeground',
  'popover',
  'popoverForeground',
  'primary',
  'primaryForeground',
  'secondary',
  'secondaryForeground',
  'muted',
  'mutedForeground',
  'accent',
  'accentForeground',
  'destructive',
  'border',
  'input',
  'ring',
  'chart1',
  'chart2',
  'chart3',
  'chart4',
  'chart5',
  'sidebar',
  'sidebarForeground',
  'sidebarPrimary',
  'sidebarPrimaryForeground',
  'sidebarAccent',
  'sidebarAccentForeground',
  'sidebarBorder',
  'sidebarRing'
] as const

export type SkinTypography = {
  codeFontFamily: string
  fontSize: number
  lineHeight: number
}

export type SkinBackground =
  | { kind: 'solid'; color: string }
  | { kind: 'gradient'; stops: string[]; angle: number }

export type SkinContent = {
  mode: SkinMode
  colors: SkinColorTokens
  typography: SkinTypography
  radius: number
  background: SkinBackground
  spacingScale: number
}

export type BuiltinSkin = SkinContent & {
  id: string
  builtin: true
  nameKey: string
}

export type UserSkin = SkinContent & {
  id: string
  builtin: false
  name: string
}

export type Skin = BuiltinSkin | UserSkin

export type SkinExport = {
  format: 'cliloom-skin'
  version: 2
  name: string
  content: SkinContent
}

export const BUILTIN_PREFIX = 'builtin.'
export const USER_PREFIX = 'user.'
export const MAX_USER_SKINS = 50
export const MAX_IMPORT_BYTES = 256 * 1024
export const SKIN_BOUNDS = {
  fontSizeMin: 8,
  fontSizeMax: 32,
  lineHeightMin: 1,
  lineHeightMax: 2.5,
  radiusMin: 0,
  radiusMax: 2,
  angleMin: 0,
  angleMax: 360,
  spacingMin: 0.5,
  spacingMax: 2,
  gradientStopsMin: 2,
  gradientStopsMax: 8,
  nameMin: 1,
  nameMax: 40,
  codeFontFamilyMax: 256,
  colorMax: 80
} as const

export const DEFAULT_CODE_FONT_FAMILY = 'JetBrains Mono'

const FORBIDDEN_CSS_CHARS = /[;"'<>`]|url\(/i
const CODE_FONT_FAMILY_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u

export function isBuiltinSkinId(id: unknown): id is string {
  return typeof id === 'string' && id.startsWith(BUILTIN_PREFIX)
}

export function isUserSkinId(id: unknown): id is string {
  return typeof id === 'string' && id.startsWith(USER_PREFIX)
}

export function isValidColor(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > SKIN_BOUNDS.colorMax) return false
  if (FORBIDDEN_CSS_CHARS.test(value)) return false
  const trimmed = value.trim()
  if (trimmed.startsWith('#')) {
    return /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)
  }
  const match = trimmed.match(/^(rgba?|hsla?|oklch|oklab|color)\((.*)\)$/i)
  if (!match) return false
  const body = match[2].trim()
  // Reject empty bodies (e.g. `oklch()`) and bodies without any numeric/percent
  // payload (e.g. `rgb(foo)`). `none` is a valid CSS color component.
  if (body.length === 0) return false
  if (!/[0-9%]/.test(body) && !/\bnone\b/i.test(body)) return false
  return true
}

export function isValidCodeFontFamily(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > SKIN_BOUNDS.codeFontFamilyMax) return false
  return !CODE_FONT_FAMILY_CONTROL_CHARACTERS.test(trimmed)
}

export function isValidSkinName(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return trimmed.length >= SKIN_BOUNDS.nameMin && trimmed.length <= SKIN_BOUNDS.nameMax
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function parseColors(value: unknown): SkinColorTokens | null {
  if (!isRecord(value)) return null
  const result = {} as Partial<SkinColorTokens>
  for (const key of SKIN_COLOR_TOKEN_KEYS) {
    const raw = (value as Record<string, unknown>)[key]
    if (!isValidColor(raw)) return null
    result[key] = raw
  }
  return result as SkinColorTokens
}

function parseBackground(value: unknown): SkinBackground | null {
  if (!isRecord(value)) return null
  if (value.kind === 'solid') {
    if (!isValidColor(value.color)) return null
    return { kind: 'solid', color: value.color }
  }
  if (value.kind === 'gradient') {
    const stops = value.stops
    if (!Array.isArray(stops)) return null
    if (stops.length < SKIN_BOUNDS.gradientStopsMin || stops.length > SKIN_BOUNDS.gradientStopsMax) return null
    if (!stops.every((stop) => isValidColor(stop))) return null
    const angle = clampNumber(value.angle, SKIN_BOUNDS.angleMin, SKIN_BOUNDS.angleMax, 180)
    return { kind: 'gradient', stops: stops as string[], angle }
  }
  return null
}

export function parseSkinContent(value: unknown): SkinContent | null {
  if (!isRecord(value)) return null
  if (value.mode !== 'light' && value.mode !== 'dark') return null
  const colors = parseColors(value.colors)
  if (!colors) return null
  if (!isRecord(value.typography)) return null
  const rawCodeFontFamily = value.typography.codeFontFamily
  if (rawCodeFontFamily !== undefined && !isValidCodeFontFamily(rawCodeFontFamily)) return null
  const typography: SkinTypography = {
    // Themes saved before v2 used `fontFamily` to customize the entire UI.
    // UI typography now follows the operating system, so that legacy value is
    // deliberately ignored instead of becoming a terminal font by accident.
    codeFontFamily: typeof rawCodeFontFamily === 'string'
      ? rawCodeFontFamily.trim()
      : DEFAULT_CODE_FONT_FAMILY,
    fontSize: clampNumber(
      value.typography.fontSize,
      SKIN_BOUNDS.fontSizeMin,
      SKIN_BOUNDS.fontSizeMax,
      16
    ),
    lineHeight: clampNumber(
      value.typography.lineHeight,
      SKIN_BOUNDS.lineHeightMin,
      SKIN_BOUNDS.lineHeightMax,
      1.5
    )
  }
  const background = parseBackground(value.background)
  if (!background) return null
  return {
    mode: value.mode,
    colors,
    typography,
    radius: clampNumber(value.radius, SKIN_BOUNDS.radiusMin, SKIN_BOUNDS.radiusMax, 0.625),
    background,
    spacingScale: clampNumber(
      value.spacingScale,
      SKIN_BOUNDS.spacingMin,
      SKIN_BOUNDS.spacingMax,
      1
    )
  }
}

export function parseUserSkin(value: unknown): UserSkin | null {
  if (!isRecord(value)) return null
  if (value.builtin !== false) return null
  if (!isUserSkinId(value.id)) return null
  if (!isValidSkinName(value.name)) return null
  const content = parseSkinContent(value)
  if (!content) return null
  return { ...content, id: value.id, builtin: false, name: (value.name as string).trim() }
}

export function parseSkinLibrary(value: unknown): UserSkin[] {
  if (!Array.isArray(value)) return []
  const skins: UserSkin[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const skin = parseUserSkin(entry)
    if (!skin || seen.has(skin.id)) continue
    seen.add(skin.id)
    skins.push(skin)
    if (skins.length >= MAX_USER_SKINS) break
  }
  return skins
}

export function createUserSkinId(): string {
  const stamp = Date.now().toString(36)
  const nonce = Math.random().toString(36).slice(2, 10)
  return `${USER_PREFIX}${stamp}-${nonce}`
}

export function serializeSkinForExport(name: string, content: SkinContent): SkinExport {
  return { format: 'cliloom-skin', version: 2, name: name.trim().slice(0, SKIN_BOUNDS.nameMax), content }
}

export function parseImportedSkin(raw: string): { name: string; content: SkinContent } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  if (parsed.format !== 'cliloom-skin' || (parsed.version !== 1 && parsed.version !== 2)) return null
  if (!isValidSkinName(parsed.name)) return null
  const content = parseSkinContent(parsed.content)
  if (!content) return null
  return { name: (parsed.name as string).trim(), content }
}

function lightColors(): SkinColorTokens {
  return {
    background: 'oklch(1 0 0)',
    foreground: 'oklch(0.145 0 0)',
    card: 'oklch(1 0 0)',
    cardForeground: 'oklch(0.145 0 0)',
    popover: 'oklch(1 0 0)',
    popoverForeground: 'oklch(0.145 0 0)',
    primary: 'oklch(0.205 0 0)',
    primaryForeground: 'oklch(0.985 0 0)',
    secondary: 'oklch(0.97 0 0)',
    secondaryForeground: 'oklch(0.205 0 0)',
    muted: 'oklch(0.97 0 0)',
    mutedForeground: 'oklch(0.556 0 0)',
    accent: 'oklch(0.97 0 0)',
    accentForeground: 'oklch(0.205 0 0)',
    destructive: 'oklch(0.577 0.245 27.325)',
    border: 'oklch(0.922 0 0)',
    input: 'oklch(0.922 0 0)',
    ring: 'oklch(0.708 0 0)',
    chart1: 'oklch(0.87 0 0)',
    chart2: 'oklch(0.556 0 0)',
    chart3: 'oklch(0.439 0 0)',
    chart4: 'oklch(0.371 0 0)',
    chart5: 'oklch(0.269 0 0)',
    sidebar: 'oklch(0.985 0 0)',
    sidebarForeground: 'oklch(0.145 0 0)',
    sidebarPrimary: 'oklch(0.205 0 0)',
    sidebarPrimaryForeground: 'oklch(0.985 0 0)',
    sidebarAccent: 'oklch(0.97 0 0)',
    sidebarAccentForeground: 'oklch(0.205 0 0)',
    sidebarBorder: 'oklch(0.922 0 0)',
    sidebarRing: 'oklch(0.708 0 0)'
  }
}

function darkColors(): SkinColorTokens {
  return {
    background: 'oklch(0.145 0 0)',
    foreground: 'oklch(0.985 0 0)',
    card: 'oklch(0.205 0 0)',
    cardForeground: 'oklch(0.985 0 0)',
    popover: 'oklch(0.205 0 0)',
    popoverForeground: 'oklch(0.985 0 0)',
    primary: 'oklch(0.922 0 0)',
    primaryForeground: 'oklch(0.205 0 0)',
    secondary: 'oklch(0.269 0 0)',
    secondaryForeground: 'oklch(0.985 0 0)',
    muted: 'oklch(0.269 0 0)',
    mutedForeground: 'oklch(0.708 0 0)',
    accent: 'oklch(0.269 0 0)',
    accentForeground: 'oklch(0.985 0 0)',
    destructive: 'oklch(0.704 0.191 22.216)',
    border: 'oklch(1 0 0 / 10%)',
    input: 'oklch(1 0 0 / 15%)',
    ring: 'oklch(0.556 0 0)',
    chart1: 'oklch(0.87 0 0)',
    chart2: 'oklch(0.556 0 0)',
    chart3: 'oklch(0.439 0 0)',
    chart4: 'oklch(0.371 0 0)',
    chart5: 'oklch(0.269 0 0)',
    sidebar: 'oklch(0.205 0 0)',
    sidebarForeground: 'oklch(0.985 0 0)',
    sidebarPrimary: 'oklch(0.488 0.243 264.376)',
    sidebarPrimaryForeground: 'oklch(0.985 0 0)',
    sidebarAccent: 'oklch(0.269 0 0)',
    sidebarAccentForeground: 'oklch(0.985 0 0)',
    sidebarBorder: 'oklch(1 0 0 / 10%)',
    sidebarRing: 'oklch(0.556 0 0)'
  }
}

export function defaultSkinContent(mode: SkinMode): SkinContent {
  const colors = mode === 'dark' ? darkColors() : lightColors()
  return {
    mode,
    colors,
    typography: { codeFontFamily: DEFAULT_CODE_FONT_FAMILY, fontSize: 16, lineHeight: 1.5 },
    radius: 0.625,
    background: { kind: 'solid', color: colors.background },
    spacingScale: 1
  }
}

export const BUILTIN_SKIN_LIGHT_ID = 'builtin.light.neutral'
export const BUILTIN_SKIN_DARK_ID = 'builtin.dark.neutral'
export const DEFAULT_ACTIVE_SKIN_ID = BUILTIN_SKIN_LIGHT_ID

export const BUILTIN_SKINS: BuiltinSkin[] = [
  {
    id: BUILTIN_SKIN_LIGHT_ID,
    builtin: true,
    nameKey: 'skin:builtin.light.neutral',
    ...defaultSkinContent('light')
  },
  {
    id: BUILTIN_SKIN_DARK_ID,
    builtin: true,
    nameKey: 'skin:builtin.dark.neutral',
    ...defaultSkinContent('dark')
  }
]

export function getBuiltinSkin(id: string): BuiltinSkin | undefined {
  return BUILTIN_SKINS.find((skin) => skin.id === id)
}

export function builtinSkinIds(): string[] {
  return BUILTIN_SKINS.map((skin) => skin.id)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
