export type ShellFamily = 'posix' | 'powershell' | 'cmd'

export type ShellPlatform = 'win32' | 'darwin' | 'linux' | 'other'

export type ShellDiscoverySource =
  | 'path'
  | 'login-shell'
  | 'system'
  | 'comspec'
  | 'git-for-windows'

export type ShellDescriptor = {
  id: string
  displayName: string
  family: ShellFamily
  executablePath: string
}

export type DetectedShell = ShellDescriptor & {
  source: ShellDiscoverySource
}

export type NativeExecutionTargetDescriptor = ShellDescriptor & {
  kind: 'native'
}

export type WslExecutionTargetDescriptor = {
  kind: 'wsl'
  id: string
  displayName: string
  family: 'posix'
  distributionName: string
}

export type ExecutionTargetDescriptor =
  | NativeExecutionTargetDescriptor
  | WslExecutionTargetDescriptor

export type DetectedWslTarget = WslExecutionTargetDescriptor & {
  wslVersion?: 1 | 2
  isSystemDefault?: boolean
  loginShellPath?: string
  validationState: 'unvalidated' | 'ready' | 'unavailable'
  error?: string
}

export type DetectedExecutionTarget = DetectedShell | DetectedWslTarget

export type ResolvedWslTarget = DetectedWslTarget & {
  validationState: 'ready'
  wslExecutablePath: string
  loginShellPath: string
  homeDirectory: string
  defaultUid: number
  userShellPath: string
}

export type ResolvedExecutionTarget = DetectedShell | ResolvedWslTarget

export type ShellSelection =
  | { mode: 'automatic' }
  | { mode: 'explicit'; shell: ExecutionTargetDescriptor }

export type ShellPreferences = {
  version: 2
  selection: ShellSelection
}

export type ShellSnapshot = {
  platform: ShellPlatform
  preferences: ShellPreferences
  candidates: DetectedExecutionTarget[]
  effectiveShell: DetectedExecutionTarget | null
  discovering?: boolean
  catalogError?: string
  error?: string
}

export type WorkflowExecutionContext = {
  version: 1
  target: ExecutionTargetDescriptor
  hostProjectDir: string
  targetProjectDir: string
}

export type ShellCommandSegment =
  | { type: 'literal'; value: string }
  | { type: 'binding'; name: string }

export type ShellNeutralCommand = {
  version: 1
  segments: ShellCommandSegment[]
  bindings: Record<string, string>
}

export const DEFAULT_SHELL_PREFERENCES: ShellPreferences = {
  version: 2,
  selection: { mode: 'automatic' }
}

export function parseShellPreferences(value: unknown): ShellPreferences {
  if (!isRecord(value) || !isRecord(value.selection)) return cloneDefaultShellPreferences()
  if (value.selection.mode === 'automatic' && (value.version === 1 || value.version === 2)) {
    return cloneDefaultShellPreferences()
  }
  if (value.selection.mode !== 'explicit' || !isRecord(value.selection.shell)) {
    return cloneDefaultShellPreferences()
  }

  if (value.version === 2) {
    const target = parseExecutionTargetDescriptor(value.selection.shell)
    return target
      ? { version: 2, selection: { mode: 'explicit', shell: target } }
      : cloneDefaultShellPreferences()
  }

  if (value.version === 1) {
    const shell = parseShellDescriptor(value.selection.shell)
    return shell
      ? { version: 2, selection: { mode: 'explicit', shell: toNativeExecutionTarget(shell) } }
      : cloneDefaultShellPreferences()
  }
  return cloneDefaultShellPreferences()
}

