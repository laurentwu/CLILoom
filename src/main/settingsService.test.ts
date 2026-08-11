import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  APPEARANCE_PREFERENCES_SETTING_KEY,
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_ACTIVE_SKIN_ID
} from '../shared/appSettings'
import { BUILTIN_SKIN_DARK_ID, MAX_IMPORT_BYTES, MAX_USER_SKINS } from '../shared/skin'
import { openDatabase, getSetting, setSetting, type AppDatabase } from './database'
import { SettingsService } from './settingsService'

const databases: Array<{ db: AppDatabase; directory: string }> = []

afterEach(() => {
  for (const item of databases.splice(0)) {
    item.db.close()
    rmSync(item.directory, { recursive: true, force: true })
  }
})

function createService(): SettingsService {
  const directory = mkdtempSync(path.join(tmpdir(), 'cliloom-settings-'))
  const db = openDatabase(directory)
  databases.push({ db, directory })
  return new SettingsService(db)
}

describe('settings persistence', () => {
  it('reads the default active skin and persists updates', () => {
    const service = createService()

    expect(service.getSnapshot().appearance.activeSkinId).toBe(DEFAULT_ACTIVE_SKIN_ID)
    expect(service.setActiveSkin(BUILTIN_SKIN_DARK_ID)).toBe(BUILTIN_SKIN_DARK_ID)
    expect(service.getSnapshot().appearance.activeSkinId).toBe(BUILTIN_SKIN_DARK_ID)
    expect(service.getSnapshot().activeSkin.mode).toBe('dark')
  })

  it('uses the same bounds as the renderer when persisting column widths', () => {
    const service = createService()

    expect(service.setLayout({
      version: 1,
      projectRailWidth: 220,
      taskSidebarWidth: 380
    })).toEqual({
      version: 1,
      projectRailWidth: 220,
      taskSidebarWidth: 380
    })
  })

  it('defaults to automatic shell selection and persists an explicit descriptor', () => {
    const service = createService()

    expect(service.getSnapshot().shell).toEqual({
      version: 2,
      selection: { mode: 'automatic' }
    })
    service.setShellPreferences({
      version: 2,
      selection: {
        mode: 'explicit',
        shell: {
          kind: 'native',
          id: 'posix:%2Fbin%2Fbash',
          displayName: 'bash',
          family: 'posix',
          executablePath: '/bin/bash'
        }
      }
    })

    expect(service.getSnapshot().shell.selection).toMatchObject({
      mode: 'explicit',
      shell: { displayName: 'bash', executablePath: '/bin/bash' }
    })
  })

  it('does not persist an unavailable initialization executable', () => {
    const service = createService()

    expect(() => service.setPublicSetting(
      'assistant.initializationCommand',
      '/definitely/missing/cliloom-assistant'
    )).toThrow('Initialization command is unavailable')
    expect(service.getSnapshot().assistant.initializationCommand).toBe('')
  })

  it('defaults appearance language to the fallback and persists updates', () => {
    const service = createService()

    expect(service.getSnapshot().appearance.language).toBe('en')
    expect(service.setLanguage('zh')).toBe('zh')
    expect(service.getSnapshot().appearance.language).toBe('zh')
  })

  it('detects and persists language from the system locale when none is stored', () => {
    const service = createService()
    service.ensureDetectedLanguage(service.detectLanguageFromSystemLocale('zh-CN'))

    expect(service.getSnapshot().appearance.language).toBe('zh')
  })

  it('keeps a stored language instead of overwriting it during detection', () => {
    const service = createService()
    service.setLanguage('en')
    service.ensureDetectedLanguage(service.detectLanguageFromSystemLocale('zh-CN'))

    expect(service.getSnapshot().appearance.language).toBe('en')
  })

  it('preserves language when changing the active skin and vice versa', () => {
    const service = createService()
    service.setLanguage('zh')

    expect(service.setActiveSkin(BUILTIN_SKIN_DARK_ID)).toBe(BUILTIN_SKIN_DARK_ID)
    expect(service.getSnapshot().appearance).toEqual({
      version: 2,
      activeSkinId: BUILTIN_SKIN_DARK_ID,
      language: 'zh'
    })

    service.setLanguage('en')
    expect(service.getSnapshot().appearance).toEqual({
      version: 2,
      activeSkinId: BUILTIN_SKIN_DARK_ID,
      language: 'en'
    })
  })

  it('rejects an unsupported language', () => {
    const service = createService()
    expect(() => service.setLanguage('fr')).toThrow()
  })

  it('rejects an unknown skin id', () => {
    const service = createService()
    expect(() => service.setActiveSkin('user.does-not-exist')).toThrow()
  })

  it('migrates a v1 appearance to v2 with the default skin, preserving language on startup', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'cliloom-settings-'))
    const db = openDatabase(directory)
    databases.push({ db, directory })
    setSetting(db, APPEARANCE_PREFERENCES_SETTING_KEY, { version: 1, colorTheme: 'violet', language: 'zh' })
    const service = new SettingsService(db)

    service.normalizeAppearanceOnStart(service.detectLanguageFromSystemLocale('en'))

    // Assert the raw SQLite value (parseAppearancePreferences falls back in
    // memory, so only the persisted row proves the migration landed).
    const raw = getSetting(db, APPEARANCE_PREFERENCES_SETTING_KEY, null) as unknown as {
      version: number
      activeSkinId: string
      language: string
    }
    expect(raw.version).toBe(2)
    expect(raw.activeSkinId).toBe(DEFAULT_ACTIVE_SKIN_ID)
    expect(raw.language).toBe('zh')
    expect(service.getSnapshot().appearance).toEqual({
      version: 2,
      activeSkinId: DEFAULT_ACTIVE_SKIN_ID,
      language: 'zh'
    })
    db.close()
  })

  it('rewrites a dangling active skin id back to the default on startup', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'cliloom-settings-'))
    const db = openDatabase(directory)
    databases.push({ db, directory })
    setSetting(db, APPEARANCE_PREFERENCES_SETTING_KEY, {
      version: 2,
      activeSkinId: 'user.deleted',
      language: 'en'
    })
    const service = new SettingsService(db)

    service.normalizeAppearanceOnStart('en')

    const raw = getSetting(db, APPEARANCE_PREFERENCES_SETTING_KEY, null) as unknown as { activeSkinId: string }
    expect(raw.activeSkinId).toBe(DEFAULT_ACTIVE_SKIN_ID)
    db.close()
  })

  it('exposes the active skin and interface language as public settings', () => {
    const service = createService()
    expect(service.getSnapshot().appearance).toEqual(DEFAULT_APPEARANCE_PREFERENCES)
    service.setLanguage('zh')

    expect(service.listPublicSettings()['appearance.skin']).toBe(DEFAULT_ACTIVE_SKIN_ID)
    expect(service.listPublicSettings()['appearance.language']).toBe('zh')
  })
})

