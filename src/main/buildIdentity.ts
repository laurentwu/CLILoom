import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const BUILD_IDENTITY_FILE = 'dist/build-identity.json'
export const BUILD_IDENTITY_VERSION = 1

export type ApplicationBuildIdentity = {
  version: number
  appVersion: string
  sourceHash: string
  buildId: string
  platform: NodeJS.Platform
  architecture: string
}

type PersistedBuildIdentity = {
  version: number
  appVersion: string
  sourceHash: string
}

export function loadApplicationBuildIdentity(options: {
  filePath: string
  appVersion: string
  platform?: NodeJS.Platform
  architecture?: string
  required?: boolean
}): ApplicationBuildIdentity {
  const platform = options.platform ?? process.platform
  const architecture = options.architecture ?? process.arch
  let persisted: PersistedBuildIdentity
  try {
    persisted = parsePersistedBuildIdentity(readFileSync(options.filePath, 'utf8'))
  } catch (error) {
    if (options.required) {
      throw new Error(`Packaged build identity is unavailable: ${formatError(error)}`, { cause: error })
    }
    const sourceHash = createHash('sha256')
      .update(`CLILoom development build\0${options.appVersion}\0`)
      .digest('hex')
    return createApplicationBuildIdentity({
      version: BUILD_IDENTITY_VERSION,
      appVersion: options.appVersion,
      sourceHash
    }, platform, architecture)
  }

  if (persisted.appVersion !== options.appVersion) {
    throw new Error(
      `Build identity version mismatch: ${persisted.appVersion} !== ${options.appVersion}`
    )
  }
  return createApplicationBuildIdentity(persisted, platform, architecture)
}

export function parsePersistedBuildIdentity(source: string): PersistedBuildIdentity {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    throw new Error(`Build identity JSON is invalid: ${formatError(error)}`, { cause: error })
  }
  if (!isRecord(value) ||
    value.version !== BUILD_IDENTITY_VERSION ||
    typeof value.appVersion !== 'string' ||
    !value.appVersion ||
    typeof value.sourceHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.sourceHash)) {
    throw new Error('Build identity has an unsupported format')
  }
  return {
    version: BUILD_IDENTITY_VERSION,
    appVersion: value.appVersion,
    sourceHash: value.sourceHash
  }
}

export function createApplicationBuildIdentity(
  persisted: PersistedBuildIdentity,
  platform: NodeJS.Platform,
  architecture: string
): ApplicationBuildIdentity {
  if (!platform || !architecture || platform.includes('\0') || architecture.includes('\0')) {
    throw new Error('Build identity platform or architecture is invalid')
  }
  const digest = createHash('sha256')
    .update(
      `CLILoom application build\0v${persisted.version}\0${persisted.sourceHash}\0${platform}\0${architecture}\0`
    )
    .digest('hex')
  return {
    ...persisted,
    buildId: `sha256:${digest}`,
    platform,
    architecture
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
