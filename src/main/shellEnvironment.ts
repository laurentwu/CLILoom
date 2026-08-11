import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ShellDescriptor, ShellSnapshot } from '../shared/shell'

const execFileAsync = promisify(execFile)
const PATH_BEGIN_MARKER = '__CLILOOM_PATH_BEGIN__'
const PATH_END_MARKER = '__CLILOOM_PATH_END__'
const PATH_QUERY_TIMEOUT_MS = 5000

type ShellEnvironmentConsumer = {
  setEnvironment: (environment: NodeJS.ProcessEnv) => unknown
}

type RuntimeShellService = ShellEnvironmentConsumer & {
  resolveEffectiveShell: () => ShellDescriptor
}

export async function rebuildRuntimeShellEnvironment(options: {
  baseEnvironment?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  shellService: RuntimeShellService
  consumers?: ShellEnvironmentConsumer[]
  readPath?: typeof readUserShellPath
}): Promise<{ environment: NodeJS.ProcessEnv; shell: ShellSnapshot }> {
  const baseEnvironment = options.baseEnvironment ?? process.env
  const platform = options.platform ?? process.platform
  let selectedShell: ShellDescriptor | null = null
  try {
    selectedShell = options.shellService.resolveEffectiveShell()
  } catch {
    // The final shell snapshot carries the actionable selection error.
  }
  const shellPath = await (options.readPath ?? readUserShellPath)(
    baseEnvironment,
    platform,
    selectedShell
  )
  const environment = withUserShellPath(baseEnvironment, shellPath)
  for (const consumer of options.consumers ?? []) consumer.setEnvironment(environment)
  const shell = options.shellService.setEnvironment(environment) as ShellSnapshot
  return { environment, shell }
}

export async function readUserShellPath(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  selectedShell?: ShellDescriptor | null
): Promise<string | undefined> {
  if (platform === 'win32') return undefined
  if (selectedShell && selectedShell.family !== 'posix') return undefined

  const shell = selectedShell?.executablePath
    ?? environment.SHELL
    ?? (platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  const command = [
    `printf '${PATH_BEGIN_MARKER}\\n'`,
    '/usr/bin/printenv PATH',
    `printf '${PATH_END_MARKER}\\n'`
  ].join('; ')

  try {
    const { stdout } = await execFileAsync(shell, ['-ilc', command], {
      env: environment,
      encoding: 'utf8',
      timeout: PATH_QUERY_TIMEOUT_MS
    })
    return parseUserShellPath(stdout)
  } catch {
    return undefined
  }
}

export function withUserShellPath(
  environment: NodeJS.ProcessEnv,
  shellPath: string | undefined
): NodeJS.ProcessEnv {
  return shellPath ? { ...environment, PATH: shellPath } : { ...environment }
}

export function parseUserShellPath(output: string): string | undefined {
  const normalized = output.replace(/\r\n/g, '\n')
  const beginMarker = `${PATH_BEGIN_MARKER}\n`
  const endMarker = `\n${PATH_END_MARKER}`
  const beginIndex = normalized.lastIndexOf(beginMarker)
  if (beginIndex < 0) return undefined

  const valueStart = beginIndex + beginMarker.length
  const endIndex = normalized.indexOf(endMarker, valueStart)
  if (endIndex < 0) return undefined

  const value = normalized.slice(valueStart, endIndex)
  if (!value || value.includes('\n') || value.includes('\0')) return undefined
  return value
}
