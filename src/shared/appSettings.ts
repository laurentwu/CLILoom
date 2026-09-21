import {
  DEFAULT_SHELL_PREFERENCES,
  parseShellPreferences,
  type ShellPreferences
} from './shell'
import {
  DEFAULT_ACTIVE_SKIN_ID,
  getBuiltinSkin,
  parseSkinLibrary,
  type Skin,
  type UserSkin
} from './skin'

export { DEFAULT_ACTIVE_SKIN_ID, createUserSkinId } from './skin'
export type { Skin, UserSkin, SkinContent, BuiltinSkin } from './skin'

export const SUPPORTED_LANGUAGES = ['en', 'zh'] as const

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === 'string' && SUPPORTED_LANGUAGES.some((language) => language === value)
}

export const ASSISTANT_CONFIG_SETTING_KEY = 'assistant_config'
export const APPEARANCE_PREFERENCES_SETTING_KEY = 'appearance_preferences'
export const SKIN_LIBRARY_SETTING_KEY = 'skin_library'
export const LAYOUT_PREFERENCES_SETTING_KEY = 'layout_preferences'
export const MAIN_WINDOW_STATE_SETTING_KEY = 'main_window_state'
export const ASSISTANT_WINDOW_STATE_SETTING_KEY = 'assistant_window_state'
export const SHELL_PREFERENCES_SETTING_KEY = 'shell_preferences'

export type AssistantConfig = {
  version: 1
  initializationCommand: string
}

export type AppearancePreferences = {
  version: 2
  activeSkinId: string
  language: SupportedLanguage
}

export type LayoutPreferences = {
  version: 1
  projectRailWidth: number
  taskSidebarWidth: number
}

export type WindowBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type MainWindowState = {
  version: 1
  bounds: WindowBounds
  maximized?: boolean
}

export type AssistantWindowState = {
  version: 1
  bounds: WindowBounds
}

export type AppSettingsSnapshot = {
  assistant: AssistantConfig
  appearance: AppearancePreferences
  layout: LayoutPreferences
  shell: ShellPreferences
  skins: UserSkin[]
  activeSkin: Skin
}

export const DEFAULT_ASSISTANT_CONFIG: AssistantConfig = {
  version: 1,
  initializationCommand: ''
}

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  version: 2,
  activeSkinId: DEFAULT_ACTIVE_SKIN_ID,
  language: 'en'
}

export const LAYOUT_BOUNDS = {
  projectRailWidthMin: 52,
  projectRailWidthMax: 220,
  projectRailWidthDefault: 64,
  taskSidebarWidthMin: 140,
  taskSidebarWidthMax: 380,
  taskSidebarWidthDefault: 168
} as const

export type PublicLayoutWidthKey = 'layout.projectRailWidth' | 'layout.taskSidebarWidth'

export const PUBLIC_LAYOUT_WIDTH_KEYS: readonly PublicLayoutWidthKey[] = [
  'layout.projectRailWidth',
  'layout.taskSidebarWidth'
]

export function layoutWidthBounds(key: PublicLayoutWidthKey): {
  minimum: number
  maximum: number
  fallback: number
} {
  return key === 'layout.projectRailWidth'
    ? {
        minimum: LAYOUT_BOUNDS.projectRailWidthMin,
        maximum: LAYOUT_BOUNDS.projectRailWidthMax,
        fallback: LAYOUT_BOUNDS.projectRailWidthDefault
      }
    : {
        minimum: LAYOUT_BOUNDS.taskSidebarWidthMin,
        maximum: LAYOUT_BOUNDS.taskSidebarWidthMax,
        fallback: LAYOUT_BOUNDS.taskSidebarWidthDefault
      }
}

/**
 * Parse an assistant-provided layout width. Accepts only finite decimal
 * integers within the persisted layout bounds: no signs, units, decimals,
 * exponents, hexadecimal, or clamping. Returns null for invalid input.
 */
export function parsePublicLayoutWidth(key: PublicLayoutWidthKey, value: string): number | null {
  const { minimum, maximum } = layoutWidthBounds(key)
  if (!/^[0-9]+$/.test(value.trim())) return null
  const parsed = Number(value.trim())
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) return null
  return parsed
}

export const DEFAULT_LAYOUT_PREFERENCES: LayoutPreferences = {
  version: 1,
  projectRailWidth: LAYOUT_BOUNDS.projectRailWidthDefault,
  taskSidebarWidth: LAYOUT_BOUNDS.taskSidebarWidthDefault
}

export { DEFAULT_SHELL_PREFERENCES, parseShellPreferences }
export type { ShellPreferences }

export const PUBLIC_SETTING_KEYS = [
  'appearance.skin',
  'appearance.language',
  'layout.projectRailWidth',
  'layout.taskSidebarWidth',
  'assistant.initializationCommand'
] as const

export type PublicSettingKey = (typeof PUBLIC_SETTING_KEYS)[number]

