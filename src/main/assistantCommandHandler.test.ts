import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SHELL_PREFERENCES,
  type ResolvedExecutionTarget,
  type ShellSnapshot
} from '../shared/shell'
import { DEFAULT_APPEARANCE_PREFERENCES, DEFAULT_LAYOUT_PREFERENCES } from '../shared/appSettings'
import { AssistantCommandHandler } from './assistantCommandHandler'

function createHandler(snapshot: ShellSnapshot, resolvedTarget?: ResolvedExecutionTarget) {
  const resolveEffectiveShell = vi.fn(() => {
    if (!snapshot.effectiveShell) throw new Error(snapshot.error ?? 'Shell unavailable')
    return snapshot.effectiveShell
  })
  const listAvailableSkinIds = vi.fn(() => ['builtin.light.neutral', 'builtin.dark.neutral'])
  const setAssistantInitializationCommand = vi.fn((command: string, resolved: unknown) => ({
    config: { version: 1, initializationCommand: command.trim() },
    resolved
  }))
  const resolveAssistantCommand = vi.fn(async () => ({
    executable: 'codex',
    args: [],
    executablePath: '/usr/local/bin/codex'
  }))
  const workspaceStatus = {
    workspaceVersion: 2,
    appVersion: '0.1.0',
    buildId: `sha256:${'a'.repeat(64)}`,
    synchronized: true,
    managedFileCount: 4,
    repairedFiles: [],
    issues: []
  }
  const handler = new AssistantCommandHandler({
    workflowService: { list: () => [] } as never,
    settingsService: {
      getSnapshot: () => ({
        assistant: { version: 1, initializationCommand: '' },
        appearance: DEFAULT_APPEARANCE_PREFERENCES,
        layout: DEFAULT_LAYOUT_PREFERENCES,
        shell: snapshot.preferences
      }),
      listPublicSettings: () => ({
        'appearance.skin': DEFAULT_APPEARANCE_PREFERENCES.activeSkinId,
        'appearance.language': DEFAULT_APPEARANCE_PREFERENCES.language,
        'assistant.initializationCommand': ''
      }),
      listAvailableSkinIds,
      setAssistantInitializationCommand,
      setPublicSetting: vi.fn()
    } as never,
    listProjects: () => [],
    workspace: {
      rootPath: '/private/assistant',
      binPath: '/private/assistant/bin',
      launcherPath: '/private/assistant/bin/cliloom',
      windowsLauncherPath: '/private/assistant/bin/cliloom.cmd',
      workspaceVersion: 2,
      appVersion: '0.1.0',
      buildId: workspaceStatus.buildId,
      synchronize: () => workspaceStatus,
      inspect: () => workspaceStatus
    },
    appVersion: '0.1.0',
    environment: {
      PATH: '/usr/bin',
      CLILOOM_ASSISTANT_BRIDGE_TOKEN: 'must-not-leak'
    },
    shellService: {
      resolveEffectiveShell,
      getSnapshot: () => snapshot,
      resolveAssistantCommand,
      ...(resolvedTarget ? { resolveEffectiveTarget: async () => resolvedTarget } : {})
    } as never,
    confirmDelete: async () => false
  })
  return {
    handler,
    resolveEffectiveShell,
    listAvailableSkinIds,
    resolveAssistantCommand,
    setAssistantInitializationCommand
  }
}

