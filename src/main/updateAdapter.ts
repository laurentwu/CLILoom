export type UpdateAdapterInfo = {
  version: string
  releaseName?: string | null
  releaseNotes?: string | Array<{ version?: string; note: string }> | null
  releaseDate?: string
}

export type UpdateAdapterProgress = {
  percent?: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
}

export type UpdateAdapterEvent =
  | { type: 'checking' }
  | { type: 'available'; info: UpdateAdapterInfo }
  | { type: 'not-available'; info: UpdateAdapterInfo }
  | { type: 'download-progress'; progress: UpdateAdapterProgress }
  | { type: 'downloaded'; info: UpdateAdapterInfo }
  | { type: 'error'; error: unknown }

export type UpdateAdapterConfiguration = {
  autoDownload: boolean
  allowPrerelease: boolean
  channel: string | null
}

export interface UpdateAdapter {
  configure(configuration: UpdateAdapterConfiguration): void
  subscribe(listener: (event: UpdateAdapterEvent) => void): () => void
  checkForUpdates(): Promise<void>
  quitAndInstall(): void
}
