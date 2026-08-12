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

export type ExecutionTargetDescriptor = NativeExecutionTargetDescriptor

export type DetectedExecutionTarget = DetectedShell

export type ResolvedExecutionTarget = DetectedShell

export type ShellSelection =
  | { mode: 'automatic' }
  | { mode: 'explicit'; shell: ExecutionTargetDescriptor }

export type ShellPreferences = {
  version: 3
  selection: ShellSelection
}

export type ShellSnapshot = {
  platform: ShellPlatform
  preferences: ShellPreferences
  candidates: DetectedExecutionTarget[]
  effectiveShell: DetectedExecutionTarget | null
  discovering?: boolean
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
  version: 3,
  selection: { mode: 'automatic' }
}

export function parseShellPreferences(value: unknown): ShellPreferences {
  if (!isRecord(value) || !isRecord(value.selection)) return cloneDefaultShellPreferences()
  if (
    value.selection.mode === 'automatic' &&
    (value.version === 1 || value.version === 2 || value.version === 3)
  ) {
    return cloneDefaultShellPreferences()
  }
  if (value.selection.mode !== 'explicit' || !isRecord(value.selection.shell)) {
    return cloneDefaultShellPreferences()
  }

  if (value.version === 2 || value.version === 3) {
    const target = parseExecutionTargetDescriptor(value.selection.shell)
    return target
      ? { version: 3, selection: { mode: 'explicit', shell: target } }
      : cloneDefaultShellPreferences()
  }

  if (value.version === 1) {
    const shell = parseShellDescriptor(value.selection.shell)
    return shell
      ? { version: 3, selection: { mode: 'explicit', shell: toNativeExecutionTarget(shell) } }
      : cloneDefaultShellPreferences()
  }
  return cloneDefaultShellPreferences()
}

export function parseExecutionTargetDescriptor(value: unknown): ExecutionTargetDescriptor | null {
  if (!isRecord(value)) return null
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
  return toNativeExecutionTarget(target)
}

export function isUnsupportedWslExecutionTarget(value: unknown): boolean {
  return isRecord(value) && value.kind === 'wsl'
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

function cloneDefaultShellPreferences(): ShellPreferences {
  return { version: 3, selection: { mode: 'automatic' } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