describe('assistant doctor shell diagnostics', () => {
  it('reports the live global shell without exposing the bridge token', async () => {
    const shell = {
      id: 'posix:%2Fbin%2Fbash',
      displayName: 'bash',
      family: 'posix' as const,
      executablePath: '/bin/bash',
      source: 'system' as const
    }
    const { handler, resolveEffectiveShell } = createHandler({
      platform: 'linux',
      preferences: DEFAULT_SHELL_PREFERENCES,
      candidates: [shell],
      effectiveShell: shell
    })

    const result = await handler.handle({ version: 1, command: 'doctor', args: [] })
    const data = result.data as {
      shell: Record<string, unknown>
      workspace: Record<string, unknown>
    }

    expect(resolveEffectiveShell).toHaveBeenCalledOnce()
    expect(data.shell).toMatchObject({
      selection: 'automatic',
      available: true,
      displayName: 'bash',
      family: 'posix',
      executablePath: '/bin/bash'
    })
    expect(data.workspace).toMatchObject({
      workspaceVersion: 2,
      appVersion: '0.1.0',
      buildId: `sha256:${'a'.repeat(64)}`,
      synchronized: true,
      managedFileCount: 4
    })
    expect(result.text).toContain(`Build: sha256:${'a'.repeat(64)}`)
    expect(JSON.stringify(result)).not.toContain('must-not-leak')
  })

  it('retains explicit selection details when the selected shell is unavailable', async () => {
    const selected = {
      kind: 'native' as const,
      id: 'powershell:C%3A%5CTools%5Cpwsh.exe',
      displayName: 'PowerShell 7',
      family: 'powershell' as const,
      executablePath: 'C:\\Tools\\pwsh.exe'
    }
    const { handler } = createHandler({
      platform: 'win32',
      preferences: {
        version: 3,
        selection: { mode: 'explicit', shell: selected }
      },
      candidates: [],
      effectiveShell: null,
      error: `所选 Shell 不可用：${selected.displayName} (${selected.executablePath})`
    })

    const result = await handler.handle({ version: 1, command: 'doctor', args: [] })

    expect(result.data).toMatchObject({
      shell: {
        selection: 'explicit',
        available: false,
        configuredDisplayName: 'PowerShell 7',
        configuredFamily: 'powershell',
        configuredExecutablePath: 'C:\\Tools\\pwsh.exe',
        executablePath: null
      }
    })
    expect(result.text).toContain('PowerShell 7')
    expect(result.text).toContain('C:\\Tools\\pwsh.exe')
  })
})

describe('assistant context public settings', () => {
  it('lists the available skin ids dynamically for appearance.skin', async () => {
    const { handler, listAvailableSkinIds } = createHandler({
      platform: 'linux',
      preferences: DEFAULT_SHELL_PREFERENCES,
      candidates: [],
      effectiveShell: null
    })

    const result = await handler.handle({ version: 1, command: 'context', args: [] })
    const publicSettings = (result.data as { publicSettings: Array<{ key: string; allowedValues?: string[] }> }).publicSettings
    const skinSetting = publicSettings.find((entry) => entry.key === 'appearance.skin')

    expect(listAvailableSkinIds).toHaveBeenCalled()
    expect(skinSetting?.allowedValues).toContain('builtin.light.neutral')
    expect(skinSetting?.allowedValues).toContain('builtin.dark.neutral')
  })

  it('validates an initialization command for the selected native target before saving', async () => {
    const target = {
      id: 'posix:%2Fbin%2Fbash',
      displayName: 'bash',
      family: 'posix' as const,
      executablePath: '/bin/bash',
      source: 'system' as const
    }
    const {
      handler,
      setAssistantInitializationCommand
    } = createHandler({
      platform: 'linux',
      preferences: {
        version: 3,
        selection: {
          mode: 'explicit',
          shell: {
            kind: 'native',
            id: target.id,
            displayName: target.displayName,
            family: 'posix',
            executablePath: target.executablePath
          }
        }
      },
      candidates: [target],
      effectiveShell: target
    }, target)

    const result = await handler.handle({
      version: 1,
      command: 'settings',
      args: ['set', 'assistant.initializationCommand', process.execPath]
    })

    expect(setAssistantInitializationCommand).toHaveBeenCalledWith(
      process.execPath,
      expect.objectContaining({ executablePath: process.execPath })
    )
    expect(result.data).toMatchObject({
      key: 'assistant.initializationCommand',
      value: process.execPath,
      appliesNextSession: true
    })
  })
})
