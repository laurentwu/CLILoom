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

export const DEFAULT_LAYOUT_PREFERENCES: LayoutPreferences = {
  version: 1,
  projectRailWidth: 64,
  taskSidebarWidth: 168
}

export { DEFAULT_SHELL_PREFERENCES, parseShellPreferences }
export type { ShellPreferences }

export const PUBLIC_SETTING_KEYS = [
  'appearance.skin',
  'appearance.language',
  'assistant.initializationCommand'
] as const

export type PublicSettingKey = (typeof PUBLIC_SETTING_KEYS)[number]

export const PUBLIC_SETTING_DEFINITIONS: Record<
  PublicSettingKey,
  { description: string; allowedValues?: readonly string[] }
> = {
  'appearance.skin': {
    description: 'Active skin id (builtin preset or a saved user skin)'
  },
  'appearance.language': {
    description: 'Interface language of the application',
    allowedValues: SUPPORTED_LANGUAGES
  },
  'assistant.initializationCommand': {
    description: 'CLI command (with optional arguments) executed after the assistant terminal starts'
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
    projectRailWidth: clampNumber(value.projectRailWidth, 52, 220, 64),
    taskSidebarWidth: clampNumber(value.taskSidebarWidth, 140, 380, 168)
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
