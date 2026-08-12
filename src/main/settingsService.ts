import {
  APPEARANCE_PREFERENCES_SETTING_KEY,
  ASSISTANT_CONFIG_SETTING_KEY,
  ASSISTANT_WINDOW_STATE_SETTING_KEY,
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_ASSISTANT_CONFIG,
  DEFAULT_LAYOUT_PREFERENCES,
  DEFAULT_SHELL_PREFERENCES,
  LAYOUT_PREFERENCES_SETTING_KEY,
  MAIN_WINDOW_STATE_SETTING_KEY,
  SKIN_LIBRARY_SETTING_KEY,
  SHELL_PREFERENCES_SETTING_KEY,
  createUserSkinId,
  isPublicSkinId,
  isPublicSettingKey,
  isSupportedLanguage,
  parseAppearancePreferences,
  parseAssistantConfig,
  parseAssistantWindowState,
  parseLayoutPreferences,
  parseMainWindowState,
  parseShellPreferences,
  parseSkinLibrarySetting,
  resolveActiveSkin,
  resolveLanguageFromLocale,
  DEFAULT_ACTIVE_SKIN_ID,
  type AppSettingsSnapshot,
  type AppearancePreferences,
  type AssistantConfig,
  type AssistantWindowState,
  type LayoutPreferences,
  type MainWindowState,
  type PublicSettingKey,
  type ShellPreferences,
  type SupportedLanguage,
  type Skin,
  type SkinContent,
  type UserSkin
} from '../shared/appSettings'
import {
  MAX_IMPORT_BYTES,
  MAX_USER_SKINS,
  SKIN_BOUNDS,
  builtinSkinIds,
  getBuiltinSkin,
  isValidSkinName,
  parseImportedSkin,
  parseSkinContent,
  serializeSkinForExport
} from '../shared/skin'
import type { ResolvedAssistantCommand } from '../shared/assistant'
import { resolveAssistantCommand } from './assistantCommand'
import { t } from './i18n'
import {
  getSetting,
  setSetting,
  type AppDatabase
} from './database'

export type SettingsChangedListener = (snapshot: AppSettingsSnapshot) => void

export class SettingsService {
  private readonly listeners = new Set<SettingsChangedListener>()
  private environment: NodeJS.ProcessEnv

  constructor(
    private readonly db: AppDatabase,
    environment: NodeJS.ProcessEnv = process.env
  ) {
    this.environment = environment
    this.migrateShellPreferences()
  }

  getSnapshot(): AppSettingsSnapshot {
    const skins = this.getSkinLibrary()
    const appearance = this.getAppearance()
    return {
      assistant: parseAssistantConfig(
        getSetting(this.db, ASSISTANT_CONFIG_SETTING_KEY, DEFAULT_ASSISTANT_CONFIG)
      ),
      appearance,
      layout: parseLayoutPreferences(
        getSetting(this.db, LAYOUT_PREFERENCES_SETTING_KEY, DEFAULT_LAYOUT_PREFERENCES)
      ),
      shell: parseShellPreferences(
        getSetting(this.db, SHELL_PREFERENCES_SETTING_KEY, DEFAULT_SHELL_PREFERENCES)
      ),
      skins,
      activeSkin: resolveActiveSkin(appearance.activeSkinId, skins)
    }
  }

  setEnvironment(environment: NodeJS.ProcessEnv): void {
    this.environment = environment
  }

  setShellPreferences(value: ShellPreferences): ShellPreferences {
    const parsed = parseShellPreferences(value)
    setSetting(this.db, SHELL_PREFERENCES_SETTING_KEY, parsed)
    this.notify()
    return parsed
  }

  private migrateShellPreferences(): void {
    const stored = getSetting<unknown>(
      this.db,
      SHELL_PREFERENCES_SETTING_KEY,
      DEFAULT_SHELL_PREFERENCES
    )
    const parsed = parseShellPreferences(stored)
    if (JSON.stringify(stored) !== JSON.stringify(parsed)) {
      setSetting(this.db, SHELL_PREFERENCES_SETTING_KEY, parsed)
    }
  }

  setAssistantInitializationCommand(
    command: unknown,
    validated?: ResolvedAssistantCommand
  ): {
    config: AssistantConfig
    resolved: ResolvedAssistantCommand
  } {
    const resolved = validated ?? resolveAssistantCommand(command, this.environment)
    const value: AssistantConfig = {
      version: 1,
      initializationCommand: (command as string).trim()
    }
    setSetting(this.db, ASSISTANT_CONFIG_SETTING_KEY, value)
    this.notify()
    return { config: value, resolved }
  }

  // --- Skin library -------------------------------------------------------

  getSkinLibrary(): UserSkin[] {
    return parseSkinLibrarySetting(getSetting(this.db, SKIN_LIBRARY_SETTING_KEY, []))
  }

  private writeSkinLibrary(skins: UserSkin[]): void {
    setSetting(this.db, SKIN_LIBRARY_SETTING_KEY, skins)
  }

