import { describe, expect, it, vi } from 'vitest'
import type {
  UpdateAdapter,
  UpdateAdapterConfiguration,
  UpdateAdapterEvent
} from './updateAdapter'
import { resolveUpdateRuntime, UpdateService } from './updateService'

class FakeUpdateAdapter implements UpdateAdapter {
  configuration: UpdateAdapterConfiguration | null = null
  listener: ((event: UpdateAdapterEvent) => void) | null = null
  checkForUpdates = vi.fn(async (): Promise<void> => undefined)
  quitAndInstall = vi.fn()

  configure(configuration: UpdateAdapterConfiguration): void {
    this.configuration = configuration
  }

  subscribe(listener: (event: UpdateAdapterEvent) => void): () => void {
    this.listener = listener
    return () => {
      this.listener = null
    }
  }

  emit(event: UpdateAdapterEvent): void {
    this.listener?.(event)
  }
}

function createService(options: {
  adapter?: FakeUpdateAdapter
  version?: string
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
  packageTypeMarker?: string | null
  isPackaged?: boolean
} = {}) {
  const adapter = options.adapter ?? new FakeUpdateAdapter()
  const adapterFactory = vi.fn(() => adapter)
  const openExternal = vi.fn(async () => undefined)
  const service = new UpdateService({
    currentVersion: options.version ?? '1.2.3',
    isPackaged: options.isPackaged ?? true,
    platform: options.platform ?? 'win32',
    environment: options.environment ?? {},
    packageTypeMarker: options.packageTypeMarker,
    adapterFactory,
    openExternal,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }
  })
  return { adapter, adapterFactory, openExternal, service }
}

describe('resolveUpdateRuntime', () => {
  it('fails closed while identifying every supported package type', () => {
    expect(resolveUpdateRuntime({ isPackaged: false, platform: 'win32' }))
      .toEqual({ packageType: 'unknown', capability: 'unsupported' })
    expect(resolveUpdateRuntime({ isPackaged: true, platform: 'win32', environment: {} }))
      .toEqual({ packageType: 'nsis', capability: 'installable' })
    expect(resolveUpdateRuntime({
      isPackaged: true,
      platform: 'win32',
      environment: { PORTABLE_EXECUTABLE_FILE: 'CLILoom.exe' }
    })).toEqual({ packageType: 'portable', capability: 'downloadOnly' })
    expect(resolveUpdateRuntime({ isPackaged: true, platform: 'darwin' }))
      .toEqual({ packageType: 'mac', capability: 'downloadOnly' })
    expect(resolveUpdateRuntime({
      isPackaged: true,
      platform: 'linux',
      environment: { APPIMAGE: '/opt/CLILoom.AppImage' },
      packageTypeMarker: 'deb'
    })).toEqual({ packageType: 'appimage', capability: 'installable' })
    expect(resolveUpdateRuntime({
      isPackaged: true,
      platform: 'linux',
      environment: { APPIMAGE: '../CLILoom.AppImage' }
    })).toEqual({ packageType: 'unknown', capability: 'unsupported' })
    expect(resolveUpdateRuntime({
      isPackaged: true,
      platform: 'linux',
      packageTypeMarker: 'deb'
    })).toEqual({ packageType: 'deb', capability: 'downloadOnly' })
    expect(resolveUpdateRuntime({
      isPackaged: true,
      platform: 'linux',
      packageTypeMarker: 'rpm'
    })).toEqual({ packageType: 'rpm', capability: 'downloadOnly' })
    expect(resolveUpdateRuntime({ isPackaged: true, platform: 'linux' }))
      .toEqual({ packageType: 'unknown', capability: 'unsupported' })
  })
})

