import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SHELL_PREFERENCES,
  type ResolvedExecutionTarget,
  type ShellSnapshot
} from '../shared/shell'
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_LAYOUT_PREFERENCES
} from '../shared/appSettings'
import { parseWorkflowDefinition } from '../shared/workflow'
import { openDatabase, type AppDatabase } from './database'
import { SettingsService } from './settingsService'
import { WorkflowConfigService } from './workflowConfigService'
import { ensureAssistantWorkspace, type AssistantWorkspace } from './assistantWorkspace'
import { AssistantCommandError, AssistantCommandHandler } from './assistantCommandHandler'
import { ShellSelectionAppliedButUnavailableError } from './shellConfigurationService'
import { defaultSkinContent } from '../shared/skin'

type Harness = {
  db: AppDatabase
  directory: string
  handler: AssistantCommandHandler
  settingsService: SettingsService
  workflowService: WorkflowConfigService
  workspace: AssistantWorkspace
  shellConfiguration: {
    list: ReturnType<typeof vi.fn>
    refresh: ReturnType<typeof vi.fn>
    select: ReturnType<typeof vi.fn>
  }
  listInstalledFontFamilies: ReturnType<typeof vi.fn>
  shellSnapshot: ShellSnapshot
}

const harnesses: Harness[] = []

afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.db.close()
    rmSync(harness.directory, { recursive: true, force: true })
  }
})

const detectedShell = {
  id: 'posix:%2Fbin%2Fbash',
  displayName: 'bash',
  family: 'posix' as const,
  executablePath: '/bin/bash',
  source: 'system' as const
}

function createHarness(shellSnapshot: ShellSnapshot = {
  platform: 'linux',
  preferences: DEFAULT_SHELL_PREFERENCES,
  candidates: [detectedShell],
  effectiveShell: detectedShell
}): Harness {
  const directory = mkdtempSync(path.join(tmpdir(), 'cliloom-assistant-handler-'))
  const db = openDatabase(directory)
  const settingsService = new SettingsService(db, { PATH: '/usr/bin' })
  const workflowService = new WorkflowConfigService(db)
  const workspace = ensureAssistantWorkspace({
    userDataPath: directory,
    executablePath: process.execPath,
    appVersion: '0.1.0',
    buildId: `sha256:${'a'.repeat(64)}`
  })
  const shellConfiguration = {
    list: vi.fn(() => shellSnapshot),
    refresh: vi.fn(async () => shellSnapshot),
    select: vi.fn(async () => shellSnapshot)
  }
  const listInstalledFontFamilies = vi.fn(async () => ['JetBrains Mono', 'DejaVu Sans Mono'])
  const handler = new AssistantCommandHandler({
    workflowService,
    settingsService,
    listProjects: () => [],
    workspace,
    appVersion: '0.1.0',
    environment: {
      PATH: '/usr/bin',
      CLILOOM_ASSISTANT_BRIDGE_TOKEN: 'must-not-leak'
    },
    shellService: {
      resolveEffectiveShell: () => {
        if (!shellSnapshot.effectiveShell) throw new Error(shellSnapshot.error ?? 'unavailable')
        return shellSnapshot.effectiveShell
      },
      getSnapshot: () => shellSnapshot
    } as never,
    confirmDelete: async () => false,
    shellConfiguration: shellConfiguration as never,
    listInstalledFontFamilies
  })
  const harness: Harness = {
    db,
    directory,
    handler,
    settingsService,
    workflowService,
    workspace,
    shellConfiguration,
    listInstalledFontFamilies,
    shellSnapshot
  }
  harnesses.push(harness)
  return harness
}

