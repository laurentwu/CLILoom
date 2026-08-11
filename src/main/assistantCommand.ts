import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  parseAssistantCommand,
  type ResolvedAssistantCommand
} from '../shared/assistant'
import { t } from './i18n'

export function resolveAssistantCommand(
  command: unknown,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): ResolvedAssistantCommand {
  const parsed = parseAssistantCommand(command, platform === 'win32' ? 'win32' : 'posix')
  const executablePath = resolveExecutable(parsed.executable, environment, platform)
  let versionOutput: string | undefined

  try {
    const result = spawnSync(executablePath, ['--version'], {
      env: environment,
      encoding: 'utf8',
      timeout: 1_500,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    if (output) versionOutput = output.slice(0, 1_000)
  } catch {
    // Version probing is informational. Resolution is the availability check.
  }

  return { ...parsed, executablePath, ...(versionOutput ? { versionOutput } : {}) }
}

export function resolveExecutable(
  executable: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  const isWindows = platform === 'win32'
  const hasSeparator = executable.includes('/') || executable.includes('\\')
  if (hasSeparator || path.isAbsolute(executable)) {
    if (!path.isAbsolute(executable)) throw new Error(t('errors:assistantCommand.absolutePath'))
    const explicit = resolveExecutableFile(executable, isWindows)
    if (!explicit) throw new Error(t('errors:assistantCommand.unavailable', { executable }))
    return explicit
  }

  const pathValue = getEnvironmentValue(environment, 'PATH') ?? ''
  const extensions = isWindows
    ? getWindowsExecutableExtensions(executable, environment)
    : ['']
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue
    for (const extension of extensions) {
      const candidate = path.join(directory, `${executable}${extension}`)
      const resolved = resolveExecutableFile(candidate, isWindows)
      if (resolved) return resolved
    }
  }
  throw new Error(t('errors:assistantCommand.notFound', { executable }))
}

function resolveExecutableFile(candidate: string, isWindows: boolean): string | null {
  try {
    const canonical = realpathSync(candidate)
    const stat = statSync(canonical)
    if (!stat.isFile()) return null
    if (!isWindows) accessSync(canonical, constants.X_OK)
    return canonical
  } catch {
    return null
  }
}

function getWindowsExecutableExtensions(
  executable: string,
  environment: NodeJS.ProcessEnv
): string[] {
  if (path.extname(executable)) return ['']
  const pathext = getEnvironmentValue(environment, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD'
  return pathext
    .split(';')
    .filter(Boolean)
    .map((extension) => extension.startsWith('.') ? extension : `.${extension}`)
}

function getEnvironmentValue(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  if (name in environment) return environment[name]
  const match = Object.keys(environment).find((key) => key.toLowerCase() === name.toLowerCase())
  return match ? environment[match] : undefined
}