describe('UpdateService', () => {
  it('does not create the updater or access the network until a supported user check', async () => {
    const supported = createService()
    expect(supported.adapterFactory).not.toHaveBeenCalled()
    expect(supported.adapter.checkForUpdates).not.toHaveBeenCalled()

    const unsupported = createService({ isPackaged: false })
    expect((await unsupported.service.checkForUpdates()).errorCode).toBe('unsupported-build')
    expect(unsupported.adapterFactory).not.toHaveBeenCalled()
    expect(unsupported.adapter.checkForUpdates).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent checks and maps updater states', async () => {
    let finishCheck: (() => void) | undefined
    const adapter = new FakeUpdateAdapter()
    adapter.checkForUpdates = vi.fn(() => new Promise<void>((resolve) => {
      finishCheck = resolve
    }))
    const { service } = createService({ adapter })

    const first = service.checkForUpdates()
    const second = service.checkForUpdates()
    expect(first).toBe(second)
    expect(adapter.checkForUpdates).toHaveBeenCalledOnce()
    expect(service.getState().status).toBe('checking')

    adapter.emit({ type: 'not-available', info: { version: '1.2.3' } })
    finishCheck?.()
    await first
    expect(service.getState()).toMatchObject({
      status: 'upToDate',
      currentVersion: '1.2.3'
    })
  })

  it('configures stable and prerelease channels without allowing downgrade', async () => {
    const stable = createService()
    const stableCheck = stable.service.checkForUpdates()
    stable.adapter.emit({ type: 'not-available', info: { version: '1.2.3' } })
    await stableCheck
    expect(stable.adapter.configuration).toEqual({
      autoDownload: true,
      allowPrerelease: false,
      channel: null
    })

    const prerelease = createService({ version: '2.0.0-beta.4' })
    const prereleaseCheck = prerelease.service.checkForUpdates()
    prerelease.adapter.emit({ type: 'not-available', info: { version: '2.0.0-beta.4' } })
    await prereleaseCheck
    expect(prerelease.adapter.configuration).toEqual({
      autoDownload: true,
      allowPrerelease: true,
      channel: 'beta'
    })
  })

  it('downloads installable updates and reserves installation exactly once', async () => {
    const { adapter, openExternal, service } = createService()
    const check = service.checkForUpdates()
    adapter.emit({
      type: 'available',
      info: {
        version: '1.3.0',
        releaseName: 'CLILoom 1.3',
        releaseNotes: '<b>plain text only</b>\0',
        releaseDate: '2026-08-12T00:00:00.000Z'
      }
    })
    adapter.emit({
      type: 'download-progress',
      progress: { percent: 42.5, transferred: 50, total: 100, bytesPerSecond: 20 }
    })
    expect(service.getState()).toMatchObject({
      status: 'downloading',
      targetVersion: '1.3.0',
      progress: { percent: 42.5 }
    })
    adapter.emit({ type: 'downloaded', info: { version: '1.3.0' } })
    await check

    expect(service.getState()).toMatchObject({
      status: 'downloaded',
      targetVersion: '1.3.0',
      releaseNotes: '<b>plain text only</b>'
    })
    expect(service.beginInstall()).toBe(true)
    expect(service.beginInstall()).toBe(false)
    service.quitAndInstall()
    expect(adapter.quitAndInstall).toHaveBeenCalledOnce()

    await service.openRelease()
    expect(openExternal).toHaveBeenCalledWith(
      'https://github.com/laurentwu/CLILoom/releases/tag/v1.3.0'
    )
  })

  it('keeps download-only builds on the release-page path', async () => {
    const { adapter, service } = createService({
      platform: 'win32',
      environment: { PORTABLE_EXECUTABLE_FILE: 'CLILoom.exe' }
    })
    const check = service.checkForUpdates()
    adapter.emit({ type: 'available', info: { version: '1.3.0' } })
    await check

    expect(adapter.configuration?.autoDownload).toBe(false)
    expect(service.getState()).toMatchObject({
      status: 'available',
      capability: 'downloadOnly',
      packageType: 'portable'
    })
    expect(service.beginInstall()).toBe(false)
    expect(adapter.quitAndInstall).not.toHaveBeenCalled()
  })

  it('uses stable error codes and can retry after a failed check', async () => {
    const adapter = new FakeUpdateAdapter()
    adapter.checkForUpdates
      .mockRejectedValueOnce(new Error('/Users/private/token=secret'))
      .mockImplementationOnce(async () => undefined)
    const { service } = createService({ adapter })

    expect((await service.checkForUpdates()).errorCode).toBe('check-failed')
    const retry = service.checkForUpdates()
    adapter.emit({ type: 'not-available', info: { version: '1.2.3' } })
    await retry
    expect(service.getState().status).toBe('upToDate')
  })
})
