import type {
  DetectedShell,
  ShellFamily,
  ShellNeutralCommand
} from '../shared/shell'
import { AppError } from '../shared/appError'
import { t } from './i18n'

export const CMD_MAX_COMMAND_CHARS = 8_191
export const CMD_MAX_ENV_VALUE_CHARS = 8_191
export const WINDOWS_MAX_ENV_BLOCK_CHARS = 32_767
export const CMD_UTF8_COMMAND_PREFIX = 'chcp 65001>nul & '

const POWERSHELL_UTF8_INITIALIZATION = [
  '[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)',
  '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)',
  '$OutputEncoding = [Console]::OutputEncoding'
].join('; ')

const INTERNAL_BINDING_PATTERN = /^CLILOOM_INTERNAL_VALUE_\d+$/

export type PreparedShellCommand = {
  command: string
  env: Record<string, string>
  bindingNames: string[]
}

export type ShellInvocation = {
  executable: string
  args: string[]
}

export class ShellCommandError extends AppError {
  constructor(message: string) {
    super({ code: 'SHELL_COMMAND_INVALID', message })
    this.name = 'ShellCommandError'
  }
}

export function prepareShellCommand(options: {
  shell: DetectedShell
  command: string | ShellNeutralCommand
  baseEnvironment?: NodeJS.ProcessEnv
  requestEnvironment?: Record<string, string>
  platform?: NodeJS.Platform
}): PreparedShellCommand {
  const platform = options.platform ?? process.platform
  const validated = typeof options.command === 'string'
    ? literalShellCommand(options.command)
    : validateNeutralCommand(options.command)
  const neutral = avoidEnvironmentBindingCollisions(
    validated,
    options.baseEnvironment ?? process.env,
    options.requestEnvironment,
    platform
  )
  const command = renderShellCommand(neutral, options.shell.family)
  const env = buildShellEnvironment({
    base: options.baseEnvironment ?? process.env,
    overlay: options.requestEnvironment,
    bindings: neutral.bindings,
    platform,
    family: options.shell.family
  })

  if (options.shell.family === 'cmd') validateCmdCommand(options.shell, command, neutral, env)
  return { command, env, bindingNames: Object.keys(neutral.bindings) }
}

export function renderShellCommand(command: ShellNeutralCommand, family: ShellFamily): string {
  const validated = validateNeutralCommand(command)
  return validated.segments.map((segment) => {
    if (segment.type === 'literal') return segment.value
    if (family === 'powershell') return `\${env:${segment.name}}`
    if (family === 'cmd') {
      // cmd.exe treats an empty environment entry as undefined on some Windows
      // versions, leaving its delayed-expansion token visible in the output.
      // Rendering an empty binding directly is safe because it contributes no
      // shell source or metacharacters.
      return validated.bindings[segment.name] === '' ? '' : `!${segment.name}!`
    }
    return `\${${segment.name}}`
  }).join('')
}

export function buildNonInteractiveInvocation(
  shell: DetectedShell,
  command: string
): ShellInvocation {
  if (shell.family === 'powershell') {
    return {
      executable: shell.executablePath,
      args: ['-NoLogo', '-Command', `${POWERSHELL_UTF8_INITIALIZATION}; ${command}`]
    }
  }
  if (shell.family === 'cmd') {
    return {
      executable: shell.executablePath,
      args: ['/d', '/v:on', '/s', '/c', `${CMD_UTF8_COMMAND_PREFIX}${command}`]
    }
  }
  return { executable: shell.executablePath, args: ['-lc', command] }
}

export function buildInteractiveInvocation(shell: DetectedShell): ShellInvocation {
  if (shell.family === 'powershell') {
    return {
      executable: shell.executablePath,
      args: ['-NoLogo', '-NoExit', '-Command', POWERSHELL_UTF8_INITIALIZATION]
    }
  }
  if (shell.family === 'cmd') {
    return {
      executable: shell.executablePath,
      args: ['/d', '/v:on', '/k', 'chcp 65001>nul']
    }
  }
  return { executable: shell.executablePath, args: ['-il'] }
}

export function getInteractiveCommandTerminator(
  platform: NodeJS.Platform = process.platform
): string {
  return platform === 'win32' ? '\r' : '\n'
}

export function getShellPrompt(shell: DetectedShell): string {
  if (shell.family === 'powershell') return 'PS> '
  if (shell.family === 'cmd') return '> '
  return '$ '
}