export type PublicSettingDefinition = {
  description: string
  allowedValues?: readonly string[]
  valueType?: 'string' | 'integer'
  minimum?: number
  maximum?: number
  appliesTo?: string
}

export const PUBLIC_SETTING_DEFINITIONS: Record<PublicSettingKey, PublicSettingDefinition> = {
  'appearance.skin': {
    description: 'Active skin id (builtin preset or a saved user skin)',
    appliesTo: 'settings'
  },
  'appearance.language': {
    description: 'Interface language of the application',
    allowedValues: SUPPORTED_LANGUAGES,
    appliesTo: 'settings'
  },
  'layout.projectRailWidth': {
    description: 'Width in pixels of the project rail column in the main window',
    valueType: 'integer',
    minimum: LAYOUT_BOUNDS.projectRailWidthMin,
    maximum: LAYOUT_BOUNDS.projectRailWidthMax,
    appliesTo: 'immediate'
  },
  'layout.taskSidebarWidth': {
    description: 'Width in pixels of the task sidebar column in the main window',
    valueType: 'integer',
    minimum: LAYOUT_BOUNDS.taskSidebarWidthMin,
    maximum: LAYOUT_BOUNDS.taskSidebarWidthMax,
    appliesTo: 'immediate'
  },
  'assistant.initializationCommand': {
    description: 'CLI command (with optional arguments) executed after the assistant terminal starts',
    appliesTo: 'next-assistant-session'
  }
}

export function resolveLanguageFromLocale(locale: string): SupportedLanguage {
  return locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function parseAppearancePreferences(
  value: unknown,
  fallbackLanguage: SupportedLanguage = 'en'
): AppearancePreferences {
  const language = isRecord(value) && isSupportedLanguage(value.language) ? value.language : fallbackLanguage
  if (!isRecord(value) || value.version !== 2 || typeof value.activeSkinId !== 'string') {
    return { version: 2, activeSkinId: DEFAULT_ACTIVE_SKIN_ID, language }
  }
  return { version: 2, activeSkinId: value.activeSkinId, language }
}

export function parseAssistantConfig(value: unknown): AssistantConfig {
  if (!isRecord(value) || value.version !== 1 || typeof value.initializationCommand !== 'string') {
    return { ...DEFAULT_ASSISTANT_CONFIG }
  }
  return {
    version: 1,
    initializationCommand: value.initializationCommand.trim()
  }
}

export function parseSkinLibrarySetting(value: unknown): UserSkin[] {
  return parseSkinLibrary(value)
}

export function isPublicSkinId(id: string, userSkins: UserSkin[]): boolean {
  if (getBuiltinSkin(id)) return true
  return userSkins.some((skin) => skin.id === id)
}

export function resolveActiveSkin(activeSkinId: string, userSkins: UserSkin[]): Skin {
  const builtin = getBuiltinSkin(activeSkinId)
  if (builtin) return builtin
  const user = userSkins.find((skin) => skin.id === activeSkinId)
  if (user) return user
  return getBuiltinSkin(DEFAULT_ACTIVE_SKIN_ID)!
}

export function parseLayoutPreferences(value: unknown): LayoutPreferences {
  if (!isRecord(value) || value.version !== 1) return { ...DEFAULT_LAYOUT_PREFERENCES }
  return {
    version: 1,
    projectRailWidth: clampNumber(
      value.projectRailWidth,
      LAYOUT_BOUNDS.projectRailWidthMin,
      LAYOUT_BOUNDS.projectRailWidthMax,
      LAYOUT_BOUNDS.projectRailWidthDefault
    ),
    taskSidebarWidth: clampNumber(
      value.taskSidebarWidth,
      LAYOUT_BOUNDS.taskSidebarWidthMin,
      LAYOUT_BOUNDS.taskSidebarWidthMax,
      LAYOUT_BOUNDS.taskSidebarWidthDefault
    )
  }
}

export function parseWindowBounds(value: unknown): WindowBounds | null {
  if (!isRecord(value)) return null
  const values = [value.x, value.y, value.width, value.height]
  if (!values.every((item) => typeof item === 'number' && Number.isFinite(item))) return null
  if ((value.width as number) < 320 || (value.height as number) < 240) return null
  return {
    x: Math.round(value.x as number),
    y: Math.round(value.y as number),
    width: Math.round(value.width as number),
    height: Math.round(value.height as number)
  }
}

export function parseMainWindowState(value: unknown): MainWindowState | null {
  if (!isRecord(value) || value.version !== 1) return null
  const bounds = parseWindowBounds(value.bounds)
  if (!bounds) return null
  return {
    version: 1,
    bounds,
    maximized: value.maximized === true
  }
}

export function parseAssistantWindowState(value: unknown): AssistantWindowState | null {
  if (!isRecord(value) || value.version !== 1) return null
  const bounds = parseWindowBounds(value.bounds)
  return bounds ? { version: 1, bounds } : null
}

export function isPublicSettingKey(value: unknown): value is PublicSettingKey {
  return typeof value === 'string' && PUBLIC_SETTING_KEYS.some((key) => key === value)
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
