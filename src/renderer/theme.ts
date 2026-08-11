import {
  BUILTIN_SKINS,
  BUILTIN_SKIN_LIGHT_ID,
  type Skin,
  type SkinBackground,
  type SkinColorTokens
} from '../shared/skin'
import type { TranslationKey } from '../shared/i18n/types'
import { buildCodeFontStack, CODE_FONT_CHANGE_EVENT } from './fonts'

export type { Skin } from '../shared/skin'

const COLOR_TOKEN_TO_CSS_VAR: Record<keyof SkinColorTokens, string> = {
  background: '--background',
  foreground: '--foreground',
  card: '--card',
  cardForeground: '--card-foreground',
  popover: '--popover',
  popoverForeground: '--popover-foreground',
  primary: '--primary',
  primaryForeground: '--primary-foreground',
  secondary: '--secondary',
  secondaryForeground: '--secondary-foreground',
  muted: '--muted',
  mutedForeground: '--muted-foreground',
  accent: '--accent',
  accentForeground: '--accent-foreground',
  destructive: '--destructive',
  border: '--border',
  input: '--input',
  ring: '--ring',
  chart1: '--chart-1',
  chart2: '--chart-2',
  chart3: '--chart-3',
  chart4: '--chart-4',
  chart5: '--chart-5',
  sidebar: '--sidebar',
  sidebarForeground: '--sidebar-foreground',
  sidebarPrimary: '--sidebar-primary',
  sidebarPrimaryForeground: '--sidebar-primary-foreground',
  sidebarAccent: '--sidebar-accent',
  sidebarAccentForeground: '--sidebar-accent-foreground',
  sidebarBorder: '--sidebar-border',
  sidebarRing: '--sidebar-ring'
}

export type SkinGroup = 'light' | 'dark'

export type BuiltinSkinOption = {
  id: string
  mode: SkinGroup
  nameKey: TranslationKey
  background: string
}

export const BUILTIN_SKIN_OPTIONS: BuiltinSkinOption[] = BUILTIN_SKINS.map((skin) => ({
  id: skin.id,
  mode: skin.mode,
  nameKey: skin.nameKey as TranslationKey,
  background: backgroundToCss(skin.background)
}))

export const DEFAULT_SKIN: Skin = BUILTIN_SKINS.find((skin) => skin.id === BUILTIN_SKIN_LIGHT_ID)!

export function backgroundToCss(background: SkinBackground): string {
  if (background.kind === 'solid') return background.color
  return `linear-gradient(${background.angle}deg, ${background.stops.join(', ')})`
}

function setSkinTokens(skin: Skin): void {
  const root = document.documentElement

  if (skin.mode === 'dark') {
    root.classList.add('dark')
    root.style.colorScheme = 'dark'
  } else {
    root.classList.remove('dark')
    root.style.colorScheme = 'light'
  }

  root.dataset.skinId = skin.id

  for (const key of Object.keys(COLOR_TOKEN_TO_CSS_VAR) as Array<keyof SkinColorTokens>) {
    root.style.setProperty(COLOR_TOKEN_TO_CSS_VAR[key], skin.colors[key])
  }

  root.style.setProperty('--radius', `${skin.radius}rem`)
  const codeFontStack = buildCodeFontStack(skin.typography.codeFontFamily)
  const codeFontChanged = root.style.getPropertyValue('--font-code') !== codeFontStack
  root.style.setProperty('--font-code', codeFontStack)
  root.style.setProperty('--font-size-base', `${skin.typography.fontSize}px`)
  root.style.setProperty('--font-line-height', String(skin.typography.lineHeight))
  root.style.setProperty('--spacing-scale', String(skin.spacingScale))
  root.style.setProperty('--app-background', backgroundToCss(skin.background))
  if (codeFontChanged) root.dispatchEvent(new CustomEvent(CODE_FONT_CHANGE_EVENT))
}

export function applySkin(skin: Skin): void {
  setSkinTokens(skin)
  activeSkin = skin
}

let activeSkin: Skin = DEFAULT_SKIN

export function getActiveSkin(): Skin {
  return activeSkin
}

export function initializeSkin(skin: Skin = DEFAULT_SKIN): Skin {
  activeSkin = skin
  setSkinTokens(skin)
  return skin
}

export async function loadInitialSkin(
  readSkin: (() => Promise<Skin>) | undefined
): Promise<Skin> {
  if (!readSkin) return DEFAULT_SKIN
  try {
    const skin = await readSkin()
    return skin && typeof skin === 'object' ? normalizeSkin(skin) : DEFAULT_SKIN
  } catch {
    return DEFAULT_SKIN
  }
}

// Defensive runtime normalization: builtin ids always map to the trusted builtin
// definition so the renderer never honors a forged builtin payload over IPC.
// User skins are produced by our own main process and trusted as-is.
function normalizeSkin(skin: Skin): Skin {
  if (skin.builtin) {
    const trusted = BUILTIN_SKINS.find((entry) => entry.id === skin.id)
    if (trusted) return trusted
  }
  return skin
}
