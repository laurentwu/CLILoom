import {
  autoUpdater,
  type AppUpdater,
  type ProgressInfo,
  type UpdateInfo
} from 'electron-updater'
import { getPrereleaseChannel, isReleaseVersion } from '../shared/update'
import type {
  UpdateAdapter,
  UpdateAdapterConfiguration,
  UpdateAdapterEvent,
  UpdateAdapterInfo
} from './updateAdapter'

export function createElectronUpdaterAdapter(): UpdateAdapter {
  return new ElectronUpdaterAdapter(autoUpdater)
}

class ElectronUpdaterAdapter implements UpdateAdapter {
  private readonly defaultIsUpdateSupported: AppUpdater['isUpdateSupported']

  constructor(private readonly updater: AppUpdater) {
    this.defaultIsUpdateSupported = updater.isUpdateSupported
  }

  configure(configuration: UpdateAdapterConfiguration): void {
    this.updater.logger = null
    this.updater.autoDownload = configuration.autoDownload
    this.updater.autoInstallOnAppQuit = false
    this.updater.autoRunAppAfterInstall = true
    this.updater.allowPrerelease = configuration.allowPrerelease
    this.updater.channel = configuration.channel
    this.updater.isUpdateSupported = async (info) => {
      if (!(await this.defaultIsUpdateSupported(info))) return false
      return isReleaseVersion(info.version) &&
        getPrereleaseChannel(info.version) === configuration.channel
    }
    // electron-updater's channel setter enables downgrades, so this assignment
    // must remain after the channel is configured.
    this.updater.allowDowngrade = false
  }

  subscribe(listener: (event: UpdateAdapterEvent) => void): () => void {
    const onChecking = () => listener({ type: 'checking' })
    const onAvailable = (info: UpdateInfo) => listener({ type: 'available', info: toAdapterInfo(info) })
    const onNotAvailable = (info: UpdateInfo) => listener({ type: 'not-available', info: toAdapterInfo(info) })
    const onProgress = (progress: ProgressInfo) => listener({ type: 'download-progress', progress })
    const onDownloaded = (info: UpdateInfo) => listener({ type: 'downloaded', info: toAdapterInfo(info) })
    const onError = (error: Error) => listener({ type: 'error', error })

    this.updater.on('checking-for-update', onChecking)
    this.updater.on('update-available', onAvailable)
    this.updater.on('update-not-available', onNotAvailable)
    this.updater.on('download-progress', onProgress)
    this.updater.on('update-downloaded', onDownloaded)
    this.updater.on('error', onError)

    return () => {
      this.updater.removeListener('checking-for-update', onChecking)
      this.updater.removeListener('update-available', onAvailable)
      this.updater.removeListener('update-not-available', onNotAvailable)
      this.updater.removeListener('download-progress', onProgress)
      this.updater.removeListener('update-downloaded', onDownloaded)
      this.updater.removeListener('error', onError)
    }
  }

  async checkForUpdates(): Promise<void> {
    await this.updater.checkForUpdates()
  }

  quitAndInstall(): void {
    this.updater.quitAndInstall(false, true)
  }
}

function toAdapterInfo(info: UpdateInfo): UpdateAdapterInfo {
  const releaseNotes = Array.isArray(info.releaseNotes)
    ? info.releaseNotes.flatMap((entry) => (
        typeof entry.note === 'string'
          ? [{
              note: entry.note,
              ...(typeof entry.version === 'string' ? { version: entry.version } : {})
            }]
          : []
      ))
    : info.releaseNotes
  return {
    version: info.version,
    releaseName: info.releaseName,
    releaseNotes,
    releaseDate: info.releaseDate
  }
}