  listAvailableSkinIds(): string[] {
    const skins = this.getSkinLibrary()
    return [...builtinSkinIds(), ...skins.map((skin) => skin.id)]
  }

  createUserSkin(name: unknown, content: unknown): UserSkin {
    if (!isValidSkinName(name)) throw new Error(t('skin:error.nameRequired'))
    const parsed = parseSkinContent(content)
    if (!parsed) throw new Error(t('skin:error.parseFailed'))
    const skins = this.getSkinLibrary()
    if (skins.length >= MAX_USER_SKINS) throw new Error(t('skin:error.libraryFull'))
    const skin: UserSkin = { ...parsed, id: createUserSkinId(), builtin: false, name: (name as string).trim() }
    this.writeSkinLibrary([...skins, skin])
    this.notify()
    return skin
  }

  updateUserSkin(id: unknown, content: unknown): UserSkin {
    if (typeof id !== 'string') throw new Error(t('skin:error.invalidId'))
    const parsed = parseSkinContent(content)
    if (!parsed) throw new Error(t('skin:error.parseFailed'))
    const skins = this.getSkinLibrary()
    const index = skins.findIndex((skin) => skin.id === id)
    if (index === -1) throw new Error(t('skin:error.invalidId'))
    const updated: UserSkin = { ...skins[index], ...parsed, id: skins[index].id, builtin: false, name: skins[index].name }
    const next = [...skins]
    next[index] = updated
    this.writeSkinLibrary(next)
    this.notify()
    return updated
  }

  renameUserSkin(id: unknown, name: unknown): UserSkin {
    if (typeof id !== 'string' || !isValidSkinName(name)) throw new Error(t('skin:error.nameRequired'))
    const skins = this.getSkinLibrary()
    const index = skins.findIndex((skin) => skin.id === id)
    if (index === -1) throw new Error(t('skin:error.invalidId'))
    const updated: UserSkin = { ...skins[index], name: (name as string).trim() }
    const next = [...skins]
    next[index] = updated
    this.writeSkinLibrary(next)
    this.notify()
    return updated
  }

  deleteUserSkin(id: unknown): void {
    if (typeof id !== 'string') return
    const skins = this.getSkinLibrary()
    const next = skins.filter((skin) => skin.id !== id)
    if (next.length === skins.length) return
    const appearance = this.getAppearance()
    const isActive = appearance.activeSkinId === id
    const commit = this.db.transaction(() => {
      this.writeSkinLibrary(next)
      if (isActive) {
        setSetting(this.db, APPEARANCE_PREFERENCES_SETTING_KEY, {
          ...appearance,
          activeSkinId: DEFAULT_ACTIVE_SKIN_ID
        })
      }
    })
    commit()
    this.notify()
  }

  duplicateSkin(id: unknown): UserSkin {
    const skins = this.getSkinLibrary()
    const userSkin = skins.find((skin) => skin.id === id)
    const builtin = typeof id === 'string' ? getBuiltinSkin(id) : undefined
    const active = this.getSnapshot().activeSkin
    const template = userSkin ?? builtin ?? (active.id === id ? active : undefined)
    if (!template) throw new Error(t('skin:error.invalidId'))
    const content: SkinContent = {
      mode: template.mode,
      colors: template.colors,
      typography: template.typography,
      radius: template.radius,
      background: template.background,
      spacingScale: template.spacingScale
    }
    const suffix = ' copy'
    const maxBase = SKIN_BOUNDS.nameMax - suffix.length
    const baseName = (userSkin ? userSkin.name : 'builtin').slice(0, Math.max(1, maxBase))
    return this.createUserSkin(`${baseName}${suffix}`, content)
  }

  setActiveSkin(id: unknown): string {
    if (typeof id !== 'string') throw new Error(t('skin:error.invalidId'))
    const skins = this.getSkinLibrary()
    if (!isPublicSkinId(id, skins)) throw new Error(t('skin:error.invalidId'))
    const current = this.getAppearance()
    this.writeAppearance({ ...current, activeSkinId: id })
    return id
  }

  resolveActiveSkin(): Skin {
    const appearance = this.getAppearance()
    return resolveActiveSkin(appearance.activeSkinId, this.getSkinLibrary())
  }

  importSkin(rawJson: string): UserSkin {
    if (Buffer.byteLength(rawJson, 'utf8') > MAX_IMPORT_BYTES) throw new Error(t('skin:error.parseFailed'))
    const parsed = parseImportedSkin(rawJson)
    if (!parsed) throw new Error(t('skin:error.parseFailed'))
    return this.createUserSkin(parsed.name, parsed.content)
  }

  exportSkin(id: unknown): string {
    if (typeof id !== 'string') throw new Error(t('skin:error.invalidId'))
    const skins = this.getSkinLibrary()
    const userSkin = skins.find((entry) => entry.id === id)
    const builtin = getBuiltinSkin(id)
    const source: Skin | undefined = userSkin ?? builtin
    if (!source) throw new Error(t('skin:error.invalidId'))
    const content: SkinContent = {
      mode: source.mode,
      colors: source.colors,
      typography: source.typography,
      radius: source.radius,
      background: source.background,
      spacingScale: source.spacingScale
    }
    const name = source.builtin ? (source.id.split('.').pop() ?? 'skin') : source.name
    return JSON.stringify(serializeSkinForExport(name, content))
  }

