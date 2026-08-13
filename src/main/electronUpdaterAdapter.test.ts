import { beforeEach, describe, expect, it, vi } from 'vitest'

const { baseIsUpdateSupported, listeners, updater } = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>()
  const baseIsUpdateSupported = vi.fn(async (_info: { version: string }) => true)
  let channel: string | null = 'latest'
  const updater = {
    logger: console,
    autoDownload: false,
    autoInstallOnAppQuit: true,
    autoRunAppAfterInstall: false,
    allowDowngrade: true,
    allowPrerelease: false,
    isUpdateSupported: baseIsUpdateSupported,
    get channel() {
      return channel
    },
    set channel(value: string | null) {
      channel = value
      this.allowDowngrade = true
    },
    on: vi.fn((name: string, listener: (...args: unknown[]) => void) => {
      listeners.set(name, listener)
    }),
    removeListener: vi.fn((name: string) => {
      listeners.delete(name)
    }),
    checkForUpdates: vi.fn(async () => undefined),
    quitAndInstall: vi.fn()
  }
  return { baseIsUpdateSupported, listeners, updater }
})

vi.mock('electron-updater', () => ({ autoUpdater: updater }))

import { createElectronUpdaterAdapter } from './electronUpdaterAdapter'

beforeEach(() => {
  listeners.clear()
  vi.clearAllMocks()
  updater.isUpdateSupported = baseIsUpdateSupported
})

describe('ElectronUpdaterAdapter', () => {
  it('enforces explicit-install and no-downgrade settings', async () => {
    const adapter = createElectronUpdaterAdapter()
    adapter.configure({
      autoDownload: true,
      allowPrerelease: true,
      channel: 'beta'
    })

    expect(updater).toMatchObject({
      logger: null,
      autoDownload: true,
      autoInstallOnAppQuit: false,
      autoRunAppAfterInstall: true,
      allowDowngrade: false,
      allowPrerelease: true,
      channel: 'beta'
    })
    await adapter.checkForUpdates()
    adapter.quitAndInstall()
    expect(updater.checkForUpdates).toHaveBeenCalledOnce()
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('normalizes events and removes every listener', () => {
    const adapter = createElectronUpdaterAdapter()
    const receive = vi.fn()
    const unsubscribe = adapter.subscribe(receive)

    listeners.get('update-available')?.({
      version: '2.0.0',
      releaseName: 'Release',
      releaseNotes: [
        { version: '2.0.0', note: 'Kept' },
        { version: '1.9.0', note: null }
      ],
      releaseDate: '2026-08-12T00:00:00.000Z'
    })
    expect(receive).toHaveBeenCalledWith({
      type: 'available',
      info: {
        version: '2.0.0',
        releaseName: 'Release',
        releaseNotes: [{ version: '2.0.0', note: 'Kept' }],
        releaseDate: '2026-08-12T00:00:00.000Z'
      }
    })

    unsubscribe()
    expect(updater.removeListener).toHaveBeenCalledTimes(6)
    expect(listeners).toHaveProperty('size', 0)
  })

  it('accepts only the configured stable or prerelease channel', async () => {
    const prereleaseAdapter = createElectronUpdaterAdapter()
    prereleaseAdapter.configure({
      autoDownload: true,
      allowPrerelease: true,
      channel: 'beta'
    })
    expect(await updater.isUpdateSupported({ version: '2.0.0-beta.5' })).toBe(true)
    expect(await updater.isUpdateSupported({ version: '2.0.0-alpha.5' })).toBe(false)
    expect(await updater.isUpdateSupported({ version: '2.0.0' })).toBe(false)

    updater.isUpdateSupported = baseIsUpdateSupported
    const stableAdapter = createElectronUpdaterAdapter()
    stableAdapter.configure({
      autoDownload: true,
      allowPrerelease: false,
      channel: null
    })
    expect(await updater.isUpdateSupported({ version: '2.0.0' })).toBe(true)
    expect(await updater.isUpdateSupported({ version: '2.1.0-rc.1' })).toBe(false)
  })
})
