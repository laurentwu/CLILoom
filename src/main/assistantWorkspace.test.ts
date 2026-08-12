import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ASSISTANT_WORKSPACE_MANIFEST,
  ensureAssistantWorkspace,
  ensureWslAssistantLauncher,
  readAssistantWorkspaceFile
} from './assistantWorkspace'

const temporaryDirectories: string[] = []
const buildIdentity = {
  appVersion: '0.1.0',
  buildId: `sha256:${'a'.repeat(64)}`
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('assistant workspace file boundary', () => {
  it.each([
    { appVersion: '', buildId: buildIdentity.buildId },
    { appVersion: '0.1.0\0unexpected', buildId: buildIdentity.buildId },
    { appVersion: '0.1.0', buildId: 'sha256:not-a-digest' }
  ])('rejects an invalid build identity: %o', (identity) => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'cliloom-assistant-workspace-'))
    temporaryDirectories.push(temporaryRoot)

    expect(() => ensureAssistantWorkspace({
      userDataPath: temporaryRoot,
      executablePath: process.execPath,
      ...identity
    })).toThrow('assistant workspace build identity is invalid')
  })

  it('accepts a workspace reached through a symlinked ancestor', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'cliloom-assistant-workspace-'))
    temporaryDirectories.push(temporaryRoot)
    const realUserData = path.join(temporaryRoot, 'real-user-data')
    const aliasUserData = path.join(temporaryRoot, 'alias-user-data')
    mkdirSync(realUserData)
    symlinkSync(realUserData, aliasUserData, 'dir')
    const workspace = ensureAssistantWorkspace({
      userDataPath: aliasUserData,
      executablePath: process.execPath,
      ...buildIdentity
    })
    writeFileSync(path.join(workspace.rootPath, 'workflow.json'), '{"ok":true}')

    expect(readAssistantWorkspaceFile(workspace.rootPath, 'workflow.json')).toBe('{"ok":true}')
  })

  it('rejects a file symlink that escapes the real workspace root', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'cliloom-assistant-workspace-'))
    temporaryDirectories.push(temporaryRoot)
    const workspace = ensureAssistantWorkspace({
      userDataPath: temporaryRoot,
      executablePath: process.execPath,
      ...buildIdentity
    })
    const outside = path.join(temporaryRoot, 'outside.json')
    writeFileSync(outside, '{}')
    symlinkSync(outside, path.join(workspace.rootPath, 'outside-link.json'))

    expect(() => readAssistantWorkspaceFile(workspace.rootPath, 'outside-link.json'))
      .toThrow('cannot read files outside the assistant workspace')
  })

  it('forwards the parent Electron no-sandbox switch only when requested', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'cliloom-assistant-workspace-'))
    temporaryDirectories.push(temporaryRoot)
    const workspace = ensureAssistantWorkspace({
      userDataPath: temporaryRoot,
      executablePath: '/opt/Electron/electron',
      appEntryPath: '/opt/CLILoom/app',
      noSandbox: true,
      ...buildIdentity
    })

    expect(readAssistantWorkspaceFile(workspace.rootPath, 'bin/cliloom')).toContain(
      "'/opt/Electron/electron' '--no-sandbox' '/opt/CLILoom/app' '--cliloom-cli'"
    )

    const wslLauncher = ensureWslAssistantLauncher(workspace, [
      '/mnt/c/opt/Electron/electron.exe',
      '--no-sandbox',
      '/mnt/c/opt/CLILoom/app',
      '--cliloom-cli'
    ])
    expect(path.basename(wslLauncher)).toBe('cliloom')
    expect(path.dirname(wslLauncher)).toBe(workspace.wslBinPath)
    expect(readAssistantWorkspaceFile(workspace.rootPath, 'wsl-bin/cliloom')).toContain(
      "'/mnt/c/opt/Electron/electron.exe' '--no-sandbox' '/mnt/c/opt/CLILoom/app' '--cliloom-cli'"
    )
  })

  it('routes Windows and WSL commands through the Console-subsystem launcher', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'cliloom-assistant-workspace-'))
    temporaryDirectories.push(temporaryRoot)
    const workspace = ensureAssistantWorkspace({
      userDataPath: temporaryRoot,
      executablePath: 'C:\\Program Files\\CLILoom\\CLILoom.exe',
      windowsConsoleLauncherPath: 'C:\\Program Files\\CLILoom\\cliloom-cli.exe',
      ...buildIdentity
    })

    expect(workspace.hostLauncherArguments).toEqual([
      'C:\\Program Files\\CLILoom\\cliloom-cli.exe',
      'C:\\Program Files\\CLILoom\\CLILoom.exe',
      '--cliloom-cli'
    ])
    expect(readAssistantWorkspaceFile(workspace.rootPath, 'bin/cliloom.cmd')).toContain(
      '"C:\\Program Files\\CLILoom\\cliloom-cli.exe" "C:\\Program Files\\CLILoom\\CLILoom.exe" "--cliloom-cli"'
    )

    ensureWslAssistantLauncher(workspace, [
      '/mnt/c/Program Files/CLILoom/cliloom-cli.exe',
      'C:\\Program Files\\CLILoom\\CLILoom.exe',
      '--cliloom-cli'
    ])
    expect(readAssistantWorkspaceFile(workspace.rootPath, 'wsl-bin/cliloom')).toContain(
      "'/mnt/c/Program Files/CLILoom/cliloom-cli.exe' 'C:\\Program Files\\CLILoom\\CLILoom.exe' '--cliloom-cli'"
    )
  })

  it('repairs managed files for a new build without removing user files', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'cliloom-assistant-workspace-'))
    temporaryDirectories.push(temporaryRoot)
    const first = ensureAssistantWorkspace({
      userDataPath: temporaryRoot,
      executablePath: 'C:\\old\\CLILoom.exe',
      windowsConsoleLauncherPath: 'C:\\old\\cliloom-cli.exe',
      ...buildIdentity
    })
    const userFile = path.join(first.rootPath, 'workflow.json')
    writeFileSync(userFile, '{"preserved":true}')
    writeFileSync(path.join(first.rootPath, 'AGENTS.md'), 'tampered')
    rmSync(first.windowsLauncherPath)

    const repaired = first.synchronize()

    expect(repaired.synchronized).toBe(true)
    expect(repaired.repairedFiles).toEqual(expect.arrayContaining([
      'AGENTS.md',
      'bin/cliloom.cmd'
    ]))
    expect(readFileSync(userFile, 'utf8')).toBe('{"preserved":true}')
    expect(first.inspect()).toMatchObject({
      workspaceVersion: 1,
      appVersion: '0.1.0',
      buildId: buildIdentity.buildId,
      synchronized: true,
      managedFileCount: 4
    })
    expect(first.synchronize().repairedFiles).toEqual([])

    const nextBuildId = `sha256:${'b'.repeat(64)}`
    const second = ensureAssistantWorkspace({
      userDataPath: temporaryRoot,
      executablePath: 'C:\\new\\CLILoom.exe',
      windowsConsoleLauncherPath: 'C:\\new\\cliloom-cli.exe',
      appVersion: '0.1.0',
      buildId: nextBuildId
    })
    const manifest = JSON.parse(readFileSync(
      path.join(second.rootPath, ASSISTANT_WORKSPACE_MANIFEST),
      'utf8'
    )) as { version: number; buildId: string }

    expect(manifest).toMatchObject({ version: 1, buildId: nextBuildId })
    expect(readFileSync(second.windowsLauncherPath, 'utf8')).toContain('C:\\new\\CLILoom.exe')
    expect(readFileSync(userFile, 'utf8')).toBe('{"preserved":true}')
  })

  it('reports tampered managed files before repairing them', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'cliloom-assistant-workspace-'))
    temporaryDirectories.push(temporaryRoot)
    const workspace = ensureAssistantWorkspace({
      userDataPath: temporaryRoot,
      executablePath: process.execPath,
      ...buildIdentity
    })
    writeFileSync(path.join(workspace.rootPath, 'AGENTS.md'), 'tampered')

    expect(workspace.inspect()).toMatchObject({
      synchronized: false,
      issues: ['managed-file:AGENTS.md']
    })

    expect(workspace.synchronize()).toMatchObject({
      synchronized: true,
      repairedFiles: ['AGENTS.md']
    })
  })

  it.skipIf(process.platform === 'win32')('reports and repairs a managed file mode mismatch', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'cliloom-assistant-workspace-'))
    temporaryDirectories.push(temporaryRoot)
    const workspace = ensureAssistantWorkspace({
      userDataPath: temporaryRoot,
      executablePath: process.execPath,
      ...buildIdentity
    })
    const managedPath = path.join(workspace.rootPath, 'AGENTS.md')
    chmodSync(managedPath, 0o644)

    expect(workspace.inspect()).toMatchObject({
      synchronized: false,
      issues: ['managed-file:AGENTS.md']
    })

    expect(workspace.synchronize()).toMatchObject({ synchronized: true })
    expect(lstatSync(managedPath).mode & 0o777).toBe(0o600)
  })

  it('fails closed when a managed file is replaced by a symbolic link', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'cliloom-assistant-workspace-'))
    temporaryDirectories.push(temporaryRoot)
    const workspace = ensureAssistantWorkspace({
      userDataPath: temporaryRoot,
      executablePath: process.execPath,
      ...buildIdentity
    })
    const managedPath = path.join(workspace.rootPath, 'AGENTS.md')
    const outsidePath = path.join(temporaryRoot, 'outside-instructions.md')
    writeFileSync(outsidePath, 'untrusted')
    rmSync(managedPath)
    symlinkSync(outsidePath, managedPath)

    expect(workspace.inspect()).toMatchObject({
      synchronized: false,
      issues: ['managed-file:AGENTS.md']
    })
    expect(() => workspace.synchronize())
      .toThrow('managed assistant file is not a regular file')
    expect(readFileSync(outsidePath, 'utf8')).toBe('untrusted')
  })

  it('fails closed when a managed file is replaced by a directory', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'cliloom-assistant-workspace-'))
    temporaryDirectories.push(temporaryRoot)
    const workspace = ensureAssistantWorkspace({
      userDataPath: temporaryRoot,
      executablePath: process.execPath,
      ...buildIdentity
    })
    const managedPath = path.join(workspace.rootPath, 'AGENTS.md')
    rmSync(managedPath)
    mkdirSync(managedPath)

    expect(() => workspace.synchronize())
      .toThrow('managed assistant file is not a regular file')
    expect(lstatSync(managedPath).isDirectory()).toBe(true)
  })
})