  // --- Appearance ---------------------------------------------------------

  setLanguage(language: unknown): SupportedLanguage {
    if (!isSupportedLanguage(language)) throw new Error(t('errors:appearance.unsupportedLanguage'))
    const current = this.getAppearance()
    this.writeAppearance({ ...current, language })
    return language
  }

  normalizeAppearanceOnStart(detectedLanguage: SupportedLanguage): void {
    const raw: unknown = getSetting(this.db, APPEARANCE_PREFERENCES_SETTING_KEY, null)
    const skins = this.getSkinLibrary()
    const normalized = parseAppearancePreferences(raw, detectedLanguage)
    const storedActiveSkinId = isRecord(raw) && typeof raw.activeSkinId === 'string' ? raw.activeSkinId : undefined
    let changed = !isRecord(raw) || raw.version !== 2 || storedActiveSkinId === undefined
    if (normalized.activeSkinId !== storedActiveSkinId || !isPublicSkinId(normalized.activeSkinId, skins)) {
      normalized.activeSkinId = isPublicSkinId(normalized.activeSkinId, skins)
        ? normalized.activeSkinId
        : DEFAULT_ACTIVE_SKIN_ID
      changed = true
    }
    if (changed) setSetting(this.db, APPEARANCE_PREFERENCES_SETTING_KEY, normalized)
  }

  ensureDetectedLanguage(detected: SupportedLanguage): void {
    const raw: unknown = getSetting(this.db, APPEARANCE_PREFERENCES_SETTING_KEY, null)
    const hasStoredLanguage = isRecord(raw) && isSupportedLanguage(raw.language)
    if (hasStoredLanguage) return
    const parsed = parseAppearancePreferences(raw, detected)
    setSetting(this.db, APPEARANCE_PREFERENCES_SETTING_KEY, parsed)
  }

  detectLanguageFromSystemLocale(locale: string): SupportedLanguage {
    return resolveLanguageFromLocale(locale)
  }

  setLayout(value: unknown): LayoutPreferences {
    const parsed = parseLayoutPreferences(value)
    setSetting(this.db, LAYOUT_PREFERENCES_SETTING_KEY, parsed)
    this.notify()
    return parsed
  }

  setMainWindowState(value: unknown): MainWindowState {
    const parsed = parseMainWindowState(value)
    if (!parsed) throw new Error(t('errors:windowState.mainInvalid'))
    setSetting(this.db, MAIN_WINDOW_STATE_SETTING_KEY, parsed)
    return parsed
  }

  getMainWindowState(): MainWindowState | null {
    return parseMainWindowState(getSetting(this.db, MAIN_WINDOW_STATE_SETTING_KEY, null))
  }

  setAssistantWindowState(value: unknown): AssistantWindowState {
    const parsed = parseAssistantWindowState(value)
    if (!parsed) throw new Error(t('errors:windowState.assistantInvalid'))
    setSetting(this.db, ASSISTANT_WINDOW_STATE_SETTING_KEY, parsed)
    return parsed
  }

  getAssistantWindowState(): AssistantWindowState | null {
    return parseAssistantWindowState(getSetting(this.db, ASSISTANT_WINDOW_STATE_SETTING_KEY, null))
  }

  listPublicSettings(): Record<PublicSettingKey, string> {
    const snapshot = this.getSnapshot()
    return {
      'appearance.skin': snapshot.appearance.activeSkinId,
      'appearance.language': snapshot.appearance.language,
      'assistant.initializationCommand': snapshot.assistant.initializationCommand
    }
  }

  getPublicSetting(key: unknown): string {
    if (!isPublicSettingKey(key)) throw new Error(t('errors:publicSetting.inaccessible'))
    return this.listPublicSettings()[key]
  }

  setPublicSetting(key: unknown, value: unknown): string {
    if (!isPublicSettingKey(key)) throw new Error(t('errors:publicSetting.notMutable'))
    if (typeof value !== 'string') throw new Error(t('errors:publicSetting.valueMustBeString'))
    if (key === 'appearance.skin') return this.setActiveSkin(value)
    if (key === 'appearance.language') return this.setLanguage(value)
    return this.setAssistantInitializationCommand(value).config.initializationCommand
  }

  onChanged(listener: SettingsChangedListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private getAppearance(): AppearancePreferences {
    return parseAppearancePreferences(
      getSetting(this.db, APPEARANCE_PREFERENCES_SETTING_KEY, DEFAULT_APPEARANCE_PREFERENCES)
    )
  }

  private writeAppearance(value: AppearancePreferences): void {
    setSetting(this.db, APPEARANCE_PREFERENCES_SETTING_KEY, value)
    this.notify()
  }

  private notify(): void {
    const snapshot = this.getSnapshot()
    for (const listener of this.listeners) listener(snapshot)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