function createMockHandler(snapshot: ShellSnapshot, resolvedTarget?: ResolvedExecutionTarget) {
  const resolveEffectiveShell = vi.fn(() => {
    if (!snapshot.effectiveShell) throw new Error(snapshot.error ?? 'Shell unavailable')
    return snapshot.effectiveShell
  })
  const listAvailableSkinIds = vi.fn(() => ['builtin.light.neutral', 'builtin.dark.neutral'])
  const setAssistantInitializationCommand = vi.fn((command: string, resolved: unknown) => ({
    config: { version: 1, initializationCommand: command.trim() },
    resolved
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
  const shellConfiguration = {
    list: vi.fn(() => snapshot),
    refresh: vi.fn(async () => snapshot),
    select: vi.fn(async () => snapshot)
  }
  const handler = new AssistantCommandHandler({
    workflowService: { list: () => [] } as never,
    settingsService: {
      getSnapshot: () => ({
        assistant: { version: 1, initializationCommand: '' },
        appearance: DEFAULT_APPEARANCE_PREFERENCES,
        layout: DEFAULT_LAYOUT_PREFERENCES,
        shell: snapshot.preferences,
        skins: [],
        activeSkin: { id: 'builtin.light.neutral', builtin: true }
      }),
      listPublicSettings: () => ({
        'appearance.skin': DEFAULT_APPEARANCE_PREFERENCES.activeSkinId,
        'appearance.language': DEFAULT_APPEARANCE_PREFERENCES.language,
        'layout.projectRailWidth': '64',
        'layout.taskSidebarWidth': '168',
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
      ...(resolvedTarget ? { resolveEffectiveTarget: async () => resolvedTarget } : {})
    } as never,
    confirmDelete: async () => false,
    shellConfiguration: shellConfiguration as never,
    listInstalledFontFamilies: async () => []
  })
  return {
    handler,
    resolveEffectiveShell,
    listAvailableSkinIds,
    setAssistantInitializationCommand,
    shellConfiguration
  }
}

describe('assistant doctor shell diagnostics', () => {
  it('reports the live global shell without exposing the bridge token', async () => {
    const { handler, resolveEffectiveShell } = createMockHandler({
      platform: 'linux',
      preferences: DEFAULT_SHELL_PREFERENCES,
      candidates: [detectedShell],
      effectiveShell: detectedShell
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
    const { handler } = createMockHandler({
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

describe('assistant capability discovery', () => {
  it('lists the available skin ids dynamically for appearance.skin', async () => {
    const { handler, listAvailableSkinIds } = createMockHandler({
      platform: 'linux',
      preferences: DEFAULT_SHELL_PREFERENCES,
      candidates: [],
      effectiveShell: null
    })

    const result = await handler.handle({ version: 1, command: 'context', args: [] })
    const publicSettings = (result.data as {
      publicSettings: Array<{ key: string; allowedValues?: string[] }>
    }).publicSettings
    const skinSetting = publicSettings.find((entry) => entry.key === 'appearance.skin')

    expect(listAvailableSkinIds).toHaveBeenCalled()
    expect(skinSetting?.allowedValues).toContain('builtin.light.neutral')
    expect(skinSetting?.allowedValues).toContain('builtin.dark.neutral')
  })

  it('exposes the new capability groups in help, context text, and JSON', async () => {
    const { handler } = createMockHandler({
      platform: 'linux',
      preferences: DEFAULT_SHELL_PREFERENCES,
      candidates: [detectedShell],
      effectiveShell: detectedShell
    })

    const help = await handler.handle({ version: 1, command: 'help', args: [] })
    for (const usage of [
      'cliloom workflow schema [--json]',
      'cliloom workflow auto-retry get <workflow-id> <node-id> [--json]',
      'cliloom shell select <automatic|detected-shell-id> [--json]',
      'cliloom skin export <skin-id> [--json]',
      'cliloom settings set <public-key> <value> [--json]'
    ]) {
      expect(help.text).toContain(usage)
      expect((help.data as { commands: string[] }).commands).toContain(usage)
    }

    const context = await handler.handle({ version: 1, command: 'context', args: [] })
    const data = context.data as {
      schemaVersion: number
      commandDescriptors: Array<{ id: string; usage: string }>
      shell: { selection: string; candidates: Array<{ id: string }> }
      skins: { activeSkinId: string }
      layout: { keys: string[] }
      workflowSchema: { schemaCommand: string; terminalAutoRetry: { modes: string[] } }
    }
    expect(data.schemaVersion).toBe(1)
    expect(data.commandDescriptors.map((descriptor) => descriptor.id)).toContain('shell.select')
    expect(data.commandDescriptors.map((descriptor) => descriptor.id)).toContain('skin.fonts')
    expect(data.shell.candidates.map((candidate) => candidate.id)).toContain(detectedShell.id)
    expect(data.skins.activeSkinId).toBe('builtin.light.neutral')
    expect(data.layout.keys).toContain('layout.projectRailWidth')
    expect(data.workflowSchema.schemaCommand).toBe('cliloom workflow schema --json')
    expect(data.workflowSchema.terminalAutoRetry.modes).toEqual(['recommended', 'cron'])
    expect(context.text).toContain('workflow schema')
    expect(context.text).toContain('shell list/refresh/select')
    expect(context.text).toContain('layout.projectRailWidth')
    expect(JSON.stringify(context)).not.toContain('must-not-leak')
  })

  it('serves the detailed workflow schema with validating examples', async () => {
    const { handler } = createHarness()

    const result = await handler.handle({ version: 1, command: 'workflow', args: ['schema'] })
    const data = result.data as {
      schemaVersion: number
      nodeConfigs: Record<string, unknown>
      terminalAutoRetry: { examples: Record<string, unknown> }
      examples: Record<string, unknown>
      notes: string[]
    }
    expect(data.schemaVersion).toBe(1)
    expect(Object.keys(data.nodeConfigs)).toEqual([
      'start',
      'interactive-terminal',
      'non-interactive-terminal',
      'input',
      'exclusive-gateway',
      'parallel-gateway',
      'end'
    ])
    expect(data.terminalAutoRetry.examples.recommendedFinite).toEqual({
      enabled: true,
      mode: 'recommended',
      maxRetries: 5
    })
    for (const example of Object.values(data.examples)) {
      expect(() => parseWorkflowDefinition(example)).not.toThrow()
    }
    expect(result.text).toContain('future-workflow-runs')
  })
})

describe('assistant auto-retry commands', () => {
  const workflowInput = {
    id: 'auto-retry-workflow',
    name: 'Auto retry workflow',
    nodes: [
      { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
      {
        id: 'term',
        type: 'interactive-terminal',
        name: 'Terminal',
        config: {
          command: 'watch logs',
          retryCommand: 'watch logs --from-start',
          cwd: '${sys_project_dir}',
          autoStart: false,
          autoRetry: { enabled: true, mode: 'recommended', maxRetries: 3 }
        }
      },
      {
        id: 'batch',
        type: 'non-interactive-terminal',
        name: 'Batch',
        config: {
          command: 'sync-data',
          cwd: '${sys_project_dir}',
          successExitCodes: [0]
        }
      },
      { id: 'end', type: 'end', name: 'End', config: {} }
    ],
    edges: [
      { id: 'start-term', from: 'start', to: 'term' },
      { id: 'term-batch', from: 'term', to: 'batch' },
      { id: 'batch-end', from: 'batch', to: 'end' }
    ]
  }

  it('reads the saved configuration with null meaning not configured', async () => {
    const { handler, workflowService } = createHarness()
    workflowService.save(workflowInput, undefined, 'renderer')

    const result = await handler.handle({
      version: 1,
      command: 'workflow',
      args: ['auto-retry', 'get', 'auto-retry-workflow', 'batch']
    })
    expect(result.data).toMatchObject({
      command: 'workflow.auto-retry.get',
      workflowId: 'auto-retry-workflow',
      nodeId: 'batch',
      nodeType: 'non-interactive-terminal',
      revision: 1,
      autoRetry: null,
      appliesTo: 'future-workflow-runs'
    })
    expect(result.text).toContain('not configured')
  })

  it('replaces the configuration, bumps the revision, and preserves other nodes', async () => {
    const { handler, workflowService } = createHarness()
    workflowService.save(workflowInput, undefined, 'renderer')

    const result = await handler.handle({
      version: 1,
      command: 'workflow',
      args: [
        'auto-retry', 'set', 'auto-retry-workflow', 'term',
        '--stdin', '--expected-revision', '1'
      ],
      stdin: JSON.stringify({ enabled: true, mode: 'recommended', maxRetries: 5 })
    })

    expect(result.data).toMatchObject({
      command: 'workflow.auto-retry.set',
      nodeId: 'term',
      nodeType: 'interactive-terminal',
      revision: 2,
      autoRetry: { enabled: true, mode: 'recommended', maxRetries: 5 },
      appliesTo: 'future-workflow-runs'
    })

    const saved = workflowService.get('auto-retry-workflow')!
    const term = saved.workflow.nodes.find((node) => node.id === 'term')
    const batch = saved.workflow.nodes.find((node) => node.id === 'batch')
    expect(term?.config).toMatchObject({
      command: 'watch logs',
      retryCommand: 'watch logs --from-start',
      autoStart: false,
      autoRetry: { enabled: true, mode: 'recommended', maxRetries: 5 }
    })
    expect(batch?.config).toMatchObject({
      command: 'sync-data',
      successExitCodes: [0]
    })
    expect(saved.workflow.edges).toEqual(workflowInput.edges)
  })

  it('supports cron mode, unlimited retries, removal via null, and re-read', async () => {
    const { handler, workflowService } = createHarness()
    workflowService.save(workflowInput, undefined, 'renderer')

    await handler.handle({
      version: 1,
      command: 'workflow',
      args: ['auto-retry', 'set', 'auto-retry-workflow', 'batch', '--stdin', '--expected-revision', '1'],
      stdin: JSON.stringify({ enabled: true, mode: 'cron', cron: '*/15 * * * *', maxRetries: null })
    })
    await handler.handle({
      version: 1,
      command: 'workflow',
      args: ['auto-retry', 'set', 'auto-retry-workflow', 'term', '--stdin', '--expected-revision', '2'],
      stdin: JSON.stringify({ enabled: false, mode: 'cron', cron: 'not-a-cron', maxRetries: 5 })
    })

    let saved = workflowService.get('auto-retry-workflow')!
    expect(
      (saved.workflow.nodes.find((node) => node.id === 'batch')?.config as { autoRetry: unknown }).autoRetry
    ).toEqual({ enabled: true, mode: 'cron', cron: '*/15 * * * *', maxRetries: null })
    expect(
      (saved.workflow.nodes.find((node) => node.id === 'term')?.config as { autoRetry: unknown }).autoRetry
    ).toEqual({ enabled: false, mode: 'cron', cron: 'not-a-cron', maxRetries: 5 })

    const removed = await handler.handle({
      version: 1,
      command: 'workflow',
      args: ['auto-retry', 'set', 'auto-retry-workflow', 'term', '--stdin', '--expected-revision', '3'],
      stdin: 'null'
    })
    expect(removed.data).toMatchObject({ revision: 4, autoRetry: null })
    saved = workflowService.get('auto-retry-workflow')!
    expect(
      (saved.workflow.nodes.find((node) => node.id === 'term')?.config as Record<string, unknown>).autoRetry
    ).toBeUndefined()
  })

  it('rejects invalid targets, revisions, and unknown fields without writing', async () => {
    const { handler, workflowService } = createHarness()
    const created = workflowService.save(workflowInput, undefined, 'renderer')

    await expect(handler.handle({
      version: 1,
      command: 'workflow',
      args: ['auto-retry', 'get', 'missing-workflow', 'term']
    })).rejects.toMatchObject({ code: 'NOT_FOUND' })

    await expect(handler.handle({
      version: 1,
      command: 'workflow',
      args: ['auto-retry', 'get', 'auto-retry-workflow', 'missing-node']
    })).rejects.toMatchObject({ code: 'NOT_FOUND' })

    await expect(handler.handle({
      version: 1,
      command: 'workflow',
      args: ['auto-retry', 'set', 'auto-retry-workflow', 'end', '--stdin', '--expected-revision', '1'],
      stdin: 'null'
    })).rejects.toThrow(/interactive-terminal/)

    await expect(handler.handle({
      version: 1,
      command: 'workflow',
      args: ['auto-retry', 'set', 'auto-retry-workflow', 'term', '--stdin'],
      stdin: 'null'
    })).rejects.toBeInstanceOf(AssistantCommandError)

    await expect(handler.handle({
      version: 1,
      command: 'workflow',
      args: ['auto-retry', 'set', 'auto-retry-workflow', 'term', '--stdin', '--expected-revision', '99'],
      stdin: JSON.stringify({ enabled: true, mode: 'recommended' })
    })).rejects.toMatchObject({ code: 'WORKFLOW_REVISION_CONFLICT' })

    await expect(handler.handle({
      version: 1,
      command: 'workflow',
      args: ['auto-retry', 'set', 'auto-retry-workflow', 'term', '--stdin', '--expected-revision', '1'],
      stdin: JSON.stringify({ enabled: true, mode: 'recommended', cron: '*/5 * * * *' })
    })).rejects.toThrow()

    await expect(handler.handle({
      version: 1,
      command: 'workflow',
      args: ['auto-retry', 'set', 'auto-retry-workflow', 'term', '--stdin', '--expected-revision', '1'],
      stdin: JSON.stringify({ enabled: true, mode: 'cron', cron: '*/5 * * * *', maxRetries: 0 })
    })).rejects.toThrow()

    await expect(handler.handle({
      version: 1,
      command: 'workflow',
      args: ['auto-retry', 'set', 'auto-retry-workflow', 'term', '--stdin', '--expected-revision', '1'],
      stdin: JSON.stringify({ enabled: true, mode: 'cron', cron: '* * * * * * *' })
    })).rejects.toThrow()

    await expect(handler.handle({
      version: 1,
      command: 'workflow',
      args: ['auto-retry', 'set', 'auto-retry-workflow', 'term', '--stdin', '--expected-revision', '1'],
      stdin: '{not json'
    })).rejects.toMatchObject({ code: 'INVALID_JSON' })

    expect(workflowService.get('auto-retry-workflow')!.revision).toBe(created.revision)
    expect(
      (workflowService.get('auto-retry-workflow')!.workflow.nodes
        .find((node) => node.id === 'term')?.config as { autoRetry: unknown }).autoRetry
    ).toEqual({ enabled: true, mode: 'recommended', maxRetries: 3 })
  })

  it('rejects extra arguments and duplicate revision flags without writing', async () => {
    const { handler, workflowService } = createHarness()
    const created = workflowService.save(workflowInput, undefined, 'renderer')

    await expect(handler.handle({
      version: 1,
      command: 'workflow',
      args: ['auto-retry', 'get', 'auto-retry-workflow', 'term', 'extra']
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })

    await expect(handler.handle({
      version: 1,
      command: 'workflow',
      args: ['auto-retry', 'get', 'auto-retry-workflow', 'term', '--expected-revision', '1']
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })

    await expect(handler.handle({
      version: 1,
      command: 'workflow',
      args: [
        'auto-retry', 'set', 'auto-retry-workflow', 'term',
        '--stdin', '--expected-revision', '1', '--expected-revision', '2'
      ],
      stdin: 'null'
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })

    expect(workflowService.get('auto-retry-workflow')!.revision).toBe(created.revision)
  })

  it('respects the dirty designer protection and reports assistant events', async () => {
    const { handler, workflowService } = createHarness()
    workflowService.save(workflowInput, undefined, 'renderer')
    workflowService.setDesignerState({
      workflowId: 'auto-retry-workflow',
      open: true,
      dirty: true
    })

    await expect(handler.handle({
      version: 1,
      command: 'workflow',
      args: ['auto-retry', 'set', 'auto-retry-workflow', 'term', '--stdin', '--expected-revision', '1'],
      stdin: JSON.stringify({ enabled: true, mode: 'recommended', maxRetries: 7 })
    })).rejects.toThrow(/designer/)

    const events: Array<{ source: string }> = []
    workflowService.onWorkflowChanged((event) => events.push(event))
    workflowService.setDesignerState({ workflowId: null, open: false, dirty: false })
    await handler.handle({
      version: 1,
      command: 'workflow',
      args: ['auto-retry', 'set', 'auto-retry-workflow', 'term', '--stdin', '--expected-revision', '1'],
      stdin: JSON.stringify({ enabled: true, mode: 'recommended', maxRetries: 7 })
    })
    expect(events).toEqual([
      expect.objectContaining({ source: 'assistant', operation: 'updated' })
    ])
  })
})

describe('assistant layout width commands', () => {
  it('reads and updates widths independently with strict validation', async () => {
    const { handler, directory } = createHarness()

    const list = await handler.handle({ version: 1, command: 'settings', args: ['list'] })
    expect(list.text).toContain('layout.projectRailWidth=64')
    expect(list.text).toContain('layout.taskSidebarWidth=168')

    const updated = await handler.handle({
      version: 1,
      command: 'settings',
      args: ['set', 'layout.projectRailWidth', ' 52 ']
    })
    expect(updated.data).toMatchObject({
      key: 'layout.projectRailWidth',
      value: '52',
      appliesTo: 'immediate',
      appliesNextSession: false
    })

    const rejected = handler.handle({
      version: 1,
      command: 'settings',
      args: ['set', 'layout.taskSidebarWidth', '139']
    })
    await expect(rejected).rejects.toThrow(/52|140|380|220|decimal|integer|十进制|整数/i)

    const reloadedDb = openDatabase(directory)
    const reloaded = new SettingsService(reloadedDb)
    try {
      expect(reloaded.getSnapshot().layout).toEqual({
        version: 1,
        projectRailWidth: 52,
        taskSidebarWidth: 168
      })
    } finally {
      reloadedDb.close()
    }
  })

  it('rejects decimal, hexadecimal, and out-of-range values without writing', async () => {
    const { handler, settingsService } = createHarness()
    for (const value of ['64.5', '0x40', '221', '64px', '', '-1']) {
      await expect(handler.handle({
        version: 1,
        command: 'settings',
        args: ['set', 'layout.projectRailWidth', value]
      })).rejects.toThrow()
    }
    expect(settingsService.getSnapshot().layout).toEqual(DEFAULT_LAYOUT_PREFERENCES)
  })
})

describe('assistant skin commands', () => {
  it('manages the full user skin lifecycle without implicit activation', async () => {
    const { handler, settingsService } = createHarness()
    const content = defaultSkinContent('dark')

    const created = await handler.handle({
      version: 1,
      command: 'skin',
      args: ['create', '--stdin'],
      stdin: JSON.stringify({ name: 'Assistant theme', content })
    })
    const createdSkin = (created.data as { skin: { id: string; name: string; builtin: boolean; active: boolean } }).skin
    expect(created.data).toMatchObject({ command: 'skin.create', appliesTo: 'settings' })
    expect(createdSkin).toMatchObject({ name: 'Assistant theme', builtin: false, active: false })
    expect(created.text).toContain('Not activated')

    const got = await handler.handle({ version: 1, command: 'skin', args: ['get', createdSkin.id] })
    expect(got.data).toMatchObject({
      command: 'skin.get',
      skin: { id: createdSkin.id, builtin: false, active: false }
    })

    const listed = await handler.handle({ version: 1, command: 'skin', args: ['list'] })
    const skins = (listed.data as { skins: Array<{ id: string; builtin: boolean }> }).skins
    expect(skins.map((skin) => skin.id)).toEqual(expect.arrayContaining([
      'builtin.light.neutral',
      'builtin.dark.neutral',
      createdSkin.id
    ]))

    const updated = await handler.handle({
      version: 1,
      command: 'skin',
      args: ['update', createdSkin.id, '--stdin'],
      stdin: JSON.stringify(defaultSkinContent('light'))
    })
    expect((updated.data as { skin: { content: { mode: string } } }).skin.content.mode).toBe('light')
    expect((updated.data as { skin: { name: string } }).skin.name).toBe('Assistant theme')

    const renamed = await handler.handle({
      version: 1,
      command: 'skin',
      args: ['rename', createdSkin.id, 'Renamed theme']
    })
    expect((renamed.data as { skin: { name: string } }).skin.name).toBe('Renamed theme')

    const duplicated = await handler.handle({
      version: 1,
      command: 'skin',
      args: ['duplicate', 'builtin.dark.neutral']
    })
    const duplicate = (duplicated.data as { skin: { id: string; name: string } }).skin
    expect(duplicate.name).toContain('copy')

    const exported = await handler.handle({
      version: 1,
      command: 'skin',
      args: ['export', createdSkin.id]
    })
    const exportedJson = (exported.data as { skinExport: { format: string; version: number } }).skinExport
    expect(exportedJson).toMatchObject({ format: 'cliloom-skin', version: 2 })
    const imported = await handler.handle({
      version: 1,
      command: 'skin',
      args: ['import', '--stdin'],
      stdin: exported.text
    })
    const importedSkin = (imported.data as { skin: { id: string } }).skin
    expect(importedSkin.id).not.toBe(createdSkin.id)

    settingsService.setActiveSkin(createdSkin.id)
    const deleted = await handler.handle({
      version: 1,
      command: 'skin',
      args: ['delete', createdSkin.id]
    })
    expect(deleted.data).toMatchObject({
      command: 'skin.delete',
      deleted: true,
      skinId: createdSkin.id,
      activeSkinId: 'builtin.light.neutral',
      appliesTo: 'settings'
    })
    expect(settingsService.getSnapshot().appearance.activeSkinId).toBe('builtin.light.neutral')
  })

  it('keeps builtin skins immutable and reports unknown ids', async () => {
    const { handler, settingsService: settings } = createHarness()

    await expect(handler.handle({
      version: 1,
      command: 'skin',
      args: ['update', 'builtin.dark.neutral', '--stdin'],
      stdin: JSON.stringify(defaultSkinContent('light'))
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    await expect(handler.handle({
      version: 1,
      command: 'skin',
      args: ['rename', 'builtin.dark.neutral', 'Nope']
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    await expect(handler.handle({
      version: 1,
      command: 'skin',
      args: ['delete', 'builtin.dark.neutral']
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    await expect(handler.handle({
      version: 1,
      command: 'skin',
      args: ['delete', 'user.missing']
    })).rejects.toMatchObject({ code: 'NOT_FOUND' })

    await expect(handler.handle({
      version: 1,
      command: 'skin',
      args: ['get', 'user.missing']
    })).rejects.toMatchObject({ code: 'NOT_FOUND' })

    await expect(handler.handle({
      version: 1,
      command: 'skin',
      args: ['create', '--stdin'],
      stdin: JSON.stringify({ name: 'X', content: defaultSkinContent('light'), id: 'user.hax' })
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })

    await expect(handler.handle({
      version: 1,
      command: 'skin',
      args: ['create', '--stdin'],
      stdin: 'null'
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })

    await expect(handler.handle({
      version: 1,
      command: 'skin',
      args: ['create', '--stdin'],
      stdin: '"just a string"'
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })

    const content = defaultSkinContent('dark')
    const createdSkin = settings.createUserSkin('Null payload target', content)
    await expect(handler.handle({
      version: 1,
      command: 'skin',
      args: ['update', createdSkin.id, '--stdin'],
      stdin: 'null'
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })

    await expect(handler.handle({
      version: 1,
      command: 'skin',
      args: ['update', 'builtin.dark.neutral', '--stdin'],
      stdin: 'not json'
    })).rejects.toMatchObject({ code: 'INVALID_JSON' })
  })

  it('normalizes numeric skin fields and reports the saved content', async () => {
    const { handler } = createHarness()
    const content = defaultSkinContent('dark')
    const exaggerated = {
      ...content,
      radius: 99,
      spacingScale: 12,
      typography: { ...content.typography, fontSize: 400, lineHeight: 0.1 }
    }

    const created = await handler.handle({
      version: 1,
      command: 'skin',
      args: ['create', '--stdin'],
      stdin: JSON.stringify({ name: 'Clamped', content: exaggerated })
    })
    const savedContent = (created.data as { skin: { content: typeof content } }).skin.content
    expect(savedContent.radius).toBeLessThanOrEqual(2)
    expect(savedContent.spacingScale).toBeLessThanOrEqual(2)
    expect(savedContent.typography.fontSize).toBeLessThanOrEqual(32)
    expect(savedContent.typography.lineHeight).toBeGreaterThanOrEqual(1)
  })

  it('lists installed font families through the injected service', async () => {
    const { handler, listInstalledFontFamilies } = createHarness()

    const result = await handler.handle({ version: 1, command: 'skin', args: ['fonts'] })
    expect(listInstalledFontFamilies).toHaveBeenCalledOnce()
    expect(result.data).toMatchObject({
      command: 'skin.fonts',
      fontFamilies: ['JetBrains Mono', 'DejaVu Sans Mono']
    })
    expect(result.text).toContain('JetBrains Mono')
  })
})

describe('assistant shell commands', () => {
  it('lists, refreshes, and selects through the coordination service', async () => {
    const { handler, shellConfiguration } = createHarness()

    const list = await handler.handle({ version: 1, command: 'shell', args: ['list'] })
    expect(shellConfiguration.list).toHaveBeenCalledOnce()
    expect(list.data).toMatchObject({
      command: 'shell.list',
      shell: { preferences: { selection: { mode: 'automatic' } } }
    })
    expect(list.text).toContain('posix:%2Fbin%2Fbash')

    const refreshed = await handler.handle({ version: 1, command: 'shell', args: ['refresh'] })
    expect(shellConfiguration.refresh).toHaveBeenCalledOnce()
    expect(refreshed.data).toMatchObject({ command: 'shell.refresh' })

    const selected = await handler.handle({
      version: 1,
      command: 'shell',
      args: ['select', 'posix:%2Fbin%2Fbash']
    })
    expect(shellConfiguration.select).toHaveBeenCalledWith('posix:%2Fbin%2Fbash')
    expect(selected.data).toMatchObject({
      command: 'shell.select',
      appliesTo: 'new-workflows-and-next-assistant-session'
    })
    expect(selected.text).toContain('running tasks keep their shell snapshot')
  })

  it('maps a saved-but-unavailable selection to a stable error', async () => {
    const { handler, shellConfiguration } = createHarness()
    shellConfiguration.select.mockRejectedValueOnce(
      new ShellSelectionAppliedButUnavailableError(new Error('PATH rebuild failed'))
    )

    await expect(handler.handle({
      version: 1,
      command: 'shell',
      args: ['select', 'posix:%2Fbin%2Fgone']
    })).rejects.toMatchObject({
      code: 'SHELL_SELECTION_APPLIED_BUT_UNAVAILABLE',
      exitCode: 2
    })
  })

  it('rejects malformed shell subcommands', async () => {
    const { handler } = createHarness()
    await expect(handler.handle({
      version: 1,
      command: 'shell',
      args: ['explode']
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })
})

describe('assistant initialization command validation', () => {
  it('validates an initialization command for the selected native target before saving', async () => {
    const target = detectedShell
    const { handler, setAssistantInitializationCommand } = createMockHandler({
      platform: 'linux',
      preferences: {
        version: 3,
        selection: {
          mode: 'explicit',
          shell: {
            kind: 'native',
            id: target.id,
            displayName: target.displayName,
            family: target.family,
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
      appliesNextSession: true,
      appliesTo: 'next-assistant-session'
    })
  })
})