export function buildShellEnvironment(options: {
  base: NodeJS.ProcessEnv
  overlay?: Record<string, string>
  bindings?: Record<string, string>
  platform?: NodeJS.Platform
  family: ShellFamily
}): Record<string, string> {
  const platform = options.platform ?? process.platform
  const result: Record<string, string> = {}
  mergeEnvironment(result, options.base, platform)
  mergeEnvironment(result, options.overlay, platform)
  mergeEnvironment(result, options.bindings, platform)

  if (options.family === 'posix') {
    const fallbackLocale = platform === 'linux' ? 'C.UTF-8' : 'en_US.UTF-8'
    setIfMissingOrNonUtf(result, 'LANG', fallbackLocale, platform)
    setIfMissingOrNonUtf(result, 'LC_ALL', getEnvironmentValue(result, 'LANG') ?? fallbackLocale, platform)
  } else if (platform === 'win32') {
    setIfMissing(result, 'PYTHONUTF8', '1', platform)
    setIfMissing(result, 'PYTHONIOENCODING', 'utf-8', platform)
  }
  return result
}

function validateNeutralCommand(value: ShellNeutralCommand): ShellNeutralCommand {
  if (!value || value.version !== 1 || !Array.isArray(value.segments) || !isStringRecord(value.bindings)) {
    throw new ShellCommandError(t('errors:shell.neutralInvalid'))
  }
  const bindings: Record<string, string> = {}
  for (const [name, bindingValue] of Object.entries(value.bindings)) {
    if (!INTERNAL_BINDING_PATTERN.test(name)) throw new ShellCommandError(t('errors:shell.invalidBindingName'))
    if (bindingValue.includes('\0')) throw new ShellCommandError(t('errors:shell.nulInValue'))
    bindings[name] = bindingValue
  }
  const segments = value.segments.map((segment) => {
    if (!segment || typeof segment !== 'object') throw new ShellCommandError(t('errors:shell.invalidSegment'))
    if (segment.type === 'literal' && typeof segment.value === 'string') {
      if (segment.value.includes('\0')) throw new ShellCommandError(t('errors:shell.commandNul'))
      return { type: 'literal' as const, value: segment.value }
    }
    if (
      segment.type === 'binding' &&
      typeof segment.name === 'string' &&
      INTERNAL_BINDING_PATTERN.test(segment.name) &&
      Object.hasOwn(bindings, segment.name)
    ) {
      return { type: 'binding' as const, name: segment.name }
    }
    throw new ShellCommandError(t('errors:shell.invalidBindingSegment'))
  })
  return { version: 1, segments, bindings }
}

function avoidEnvironmentBindingCollisions(
  command: ShellNeutralCommand,
  base: NodeJS.ProcessEnv,
  overlay: Record<string, string> | undefined,
  platform: NodeJS.Platform
): ShellNeutralCommand {
  const key = (name: string) => platform === 'win32' ? name.toLowerCase() : name
  const reserved = new Set([
    ...Object.keys(base),
    ...Object.keys(overlay ?? {})
  ].map(key))
  const assigned = new Set<string>()
  const replacements = new Map<string, string>()
  const bindings: Record<string, string> = {}
  let nextIndex = 0

  for (const [name, value] of Object.entries(command.bindings)) {
    let replacement = name
    if (reserved.has(key(replacement)) || assigned.has(key(replacement))) {
      do {
        replacement = `CLILOOM_INTERNAL_VALUE_${nextIndex}`
        nextIndex += 1
      } while (reserved.has(key(replacement)) || assigned.has(key(replacement)))
    }
    replacements.set(name, replacement)
    assigned.add(key(replacement))
    bindings[replacement] = value
  }

  return {
    version: 1,
    bindings,
    segments: command.segments.map((segment) => (
      segment.type === 'literal'
        ? segment
        : { type: 'binding', name: replacements.get(segment.name)! }
    ))
  }
}

function literalShellCommand(command: string): ShellNeutralCommand {
  if (typeof command !== 'string' || command.includes('\0')) {
    throw new ShellCommandError(t('errors:shell.commandInvalid'))
  }
  return {
    version: 1,
    segments: [{ type: 'literal', value: command }],
    bindings: {}
  }
}

