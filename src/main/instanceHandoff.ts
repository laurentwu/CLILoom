import { spawn } from 'node:child_process'
import { lstatSync, realpathSync } from 'node:fs'
import path from 'node:path'
import type { ApplicationBuildIdentity } from './buildIdentity'

export const INSTANCE_HANDOFF_PROTOCOL_VERSION = 1
const INSTANCE_DATA_KIND = 'cliloom-desktop-instance'
const BUILD_ID_PATTERN = /^sha256:[0-9a-f]{64}$/
const MAX_EXECUTABLE_PATH_CHARACTERS = 32_767

export type DesktopInstanceLaunchData = {
  kind: typeof INSTANCE_DATA_KIND
  protocolVersion: number
  appVersion: string
  buildId: string
  platform: NodeJS.Platform
  architecture: string
  portableExecutablePath: string | null
}

export type InstanceLaunchAction =
  | { action: 'focus' }
  | { action: 'offer-handoff'; incoming: DesktopInstanceLaunchData; executablePath: string }
  | { action: 'handoff-unavailable'; incoming: DesktopInstanceLaunchData }

export function createDesktopInstanceLaunchData(options: {
  identity: ApplicationBuildIdentity
  environment?: NodeJS.ProcessEnv
}): DesktopInstanceLaunchData {
  return {
    kind: INSTANCE_DATA_KIND,
    protocolVersion: INSTANCE_HANDOFF_PROTOCOL_VERSION,
    appVersion: options.identity.appVersion,
    buildId: options.identity.buildId,
    platform: options.identity.platform,
    architecture: options.identity.architecture,
    portableExecutablePath: resolvePortableExecutablePath(
      options.environment ?? process.env,
      options.identity.platform
    )
  }
}

export function parseDesktopInstanceLaunchData(value: unknown): DesktopInstanceLaunchData | null {
  if (!isRecord(value) ||
    value.kind !== INSTANCE_DATA_KIND ||
    value.protocolVersion !== INSTANCE_HANDOFF_PROTOCOL_VERSION ||
    !isSafeLabel(value.appVersion) ||
    typeof value.buildId !== 'string' ||
    !BUILD_ID_PATTERN.test(value.buildId) ||
    !isSupportedPlatform(value.platform) ||
    !isSupportedArchitecture(value.architecture) ||
    (value.portableExecutablePath !== null &&
      (typeof value.portableExecutablePath !== 'string' ||
        value.platform !== 'win32' ||
        !isPlausibleWindowsExecutablePath(value.portableExecutablePath)))) {
    return null
  }
  return {
    kind: INSTANCE_DATA_KIND,
    protocolVersion: INSTANCE_HANDOFF_PROTOCOL_VERSION,
    appVersion: value.appVersion,
    buildId: value.buildId,
    platform: value.platform,
    architecture: value.architecture,
    portableExecutablePath: value.portableExecutablePath
  }
}

export function classifyInstanceLaunch(
  currentBuildId: string,
  additionalData: unknown
): InstanceLaunchAction {
  const incoming = parseDesktopInstanceLaunchData(additionalData)
  if (!incoming || incoming.buildId === currentBuildId) return { action: 'focus' }
  if (!incoming.portableExecutablePath) return { action: 'handoff-unavailable', incoming }
  return {
    action: 'offer-handoff',
    incoming,
    executablePath: incoming.portableExecutablePath
  }
}

export function resolvePortableExecutablePath(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): string | null {
  if (platform !== 'win32') return null
  const candidate = environment.PORTABLE_EXECUTABLE_FILE
  if (!candidate || !isPlausibleWindowsExecutablePath(candidate)) return null
  try {
    const stat = lstatSync(candidate)
    if (stat.isSymbolicLink() || !stat.isFile()) return null
    return realpathSync(candidate)
  } catch {
    return null
  }
}

export async function launchReplacementExecutable(
  executablePath: string,
  options: {
    platform?: NodeJS.Platform
    environment?: NodeJS.ProcessEnv
    spawnProcess?: typeof spawn
  } = {}
): Promise<void> {
  const platform = options.platform ?? process.platform
  if (platform !== 'win32') throw new Error('Portable application handoff is only supported on Windows')
  const validatedPath = resolvePortableExecutablePath(
    { PORTABLE_EXECUTABLE_FILE: executablePath },
    platform
  )
  if (!validatedPath) throw new Error('The replacement portable executable is unavailable')

  const environment = { ...(options.environment ?? process.env) }
  for (const name of Object.keys(environment)) {
    const normalized = name.toUpperCase()
    if (normalized.startsWith('PORTABLE_EXECUTABLE_') ||
      normalized === 'CLILOOM_ASSISTANT_BRIDGE_PORT' ||
      normalized === 'CLILOOM_ASSISTANT_BRIDGE_TOKEN' ||
      normalized === 'CLILOOM_ASSISTANT_CLI_STDIN_PIPE') {
      delete environment[name]
    }
  }

  await new Promise<void>((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = (options.spawnProcess ?? spawn)(validatedPath, [], {
        detached: true,
        env: environment,
        shell: false,
        stdio: 'ignore',
        windowsHide: false
      })
    } catch (error) {
      reject(error)
      return
    }
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}

function isPlausibleWindowsExecutablePath(value: string): boolean {
  return Boolean(value) &&
    value.length <= MAX_EXECUTABLE_PATH_CHARACTERS &&
    !value.includes('\0') &&
    path.win32.isAbsolute(value) &&
    path.win32.extname(value).toLowerCase() === '.exe'
}

function isSafeLabel(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value) && value.length <= 128 && !value.includes('\0')
}

function isSupportedPlatform(value: unknown): value is NodeJS.Platform {
  return value === 'win32' || value === 'darwin' || value === 'linux'
}

function isSupportedArchitecture(value: unknown): value is string {
  return value === 'x64' || value === 'arm64'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