describe('user skin library', () => {
  it('creates, updates and deletes user skins', () => {
    const service = createService()
    const content = {
      mode: 'light' as const,
      colors: service.getSnapshot().activeSkin.colors,
      typography: { codeFontFamily: 'JetBrains Mono', fontSize: 16, lineHeight: 1.5 },
      radius: 0.5,
      background: { kind: 'solid' as const, color: 'oklch(1 0 0)' },
      spacingScale: 1
    }

    const created = service.createUserSkin('My skin', content)
    expect(service.getSnapshot().skins).toHaveLength(1)
    expect(service.setActiveSkin(created.id)).toBe(created.id)

    const updated = service.updateUserSkin(created.id, { ...content, radius: 1 })
    expect(updated.radius).toBe(1)

    service.deleteUserSkin(created.id)
    expect(service.getSnapshot().skins).toHaveLength(0)
    expect(service.getSnapshot().appearance.activeSkinId).toBe(DEFAULT_ACTIVE_SKIN_ID)
  })

  it('switches the active skin back to default when deleting the active user skin', () => {
    const service = createService()
    const content = service.getSnapshot().activeSkin
    const created = service.createUserSkin('temp', {
      mode: content.mode,
      colors: content.colors,
      typography: content.typography,
      radius: content.radius,
      background: content.background,
      spacingScale: content.spacingScale
    })
    service.setActiveSkin(created.id)
    service.deleteUserSkin(created.id)

    expect(service.getSnapshot().appearance.activeSkinId).toBe(DEFAULT_ACTIVE_SKIN_ID)
  })

  it('counts bytes (not UTF-16 code units) when enforcing the import size limit', () => {
    const service = createService()
    // 4-byte chars pack more bytes than code units; ensure a multibyte payload
    // over the byte limit is rejected even if its char length is under the cap.
    const hugeJson = JSON.stringify({
      format: 'cliloom-skin',
      version: 1,
      name: 'big',
      content: {
        mode: 'light',
        colors: service.getSnapshot().activeSkin.colors,
        typography: { codeFontFamily: 'JetBrains Mono', fontSize: 16, lineHeight: 1.5 },
        radius: 0.5,
        background: { kind: 'solid', color: '#fff' },
        spacingScale: 1
      }
    })
    const padding = 'é'.repeat(MAX_IMPORT_BYTES)
    expect(() => service.importSkin(hugeJson.slice(0, 10) + padding)).toThrow()
  })

  it('truncates the base name when duplicating a skin whose name is near the limit', () => {
    const service = createService()
    const content = service.getSnapshot().activeSkin
    const maxName = 'x'.repeat(40)
    const created = service.createUserSkin(maxName, {
      mode: content.mode,
      colors: content.colors,
      typography: content.typography,
      radius: content.radius,
      background: content.background,
      spacingScale: content.spacingScale
    })

    const copy = service.duplicateSkin(created.id)
    expect(copy.name.endsWith(' copy')).toBe(true)
    expect(copy.name.length).toBeLessThanOrEqual(40)
  })

  it('reports a dedicated library-full error instead of an import error', () => {
    const service = createService()
    const content = service.getSnapshot().activeSkin
    for (let i = 0; i < MAX_USER_SKINS; i += 1) {
      service.createUserSkin(`skin-${i}`, {
        mode: content.mode,
        colors: content.colors,
        typography: content.typography,
        radius: content.radius,
        background: content.background,
        spacingScale: content.spacingScale
      })
    }
    expect(() => service.createUserSkin('overflow', {
      mode: content.mode,
      colors: content.colors,
      typography: content.typography,
      radius: content.radius,
      background: content.background,
      spacingScale: content.spacingScale
    })).toThrow(/上限|full/)
  })
})