export function parseExecutionTargetDescriptor(value: unknown): ExecutionTargetDescriptor | null {
  if (!isRecord(value)) return null
  if (value.kind === 'wsl') {
    if (
      typeof value.id !== 'string' || !value.id || value.id.length > 16_384 ||
      typeof value.displayName !== 'string' || !value.displayName || value.displayName.length > 512 ||
      value.family !== 'posix' ||
      typeof value.distributionName !== 'string' || !isValidWslDistributionName(value.distributionName) ||
      value.id !== createWslTargetId(value.distributionName)
    ) return null
    return {
      kind: 'wsl',
      id: value.id,
      displayName: value.displayName,
      family: 'posix',
      distributionName: value.distributionName
    }
  }
  if (value.kind !== 'native') return null
  const shell = parseShellDescriptor(value)
  return shell ? toNativeExecutionTarget(shell) : null
}

export function parseShellDescriptor(value: unknown): ShellDescriptor | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string' || !value.id || value.id.length > 16_384 ||
    typeof value.displayName !== 'string' || !value.displayName || value.displayName.length > 512 ||
    !isShellFamily(value.family) ||
    typeof value.executablePath !== 'string' || !value.executablePath || value.executablePath.length > 16_384 ||
    value.executablePath.includes('\0')
  ) {
    return null
  }
  return {
    id: value.id,
    displayName: value.displayName,
    family: value.family,
    executablePath: value.executablePath
  }
}

export function toNativeExecutionTarget(shell: ShellDescriptor): NativeExecutionTargetDescriptor {
  return {
    kind: 'native',
    id: shell.id,
    displayName: shell.displayName,
    family: shell.family,
    executablePath: shell.executablePath
  }
}

export function toExecutionTargetDescriptor(
  target: DetectedExecutionTarget | ResolvedExecutionTarget
): ExecutionTargetDescriptor {
  if (isWslExecutionTarget(target)) {
    return {
      kind: 'wsl',
      id: target.id,
      displayName: target.displayName,
      family: 'posix',
      distributionName: target.distributionName
    }
  }
  return toNativeExecutionTarget(target)
}

export function createWslTargetId(distributionName: string): string {
  return `wsl:v1:${encodeURIComponent(distributionName)}`
}

export function isWslExecutionTarget(
  target: DetectedExecutionTarget | ExecutionTargetDescriptor | ResolvedExecutionTarget
): target is DetectedWslTarget | WslExecutionTargetDescriptor | ResolvedWslTarget {
  return 'kind' in target && target.kind === 'wsl'
}

export function isShellFamily(value: unknown): value is ShellFamily {
  return value === 'posix' || value === 'powershell' || value === 'cmd'
}

export function parseShellNeutralCommand(value: unknown): ShellNeutralCommand | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.segments) || !isRecord(value.bindings)) {
    return null
  }
  const bindings: Record<string, string> = {}
  for (const [name, bindingValue] of Object.entries(value.bindings)) {
    if (!/^CLILOOM_INTERNAL_VALUE_\d+$/.test(name) || typeof bindingValue !== 'string') return null
    if (bindingValue.includes('\0')) return null
    bindings[name] = bindingValue
  }
  const segments: ShellCommandSegment[] = []
  for (const segmentValue of value.segments) {
    if (!isRecord(segmentValue)) return null
    if (segmentValue.type === 'literal' && typeof segmentValue.value === 'string') {
      if (segmentValue.value.includes('\0')) return null
      segments.push({ type: 'literal', value: segmentValue.value })
      continue
    }
    if (
      segmentValue.type === 'binding' &&
      typeof segmentValue.name === 'string' &&
      Object.hasOwn(bindings, segmentValue.name)
    ) {
      segments.push({ type: 'binding', name: segmentValue.name })
      continue
    }
    return null
  }
  return segments.length > 0 ? { version: 1, segments, bindings } : null
}

function isValidWslDistributionName(value: string): boolean {
  return value.length <= 256 && value.trim() === value && Boolean(value) &&
    !value.includes('\0') && !/[\r\n]/.test(value) && isWellFormedUnicode(value)
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false
    }
  }
  return true
}

function cloneDefaultShellPreferences(): ShellPreferences {
  return { version: 2, selection: { mode: 'automatic' } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
