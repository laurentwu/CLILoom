import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { NotFoundError } from './errors'
import { t } from './i18n'

export const ASSISTANT_WORKSPACE_DIRECTORY = 'assistant-workspace'
export const MAX_ASSISTANT_INPUT_FILE_BYTES = 2 * 1024 * 1024
export const WINDOWS_ASSISTANT_CLI_EXECUTABLE = 'cliloom-cli.exe'

export type AssistantWorkspace = {
  rootPath: string
  binPath: string
  wslBinPath?: string
  launcherPath: string
  windowsLauncherPath: string
  wslLauncherPath?: string
  hostLauncherArguments?: string[]
}

export function ensureAssistantWorkspace(options: {
  userDataPath: string
  executablePath: string
  windowsConsoleLauncherPath?: string
  appEntryPath?: string
  noSandbox?: boolean
}): AssistantWorkspace {
  const rootPath = path.join(options.userDataPath, ASSISTANT_WORKSPACE_DIRECTORY)
  const binPath = path.join(rootPath, 'bin')
  const wslBinPath = path.join(rootPath, 'wsl-bin')
  ensurePrivateDirectory(rootPath)
  ensurePrivateDirectory(binPath)
  ensurePrivateDirectory(wslBinPath)

  const instructions = `# CLILoom Assistant

You are running inside CLILoom's private assistant workspace.

- Run \`cliloom context\` first to learn the application, workflow schema, projects, and public settings.
- Use only the \`cliloom\` command to read or change CLILoom configuration.
- Validate a workflow before saving it, and preserve the revision returned by \`workflow get --json\`.
- Do not edit files under this managed workspace unless the user explicitly asks you to create a workflow JSON input file.
`
  atomicManagedWrite(path.join(rootPath, 'AGENTS.md'), instructions, 0o600)
  atomicManagedWrite(path.join(rootPath, 'CLAUDE.md'), instructions, 0o600)

  const launcherArguments = [
    ...(options.windowsConsoleLauncherPath ? [options.windowsConsoleLauncherPath] : []),
    options.executablePath
  ]
  if (options.noSandbox) launcherArguments.push('--no-sandbox')
  if (options.appEntryPath) launcherArguments.push(options.appEntryPath)
  launcherArguments.push('--cliloom-cli')
  const posixLauncher = `#!/bin/sh\nexec ${launcherArguments.map(quotePosix).join(' ')} "$@"\n`
  const windowsLauncher = `@echo off\r\n${launcherArguments.map(quoteCmd).join(' ')} %*\r\n`
  const launcherPath = path.join(binPath, 'cliloom')
  const windowsLauncherPath = path.join(binPath, 'cliloom.cmd')
  // Keep the WSL shim in its own PATH directory under the canonical command
  // name. The native launcher cannot safely double as a WSL interop shim.
  const wslLauncherPath = path.join(wslBinPath, 'cliloom')
  atomicManagedWrite(launcherPath, posixLauncher, 0o700)
  atomicManagedWrite(windowsLauncherPath, windowsLauncher, 0o600)

  return {
    rootPath,
    binPath,
    wslBinPath,
    launcherPath,
    windowsLauncherPath,
    wslLauncherPath,
    hostLauncherArguments: launcherArguments
  }
}

export function ensureWslAssistantLauncher(
  workspace: AssistantWorkspace,
  linuxLauncherArguments: string[]
): string {
  if (linuxLauncherArguments.length === 0 || linuxLauncherArguments.some((value) => value.includes('\0'))) {
    throw new Error(t('errors:assistantWorkspace.unsafeLauncherPath'))
  }
  const launcherPath = workspace.wslLauncherPath
    ?? path.join(workspace.wslBinPath ?? workspace.binPath, 'cliloom')
  const content = `#!/bin/sh\nexec ${linuxLauncherArguments.map(quotePosix).join(' ')} "$@"\n`
  atomicManagedWrite(launcherPath, content, 0o700)
  return launcherPath
}

export function readAssistantWorkspaceFile(
  workspaceRoot: string,
  relativePath: unknown,
  maxBytes = MAX_ASSISTANT_INPUT_FILE_BYTES
): string {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\0')) {
    throw new Error(t('errors:assistantWorkspace.invalidPath'))
  }
  if (path.isAbsolute(relativePath)) throw new Error(t('errors:assistantWorkspace.fileRelativeOnly'))
  const segments = relativePath.replaceAll('\\', '/').split('/')
  if (segments.some((segment) => segment === '..')) throw new Error(t('errors:assistantWorkspace.noParentTraversal'))

  const realRoot = realpathSync(workspaceRoot)
  const candidate = path.resolve(realRoot, relativePath)
  if (!isInside(realRoot, candidate)) throw new Error(t('errors:assistantWorkspace.outsideWorkspace'))
  let realTarget: string
  try {
    realTarget = realpathSync(candidate)
  } catch {
    throw new NotFoundError(t('errors:assistantWorkspace.fileNotFound', { path: relativePath }))
  }
  if (!isInside(realRoot, realTarget)) throw new Error(t('errors:assistantWorkspace.readFileOutside'))
  const stat = statSync(realTarget)
  if (!stat.isFile()) throw new Error(t('errors:assistantWorkspace.notAFile'))
  if (stat.size > maxBytes) throw new Error(t('errors:assistantWorkspace.fileTooLarge', { limit: maxBytes }))
  return readFileSync(realTarget, 'utf8')
}

function ensurePrivateDirectory(directoryPath: string): void {
  try {
    const stat = lstatSync(directoryPath)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(t('errors:assistantWorkspace.notADirectory', { path: directoryPath }))
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    mkdirSync(directoryPath, { recursive: false, mode: 0o700 })
  }
  try {
    chmodSync(directoryPath, 0o700)
  } catch {
    // Windows does not implement POSIX modes.
  }
}

function atomicManagedWrite(filePath: string, content: string, mode: number): void {
  try {
    const stat = lstatSync(filePath)
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(t('errors:assistantWorkspace.managedNotAFile', { path: filePath }))
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const temporaryPath = `${filePath}.tmp-${randomBytes(8).toString('hex')}`
  try {
    writeFileSync(temporaryPath, content, { encoding: 'utf8', mode, flag: 'wx' })
    replaceManagedFile(temporaryPath, filePath)
    try {
      chmodSync(filePath, mode)
    } catch {
      // Windows does not implement POSIX modes.
    }
  } finally {
    try {
      unlinkSync(temporaryPath)
    } catch {
      // The rename already consumed the temporary file in the normal path.
    }
  }
}

function replaceManagedFile(temporaryPath: string, filePath: string): void {
  try {
    renameSync(temporaryPath, filePath)
    return
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EEXIST' && code !== 'EPERM') throw error
  }

  // Windows cannot rename over an existing file. Move the validated target
  // aside first, then restore it if installing the replacement fails.
  const backupPath = `${filePath}.old-${randomBytes(8).toString('hex')}`
  renameSync(filePath, backupPath)
  try {
    renameSync(temporaryPath, filePath)
  } catch (error) {
    renameSync(backupPath, filePath)
    throw error
  }
  try {
    unlinkSync(backupPath)
  } catch {
    // The replacement is complete; retain the uniquely named recovery copy.
  }
}

function isInside(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function quoteCmd(value: string): string {
  if (value.includes('"') || /[\r\n]/.test(value)) throw new Error(t('errors:assistantWorkspace.unsafeLauncherPath'))
  return `"${value.replaceAll('%', '%%')}"`
}
