export const UPDATE_PACKAGE_TYPES = [
  'nsis',
  'portable',
  'mac',
  'appimage',
  'deb',
  'rpm',
  'unknown'
] as const

export type UpdatePackageType = (typeof UPDATE_PACKAGE_TYPES)[number]

export type UpdateCapability = 'installable' | 'downloadOnly' | 'unsupported'

export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'upToDate'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export type UpdateErrorCode =
  | 'unsupported-build'
  | 'check-failed'
  | 'download-failed'
  | 'invalid-release'
  | 'install-unavailable'
  | 'install-failed'
  | 'open-release-failed'

export type UpdateDownloadProgress = {
  percent: number | null
  bytesPerSecond: number | null
  transferred: number | null
  total: number | null
}

export type UpdateState = {
  status: UpdateStatus
  capability: UpdateCapability
  packageType: UpdatePackageType
  currentVersion: string
  targetVersion?: string
  releaseName?: string
  releaseNotes?: string
  releaseDate?: string
  progress?: UpdateDownloadProgress
  errorCode?: UpdateErrorCode
}

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

export function isReleaseVersion(value: unknown): value is string {
  return typeof value === 'string' && SEMVER_PATTERN.test(value)
}

export function getPrereleaseChannel(version: string): string | null {
  if (!isReleaseVersion(version)) return null
  const prerelease = version.split('+', 1)[0].split('-', 2)[1]
  return prerelease?.split('.', 1)[0] ?? null
}