function validateCmdCommand(
  shell: DetectedShell,
  command: string,
  neutral: ShellNeutralCommand,
  environment: Record<string, string>
): void {
  for (const segment of neutral.segments) {
    if (segment.type !== 'literal') continue
    if (segment.value.includes('!')) {
      throw new ShellCommandError(t('errors:shell.cmdBang'))
    }
    if (/\r|\n/.test(segment.value)) {
      throw new ShellCommandError(t('errors:shell.cmdNewline'))
    }
  }
  if (/%[^%\r\n]+%/.test(command)) {
    throw new ShellCommandError(t('errors:shell.cmdEnvExpansion'))
  }

  let expandedLength = command.length + CMD_UTF8_COMMAND_PREFIX.length
  for (const segment of neutral.segments) {
    if (segment.type !== 'binding') continue
    const value = neutral.bindings[segment.name]
    if (/[\r\n]/.test(value)) {
      throw new ShellCommandError(t('errors:shell.cmdValueNewline'))
    }
    if (value.length > CMD_MAX_ENV_VALUE_CHARS) {
      throw new ShellCommandError(t('errors:shell.cmdValueTooLarge', { limit: CMD_MAX_ENV_VALUE_CHARS }))
    }
    const renderedBindingLength = value === '' ? 0 : (`!${segment.name}!`).length
    expandedLength += value.length - renderedBindingLength
  }

  const oversizedEnvironmentEntry = Object.entries(environment).find(([, value]) => (
    value.length > CMD_MAX_ENV_VALUE_CHARS
  ))
  if (oversizedEnvironmentEntry) {
    throw new ShellCommandError(
      t('errors:shell.cmdEnvTooLarge', { name: oversizedEnvironmentEntry[0], limit: CMD_MAX_ENV_VALUE_CHARS })
    )
  }
  if (
    getCmdCommandLineLength(shell, command.length) > CMD_MAX_COMMAND_CHARS ||
    getCmdCommandLineLength(shell, expandedLength - CMD_UTF8_COMMAND_PREFIX.length) > CMD_MAX_COMMAND_CHARS
  ) {
    throw new ShellCommandError(t('errors:shell.cmdCommandTooLarge', { limit: CMD_MAX_COMMAND_CHARS }))
  }
  const environmentBlockLength = Object.entries(environment).reduce(
    (total, [name, value]) => total + name.length + value.length + 2,
    1
  )
  if (environmentBlockLength > WINDOWS_MAX_ENV_BLOCK_CHARS) {
    throw new ShellCommandError(t('errors:shell.cmdEnvBlockTooLarge', { limit: WINDOWS_MAX_ENV_BLOCK_CHARS }))
  }
}

export function getCmdCommandLineLength(
  shell: DetectedShell,
  renderedCommandLength: number
): number {
  const quotedExecutableLength = shell.executablePath.length + 2
  const invocationSyntaxLength = ' /d /v:on /s /c "'.length + 1
  return quotedExecutableLength + invocationSyntaxLength +
    CMD_UTF8_COMMAND_PREFIX.length + renderedCommandLength
}

function mergeEnvironment(
  target: Record<string, string>,
  source: NodeJS.ProcessEnv | Record<string, string> | undefined,
  platform: NodeJS.Platform
): void {
  if (!source) return
  for (const [name, value] of Object.entries(source)) {
    if (typeof value !== 'string') continue
    if (name.includes('=') || name.includes('\0') || value.includes('\0')) {
      throw new ShellCommandError(t('errors:shell.envNulOrEquals'))
    }
    if (platform === 'win32') {
      const existing = Object.keys(target).find((key) => key.toLowerCase() === name.toLowerCase())
      if (existing && existing !== name) delete target[existing]
    }
    target[name] = value
  }
}

function setIfMissing(
  target: Record<string, string>,
  name: string,
  value: string,
  platform: NodeJS.Platform
): void {
  if (getEnvironmentValue(target, name) !== undefined) return
  mergeEnvironment(target, { [name]: value }, platform)
}

function setIfMissingOrNonUtf(
  target: Record<string, string>,
  name: string,
  value: string,
  platform: NodeJS.Platform
): void {
  const current = getEnvironmentValue(target, name)
  if (current?.toLowerCase().includes('utf')) return
  mergeEnvironment(target, { [name]: value }, platform)
}

function getEnvironmentValue(
  environment: Record<string, string>,
  name: string
): string | undefined {
  if (name in environment) return environment[name]
  const match = Object.keys(environment).find((key) => key.toLowerCase() === name.toLowerCase())
  return match ? environment[match] : undefined
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === 'string')
}
