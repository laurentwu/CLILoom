import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  getPrereleaseChannel,
  isReleaseVersion,
  type UpdateCapability,
  type UpdateDownloadProgress,
  type UpdateErrorCode,
  type UpdatePackageType,
  type UpdateState
} from '../shared/update'
import type {
  UpdateAdapter,
  UpdateAdapterEvent,
  UpdateAdapterInfo,
  UpdateAdapterProgress
} from './updateAdapter'

export const UPDATE_RELEASE_OWNER = 'laurentwu'
export const UPDATE_RELEASE_REPOSITORY = 'CLILoom'
const MAX_RELEASE_TEXT_LENGTH = 8_000

export type UpdateRuntime = {
  packageType: UpdatePackageType
  capability: UpdateCapability
}

export type UpdateServiceOptions = {
  currentVersion: string
  isPackaged: boolean
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
  packageTypeMarker?: string | null
  adapterFactory: () => UpdateAdapter
  openExternal: (url: string) => Promise<void>
  logger?: Pick<Console, 'info' | 'warn' | 'error'>
}

export function readUpdatePackageTypeMarker(resourcesPath: string): string | null {
  try {
    return readFileSync(path.join(resourcesPath, 'package-type'), 'utf8').trim() || null
  } catch {
    return null
  }
}

export function resolveUpdateRuntime(options: {
  isPackaged: boolean
  platform: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
  packageTypeMarker?: string | null
}): UpdateRuntime {
  if (!options.isPackaged) return { packageType: 'unknown', capability: 'unsupported' }
  const environment = options.environment ?? {}

  if (options.platform === 'win32') {
    const portable = Object.keys(environment).some((key) => (
      key.startsWith('PORTABLE_EXECUTABLE_') && Boolean(environment[key])
    ))
    return portable
      ? { packageType: 'portable', capability: 'downloadOnly' }
      : { packageType: 'nsis', capability: 'installable' }
  }
  if (options.platform === 'darwin') {
    return { packageType: 'mac', capability: 'downloadOnly' }
  }
  if (options.platform === 'linux') {
    const appImagePath = environment.APPIMAGE
    if (
      appImagePath &&
      path.isAbsolute(appImagePath) &&
      !appImagePath.includes('\0')
    ) {
      return { packageType: 'appimage', capability: 'installable' }
    }
    if (options.packageTypeMarker === 'deb') return { packageType: 'deb', capability: 'downloadOnly' }
    if (options.packageTypeMarker === 'rpm') return { packageType: 'rpm', capability: 'downloadOnly' }
  }
  return { packageType: 'unknown', capability: 'unsupported' }
}

export class UpdateService {
  private readonly listeners = new Set<(state: UpdateState) => void>()
  private readonly runtime: UpdateRuntime
  private readonly logger: Pick<Console, 'info' | 'warn' | 'error'>
  private adapter: UpdateAdapter | null = null
  private unsubscribeAdapter: (() => void) | null = null
  private checkPromise: Promise<UpdateState> | null = null
  private installRequested = false
  private state: UpdateState

  constructor(private readonly options: UpdateServiceOptions) {
    const platform = options.platform ?? process.platform
    this.runtime = resolveUpdateRuntime({
      isPackaged: options.isPackaged,
      platform,
      environment: options.environment,
      packageTypeMarker: options.packageTypeMarker
    })
    this.logger = options.logger ?? console
    this.state = {
      status: 'idle',
      capability: this.runtime.capability,
      packageType: this.runtime.packageType,
      currentVersion: options.currentVersion
    }
  }

  getState(): UpdateState {
    return cloneState(this.state)
  }

