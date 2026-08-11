import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ensureAssistantWorkspace,
  ensureWslAssistantLauncher,
  readAssistantWorkspaceFile
} from './assistantWorkspace'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('assistant workspace file boundary', () => {
  it('accepts a workspace reached through a symlinked ancestor', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'cliloom-assistant-workspace-'))
    temporaryDirectories.push(temporaryRoot)
    const realUserData = path.join(temporaryRoot, 'real-user-data')
    const aliasUserData = path.join(temporaryRoot, 'alias-user-data')
    mkdirSync(realUserData)
    symlinkSync(realUserData, aliasUserData, 'dir')
    const workspace = ensureAssistantWorkspace({
      userDataPath: aliasUserData,
      executablePath: process.execPath
    })
    writeFileSync(path.join(workspace.rootPath, 'workflow.json'), '{"ok":true}')

    expect(readAssistantWorkspaceFile(workspace.rootPath, 'workflow.json')).toBe('{"ok":true}')
  })

  it('rejects a file symlink that escapes the real workspace root', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'cliloom-assistant-workspace-'))
    temporaryDirectories.push(temporaryRoot)
    const workspace = ensureAssistantWorkspace({
      userDataPath: temporaryRoot,
      executablePath: process.execPath
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
      noSandbox: true
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
})