  onChanged(listener: (state: UpdateState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  checkForUpdates(): Promise<UpdateState> {
    if (this.runtime.capability === 'unsupported') {
      this.setState({ status: 'checking' })
      this.setError('unsupported-build')
      return Promise.resolve(this.getState())
    }
    if (this.checkPromise) return this.checkPromise
    if (
      this.state.status === 'available' ||
      this.state.status === 'downloading' ||
      this.state.status === 'downloaded'
    ) {
      return Promise.resolve(this.getState())
    }

    const request = this.performCheck()
    this.checkPromise = request
    const clearRequest = () => {
      if (this.checkPromise === request) this.checkPromise = null
    }
    void request.then(clearRequest, clearRequest)
    return request
  }

  canInstall(): boolean {
    return this.runtime.capability === 'installable' &&
      this.state.status === 'downloaded' &&
      !this.installRequested
  }

  beginInstall(): boolean {
    if (!this.canInstall()) return false
    this.installRequested = true
    return true
  }

  quitAndInstall(): void {
    if (!this.installRequested || !this.adapter) {
      this.setError('install-unavailable')
      throw new Error('Downloaded update is not ready to install')
    }
    try {
      this.adapter.quitAndInstall()
    } catch (error) {
      this.installRequested = false
      this.setError('install-failed')
      throw error
    }
  }

  reportInstallFailure(): UpdateState {
    this.installRequested = false
    this.setError('install-failed')
    return this.getState()
  }

  async openRelease(): Promise<UpdateState> {
    const version = this.state.targetVersion
    if (!isReleaseVersion(version)) {
      this.setError('invalid-release')
      return this.getState()
    }
    const url = `https://github.com/${UPDATE_RELEASE_OWNER}/${UPDATE_RELEASE_REPOSITORY}/releases/tag/v${encodeURIComponent(version)}`
    try {
      await this.options.openExternal(url)
    } catch (error) {
      this.logger.error('[UpdateService] failed to open release', summarizeError(error))
      this.setError('open-release-failed')
    }
    return this.getState()
  }

  dispose(): void {
    this.unsubscribeAdapter?.()
    this.unsubscribeAdapter = null
    this.adapter = null
    this.listeners.clear()
  }

  private async performCheck(): Promise<UpdateState> {
    this.setState({ status: 'checking' })
    this.logger.info('[UpdateService] checking', {
      currentVersion: this.options.currentVersion,
      packageType: this.runtime.packageType,
      capability: this.runtime.capability
    })
    try {
      const adapter = this.ensureAdapter()
      await adapter.checkForUpdates()
      if (this.state.status === 'checking') this.setError('check-failed')
    } catch (error) {
      this.logger.error('[UpdateService] check failed', summarizeError(error))
      if (this.state.status === 'checking') this.setError('check-failed')
    }
    return this.getState()
  }

  private ensureAdapter(): UpdateAdapter {
    if (this.adapter) return this.adapter
    const adapter = this.options.adapterFactory()
    const channel = getPrereleaseChannel(this.options.currentVersion)
    adapter.configure({
      autoDownload: this.runtime.capability === 'installable',
      allowPrerelease: channel !== null,
      channel
    })
    this.unsubscribeAdapter = adapter.subscribe((event) => this.handleAdapterEvent(event))
    this.adapter = adapter
    return adapter
  }

  private handleAdapterEvent(event: UpdateAdapterEvent): void {
    if (event.type === 'checking') {
      this.setState({ status: 'checking' })
      return
    }
    if (event.type === 'not-available') {
      this.setState({ status: 'upToDate' })
      return
    }
    if (event.type === 'available') {
      const release = normalizeRelease(event.info)
      if (!release) {
        this.setError('invalid-release')
        return
      }
      this.setState({ status: 'available', ...release })
      return
    }
    if (event.type === 'download-progress') {
      this.setState({
        status: 'downloading',
        progress: normalizeProgress(event.progress),
        ...currentRelease(this.state)
      })
      return
    }
    if (event.type === 'downloaded') {
      const release = normalizeRelease(event.info) ?? currentRelease(this.state)
      if (!release.targetVersion) {
        this.setError('invalid-release')
        return
      }
      this.setState({ status: 'downloaded', ...release })
      return
    }

    this.logger.error('[UpdateService] updater error', summarizeError(event.error))
    const code: UpdateErrorCode = this.runtime.capability === 'installable' &&
      (this.state.status === 'available' || this.state.status === 'downloading')
      ? 'download-failed'
      : 'check-failed'
    this.setError(code)
  }

  private setError(errorCode: UpdateErrorCode): void {
    this.setState({
      status: 'error',
      errorCode,
      ...currentRelease(this.state)
    })
  }

  private setState(patch: Partial<UpdateState> & Pick<UpdateState, 'status'>): void {
    const release = patch.status === 'checking' || patch.status === 'upToDate'
      ? {}
      : currentRelease(this.state)
    this.state = {
      capability: this.runtime.capability,
      packageType: this.runtime.packageType,
      currentVersion: this.options.currentVersion,
      ...release,
      ...patch
    }
    const snapshot = this.getState()
    for (const listener of this.listeners) listener(snapshot)
  }
}

function normalizeRelease(
  info: UpdateAdapterInfo
): (Partial<UpdateState> & { targetVersion: string }) | null {
  if (!isReleaseVersion(info.version)) return null
  const releaseName = normalizeText(info.releaseName)
  const releaseNotes = normalizeReleaseNotes(info.releaseNotes)
  const releaseDate = normalizeText(info.releaseDate)
  return {
    targetVersion: info.version,
    ...(releaseName ? { releaseName } : {}),
    ...(releaseNotes ? { releaseNotes } : {}),
    ...(releaseDate ? { releaseDate } : {})
  }
}

function normalizeReleaseNotes(notes: UpdateAdapterInfo['releaseNotes']): string | undefined {
  if (typeof notes === 'string') return normalizeText(notes)
  if (!Array.isArray(notes)) return undefined
  return normalizeText(notes
    .map((entry) => entry.version ? `${entry.version}\n${entry.note}` : entry.note)
    .join('\n\n'))
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.replaceAll('\0', '').trim()
  if (!normalized) return undefined
  return normalized.slice(0, MAX_RELEASE_TEXT_LENGTH)
}

function normalizeProgress(progress: UpdateAdapterProgress): UpdateDownloadProgress {
  return {
    percent: finiteNumber(progress.percent, 0, 100),
    bytesPerSecond: finiteNumber(progress.bytesPerSecond, 0),
    transferred: finiteNumber(progress.transferred, 0),
    total: finiteNumber(progress.total, 0)
  }
}

function finiteNumber(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : null
}

function currentRelease(state: UpdateState): Partial<UpdateState> {
  return {
    ...(state.targetVersion ? { targetVersion: state.targetVersion } : {}),
    ...(state.releaseName ? { releaseName: state.releaseName } : {}),
    ...(state.releaseNotes ? { releaseNotes: state.releaseNotes } : {}),
    ...(state.releaseDate ? { releaseDate: state.releaseDate } : {}),
    ...(state.progress ? { progress: { ...state.progress } } : {})
  }
}

function cloneState(state: UpdateState): UpdateState {
  return {
    ...state,
    ...(state.progress ? { progress: { ...state.progress } } : {})
  }
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) return error.name.slice(0, 100)
  return typeof error
}
