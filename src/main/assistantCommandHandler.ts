import {
  PUBLIC_SETTING_DEFINITIONS,
  PUBLIC_SETTING_KEYS,
  type SkinContent
} from '../shared/appSettings'
import type { AssistantBridgeRequest } from '../shared/assistant'
import {
  ASSISTANT_CAPABILITY_SCHEMA_VERSION,
  ASSISTANT_COMMAND_DESCRIPTORS,
  CONTEXT_CAPABILITY_SUMMARIES,
  CONTEXT_LAYOUT_SUMMARY,
  CONTEXT_SHELL_SUMMARY_NOTES,
  CONTEXT_SKIN_SUMMARY,
  CONTEXT_TERMINAL_AUTO_RETRY_SUMMARY,
  CONTEXT_WORKFLOW_SCHEMA_NOTES,
  TERMINAL_AUTO_RETRY_SCHEMA,
  WORKFLOW_NODE_TYPES,
  buildAssistantHelpText,
  buildWorkflowSchema
} from '../shared/assistantCapabilities'
import {
  BUILTIN_SKINS,
  MAX_IMPORT_BYTES,
  getBuiltinSkin,
  type Skin,
  type UserSkin
} from '../shared/skin'
import type { ShellSnapshot } from '../shared/shell'
import type { TranslationKey } from '../shared/i18n/types'
import { resolveAssistantCommand } from './assistantCommand'
import {
  AssistantCommandError,
  parseAssistantCommandJson,
  readAssistantCommandInput,
  rejectUnknownFields,
  requireJsonObjectInput,
  requireRevision
} from './assistantCommandInput'
import { type AssistantWorkspace } from './assistantWorkspace'
import type { ProjectRecord } from './database'
import { t } from './i18n'
import type { SettingsService } from './settingsService'
import {
  UserCancelledError,
  type WorkflowConfigService
} from './workflowConfigService'
import type { WorkflowDeleteImpact } from './database'
import type { ShellService } from './shellService'
import {
  ShellSelectionAppliedButUnavailableError,
  type ShellConfigurationShellService
} from './shellConfigurationService'
import type { ResolvedExecutionTarget } from '../shared/shell'

export { AssistantCommandError }

const SKIN_CONTENT_KEYS = [
  'mode',
  'colors',
  'typography',
  'radius',
  'background',
  'spacingScale'
] as const

export type AssistantCommandResult = {
  data: unknown
  text: string
}

type AssistantSkinInfo = {
  id: string
  name: string
  builtin: boolean
  active: boolean
  content: SkinContent
}

export type AssistantCommandHandlerOptions = {
  workflowService: WorkflowConfigService
  settingsService: SettingsService
  listProjects: () => ProjectRecord[]
  workspace: AssistantWorkspace
  appVersion: string
  environment: NodeJS.ProcessEnv
  shellService: ShellService
  confirmDelete: (impact: WorkflowDeleteImpact) => Promise<boolean>
  shellConfiguration: ShellConfigurationShellService
  listInstalledFontFamilies: () => Promise<string[]>
}

export class AssistantCommandHandler {
  constructor(private readonly options: AssistantCommandHandlerOptions) {}

  setEnvironment(environment: NodeJS.ProcessEnv): void {
    this.options.environment = environment
  }

  async handle(request: AssistantBridgeRequest): Promise<AssistantCommandResult> {
    const command = request.command || 'help'
    const args = request.args.filter((argument) => argument !== '--json')
    if (command === 'help' || command === '--help' || command === '-h') {
      this.requireArgs(args, 0)
      return this.result(
        'help',
        { commands: this.usageLines() },
        buildAssistantHelpText()
      )
    }
    if (command === 'context') return this.context(args)
    if (command === 'doctor') return this.doctor(args)
    if (command === 'workflow') return this.workflow(args, request.stdin)
    if (command === 'project') return this.project(args)
    if (command === 'settings') return this.settings(args)
    if (command === 'shell') return this.shell(args)
    if (command === 'skin') return this.skin(args, request.stdin)
    throw new AssistantCommandError('UNKNOWN_COMMAND', 2, t('errors:assistantCommand.unknownCommand', { command }))
  }

  private usageLines(): string[] {
    return ASSISTANT_COMMAND_DESCRIPTORS.map((descriptor) => descriptor.usage)
  }

  private context(args: string[]): AssistantCommandResult {
    this.requireArgs(args, 0)
    const settings = this.options.settingsService.listPublicSettings()
    const snapshot = this.options.settingsService.getSnapshot()
    const workflows = this.options.workflowService.list().map((record) => ({
      id: record.workflow.id,
      name: record.workflow.name,
      revision: record.revision,
      description: record.workflow.description ?? ''
    }))
    const projects = this.options.listProjects().map((project) => ({
      id: project.id,
      name: project.name,
      path: project.path,
      defaultWorkflowId: project.default_workflow_id ?? null
    }))
    const shellSnapshot = this.options.shellService.getSnapshot()
    const userSkins = snapshot.skins
    const data = {
      appVersion: this.options.appVersion,
      schemaVersion: ASSISTANT_CAPABILITY_SCHEMA_VERSION,
      capabilities: CONTEXT_CAPABILITY_SUMMARIES,
      commandDescriptors: ASSISTANT_COMMAND_DESCRIPTORS.map((descriptor) => ({
        id: descriptor.id,
        usage: descriptor.usage,
        summary: descriptor.summary,
        appliesTo: descriptor.appliesTo,
        ...(descriptor.input ? { input: descriptor.input } : {})
      })),
      publicSettings: PUBLIC_SETTING_KEYS.map((key) => ({
        key,
        value: settings[key],
        ...PUBLIC_SETTING_DEFINITIONS[key],
        ...(key === 'appearance.skin'
          ? { allowedValues: this.options.settingsService.listAvailableSkinIds() }
          : {})
      })),
      workflowSchema: {
        nodeTypes: WORKFLOW_NODE_TYPES,
        notes: CONTEXT_WORKFLOW_SCHEMA_NOTES,
        schemaCommand: 'cliloom workflow schema --json',
        terminalAutoRetry: CONTEXT_TERMINAL_AUTO_RETRY_SUMMARY
      },
      shell: {
        selection: shellSnapshot.preferences.selection.mode,
        effective: shellSnapshot.effectiveShell
          ? {
              id: shellSnapshot.effectiveShell.id,
              displayName: shellSnapshot.effectiveShell.displayName,
              executablePath: shellSnapshot.effectiveShell.executablePath
            }
          : null,
        candidates: shellSnapshot.candidates.map((candidate) => ({
          id: candidate.id,
          displayName: candidate.displayName,
          executablePath: candidate.executablePath
        })),
        notes: CONTEXT_SHELL_SUMMARY_NOTES
      },
      skins: {
        activeSkinId: snapshot.appearance.activeSkinId,
        builtinSkinIds: BUILTIN_SKINS.map((skin) => skin.id),
        userSkinIds: userSkins.map((skin) => skin.id),
        summary: CONTEXT_SKIN_SUMMARY
      },
      layout: CONTEXT_LAYOUT_SUMMARY,
      projects,
      workflows,
      commands: this.usageLines()
    }
    const shellLine = shellSnapshot.effectiveShell
      ? `${shellSnapshot.effectiveShell.displayName} (${shellSnapshot.effectiveShell.executablePath})`
      : t('assistant:cli.contextShellUnavailable', { error: shellSnapshot.error ?? 'no error detail' })
    const text = [
      `CLILoom ${this.options.appVersion} assistant context`,
      `${projects.length} project(s), ${workflows.length} workflow(s)`,
      '',
      'Public settings:',
      ...PUBLIC_SETTING_KEYS.map((key) => `  ${key} = ${settings[key] || '(not configured)'}`),
      '',
      t('assistant:cli.contextShellLine', {
        selection: shellSnapshot.preferences.selection.mode,
        detail: shellLine
      }),
      t('assistant:cli.contextSkinsLine', {
        builtinCount: BUILTIN_SKINS.length,
        userCount: userSkins.length,
        activeSkinId: snapshot.appearance.activeSkinId
      }),
      '',
      t('assistant:cli.contextCapabilitiesTitle'),
      `  ${t('assistant:cli.contextCapabilityWorkflowSchema')}`,
      `  ${t('assistant:cli.contextCapabilityAutoRetry')}`,
      `  ${t('assistant:cli.contextCapabilityShell')}`,
      `  ${t('assistant:cli.contextCapabilitySkin')}`,
      `  ${t('assistant:cli.contextCapabilityLayout')}`,
      '',
      'Run `cliloom help` for commands. Use --json for structured output.'
    ].join('\n')
    return this.result('context', data, text)
  }

  private async doctor(args: string[]): Promise<AssistantCommandResult> {
    this.requireArgs(args, 0)
    const config = this.options.settingsService.getSnapshot().assistant
    let target: ResolvedExecutionTarget | null = null
    try {
      const service = this.options.shellService as ShellService & {
        resolveEffectiveTarget?: () => Promise<ResolvedExecutionTarget>
      }
      target = service.resolveEffectiveTarget
        ? await service.resolveEffectiveTarget()
        : service.resolveEffectiveShell()
    } catch {
      // The target snapshot below carries the selection failure.
    }
    let command: Record<string, unknown>
    try {
      if (!target) throw new Error(t('errors:shell.noneDetectedPlatformShort', { platform: process.platform }))
      const resolved = resolveAssistantCommand(config.initializationCommand, this.options.environment)
      command = {
        configured: true,
        available: true,
        executablePath: resolved.executablePath,
        ...(resolved.versionOutput ? { version: resolved.versionOutput } : {})
      }
    } catch (error) {
      command = {
        configured: Boolean(config.initializationCommand),
        available: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
    const shellSnapshot = this.options.shellService.getSnapshot()
    const shell = target ?? shellSnapshot.effectiveShell
    const workspaceStatus = this.options.workspace.inspect()
    const configuredShell = shellSnapshot.preferences.selection.mode === 'explicit'
      ? shellSnapshot.preferences.selection.shell
      : null
    const data = {
      platform: process.platform,
      shell: {
        selection: shellSnapshot.preferences.selection.mode,
        configuredKind: configuredShell?.kind ?? null,
        configuredDisplayName: configuredShell?.displayName ?? null,
        configuredFamily: configuredShell?.family ?? null,
        configuredExecutablePath: configuredShell?.executablePath ?? null,
        available: Boolean(shell),
        kind: shell ? 'native' : null,
        displayName: shell?.displayName ?? null,
        family: shell?.family ?? null,
        executablePath: shell?.executablePath ?? null,
        error: shellSnapshot.error ?? null
      },
      pathConfigured: Boolean(this.options.environment.PATH || this.options.environment.Path),
      workspace: {
        path: this.options.workspace.rootPath,
        launcher: this.options.workspace.launcherPath,
        available: true,
        ...workspaceStatus
      },
      bridge: { connected: true },
      command
    }
    const shellDetail = shell
      ? `${shell.displayName} (${shell.executablePath})`
      : `ERROR (${shellSnapshot.error})`
    const text = [
      `Platform: ${data.platform}`,
      `Terminal environment: ${shellDetail}`,
      `Build: ${workspaceStatus.buildId}`,
      `Workspace: ${workspaceStatus.synchronized ? 'OK' : 'ERROR'} (${data.workspace.path}, v${workspaceStatus.workspaceVersion})`,
      'Bridge: OK',
      `Initialization command: ${command.available ? 'OK' : `ERROR (${command.error})`}`
    ].join('\n')
    return this.result('doctor', data, text)
  }

  private async workflow(args: string[], stdin: string | undefined): Promise<AssistantCommandResult> {
    const action = args[0]
    if (action === 'list') {
      this.requireArgs(args.slice(1), 0)
      const workflows = this.options.workflowService.list().map((record) => ({
        id: record.workflow.id,
        name: record.workflow.name,
        description: record.workflow.description ?? '',
        revision: record.revision,
        updatedAt: record.updatedAt
      }))
      return this.result(
        'workflow.list',
        { workflows },
        workflows.length
          ? workflows.map((workflow) => `${workflow.id}\t${workflow.revision}\t${workflow.name}`).join('\n')
          : 'No workflows.'
      )
    }
    if (action === 'get') {
      this.requireArgs(args.slice(1), 1)
      const record = this.options.workflowService.get(args[1])
      if (!record) throw new AssistantCommandError('NOT_FOUND', 3, t('errors:assistantCommand.workflowNotFound'))
      return this.result(
        'workflow.get',
        { workflow: record.workflow, revision: record.revision },
        JSON.stringify({ workflow: record.workflow, revision: record.revision }, null, 2)
      )
    }
    if (action === 'schema') {
      this.requireArgs(args.slice(1), 0)
      const schema = buildWorkflowSchema()
      const text = [
        t('assistant:cli.schemaTitle', { version: schema.schemaVersion }),
        '',
        t('assistant:cli.schemaNodes'),
        ...WORKFLOW_NODE_TYPES.map((type) => `  ${type}`),
        '',
        t('assistant:cli.schemaAutoRetryTitle'),
        `  ${t('assistant:cli.schemaSetLabel', { command: TERMINAL_AUTO_RETRY_SCHEMA.setCommand })}`,
        `  ${t('assistant:cli.schemaModes', { delays: TERMINAL_AUTO_RETRY_SCHEMA.recommendedDelays })}`,
        `  ${t('assistant:cli.schemaMaxRetries', {
          min: CONTEXT_TERMINAL_AUTO_RETRY_SUMMARY.maxRetriesRange[0],
          max: CONTEXT_TERMINAL_AUTO_RETRY_SUMMARY.maxRetriesRange[1],
          default: CONTEXT_TERMINAL_AUTO_RETRY_SUMMARY.defaultMaxRetries
        })}`,
        `  ${t('assistant:cli.schemaApplies')}`,
        '',
        t('assistant:cli.schemaNotes'),
        ...schema.notes.map((note) => `  - ${note}`),
        '',
        t('assistant:cli.schemaJsonHint')
      ].join('\n')
      return this.result('workflow.schema', schema, text)
    }
    if (action === 'validate') {
      const source = readAssistantCommandInput({
        args: args.slice(1),
        stdin,
        workspaceRoot: this.options.workspace.rootPath
      })
      const workflow = this.parseWorkflowJson(source.content)
      const parsed = this.options.workflowService.validate(workflow)
      return this.result(
        'workflow.validate',
        { valid: true, workflowId: parsed.id },
        `Workflow ${parsed.id} is valid.`
      )
    }
    if (action === 'save') {
      const parsedOptions = readAssistantCommandInput({
        args: args.slice(1),
        stdin,
        workspaceRoot: this.options.workspace.rootPath,
        allowRevision: true
      })
      const workflow = this.parseWorkflowJson(parsedOptions.content)
      const saved = this.options.workflowService.save(
        workflow,
        parsedOptions.expectedRevision,
        'assistant'
      )
      return this.result(
        'workflow.save',
        { workflow: saved.workflow, revision: saved.revision, created: saved.created },
        `${saved.created ? 'Created' : 'Updated'} workflow ${saved.workflow.id} at revision ${saved.revision}.`
      )
    }
    if (action === 'delete') {
      this.requireArgs(args.slice(1), 1)
      try {
        const event = await this.options.workflowService.confirmAndDelete(
          args[1],
          this.options.confirmDelete
        )
        return this.result(
          'workflow.delete',
          { deleted: true, workflowId: event.id, revision: event.revision },
          `Deleted workflow ${event.id}.`
        )
      } catch (error) {
        if (error instanceof UserCancelledError) {
          throw new AssistantCommandError(error.code, 4, error.message)
        }
        throw error
      }
    }
    if (action === 'auto-retry') return this.workflowAutoRetry(args.slice(1), stdin)
    throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.invalidWorkflowSubcommand'))
  }

  private workflowAutoRetry(args: string[], stdin: string | undefined): AssistantCommandResult {
    const action = args[0]
    if (action === 'get') {
      this.requireArgs(args.slice(1), 2)
      const info = this.options.workflowService.getTerminalAutoRetry(args[1], args[2])
      return this.result(
        'workflow.auto-retry.get',
        { ...info, appliesTo: 'future-workflow-runs' },
        [
          t('assistant:cli.autoRetryGetLine', {
            workflowId: info.workflowId,
            revision: info.revision,
            nodeId: info.nodeId,
            nodeType: info.nodeType
          }),
          info.autoRetry === null
            ? t('assistant:cli.autoRetryNotConfigured')
            : `autoRetry: ${JSON.stringify(info.autoRetry)}`
        ].join('\n')
      )
    }
    if (action === 'set') {
      const [workflowId, nodeId] = this.requirePositionals(args, 2)
      const source = readAssistantCommandInput({
        args: args.slice(3),
        stdin,
        workspaceRoot: this.options.workspace.rootPath,
        allowRevision: true
      })
      const expectedRevision = requireRevision(source)
      const input = parseAssistantCommandJson(source.content)
      const saved = this.options.workflowService.setTerminalAutoRetry(
        workflowId,
        nodeId,
        input,
        expectedRevision
      )
      return this.result(
        'workflow.auto-retry.set',
        {
          workflowId: saved.workflow.id,
          nodeId,
          nodeType: saved.nodeType,
          revision: saved.revision,
          autoRetry: saved.autoRetry,
          appliesTo: 'future-workflow-runs'
        },
        saved.autoRetry === null
          ? t('assistant:cli.autoRetrySetRemoved', {
            nodeId,
            workflowId: saved.workflow.id,
            revision: saved.revision
          })
          : t('assistant:cli.autoRetrySetSaved', {
            nodeId,
            workflowId: saved.workflow.id,
            revision: saved.revision,
            config: JSON.stringify(saved.autoRetry)
          })
      )
    }
    throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.invalidWorkflowSubcommand'))
  }

  private project(args: string[]): AssistantCommandResult {
    const action = args[0]
    if (action === 'list') {
      this.requireArgs(args.slice(1), 0)
      const projects = this.options.listProjects().map((project) => ({
        id: project.id,
        name: project.name,
        path: project.path,
        defaultWorkflowId: project.default_workflow_id ?? null
      }))
      return this.result(
        'project.list',
        { projects },
        projects.length
          ? projects.map((project) => `${project.id}\t${project.name}\t${project.defaultWorkflowId ?? '-'}`).join('\n')
          : 'No projects.'
      )
    }
    if (action === 'set-default-workflow') {
      this.requireArgs(args.slice(1), 2)
      this.options.workflowService.setProjectDefault(args[1], args[2])
      return this.result(
        'project.set-default-workflow',
        { projectId: args[1], workflowId: args[2] },
        `Project ${args[1]} now uses workflow ${args[2]} by default.`
      )
    }
    throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.invalidProjectSubcommand'))
  }

  private async settings(args: string[]): Promise<AssistantCommandResult> {
    const action = args[0]
    if (action === 'list') {
      this.requireArgs(args.slice(1), 0)
      const settings = this.options.settingsService.listPublicSettings()
      return this.result(
        'settings.list',
        { settings },
        PUBLIC_SETTING_KEYS.map((key) => `${key}=${settings[key]}`).join('\n')
      )
    }
    if (action === 'get') {
      this.requireArgs(args.slice(1), 1)
      const value = this.options.settingsService.getPublicSetting(args[1])
      return this.result('settings.get', { key: args[1], value }, value)
    }
    if (action === 'set') {
      this.requireArgs(args.slice(1), 2)
      let value: string
      if (args[1] === 'assistant.initializationCommand') {
        await this.resolveEffectiveTarget()
        const resolved = resolveAssistantCommand(args[2], this.options.environment)
        value = this.options.settingsService
          .setAssistantInitializationCommand(args[2], resolved)
          .config.initializationCommand
      } else {
        value = this.options.settingsService.setPublicSetting(args[1], args[2])
      }
      const appliesNextSession = args[1] === 'assistant.initializationCommand'
      const appliesTo = appliesNextSession
        ? 'next-assistant-session'
        : args[1].startsWith('layout.')
          ? 'immediate'
          : 'settings'
      return this.result(
        'settings.set',
        { key: args[1], value, appliesNextSession, appliesTo },
        `${args[1]}=${value}${appliesNextSession ? ' (applies to the next assistant session)' : ''}`
      )
    }
    throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.invalidSettingsSubcommand'))
  }

  private async shell(args: string[]): Promise<AssistantCommandResult> {
    const action = args[0]
    if (action === 'list') {
      this.requireArgs(args.slice(1), 0)
      const snapshot = this.options.shellConfiguration.list()
      return this.result('shell.list', { shell: snapshot }, formatShellSnapshot(snapshot))
    }
    if (action === 'refresh') {
      this.requireArgs(args.slice(1), 0)
      const snapshot = await this.options.shellConfiguration.refresh()
      return this.result('shell.refresh', { shell: snapshot }, formatShellSnapshot(snapshot))
    }
    if (action === 'select') {
      this.requireArgs(args.slice(1), 1)
      let snapshot: ShellSnapshot
      try {
        snapshot = await this.options.shellConfiguration.select(args[1])
      } catch (error) {
        if (error instanceof ShellSelectionAppliedButUnavailableError) {
          throw new AssistantCommandError(error.code, error.exitCode, error.message)
        }
        throw error
      }
      return this.result(
        'shell.select',
        {
          shell: snapshot,
          appliesTo: 'new-workflows-and-next-assistant-session'
        },
        [
          formatShellSnapshot(snapshot),
          t('assistant:cli.shellSelectApplies')
        ].join('\n')
      )
    }
    throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.invalidShellSubcommand'))
  }

  private async skin(args: string[], stdin: string | undefined): Promise<AssistantCommandResult> {
    const action = args[0]
    const settings = this.options.settingsService
    if (action === 'list') {
      this.requireArgs(args.slice(1), 0)
      const snapshot = settings.getSnapshot()
      const activeId = snapshot.appearance.activeSkinId
      const skins = [
        ...BUILTIN_SKINS.map((skin) => this.describeSkinSummary(skin, activeId)),
        ...snapshot.skins.map((skin) => this.describeSkinSummary(skin, activeId))
      ]
      return this.result(
        'skin.list',
        { skins },
        skins.map((skin) => (
          `${skin.id}\t${skin.name}${skin.builtin ? '\tbuiltin' : ''}${skin.active ? '\tactive' : ''}`
        )).join('\n')
      )
    }
    if (action === 'get') {
      this.requireArgs(args.slice(1), 1)
      const skin = this.findSkin(args[1])
      const info = this.describeSkin(skin)
      return this.result(
        'skin.get',
        { skin: info },
        JSON.stringify(info, null, 2)
      )
    }
    if (action === 'create') {
      const input = this.readSkinJsonInput(args.slice(1), stdin)
      requireJsonObjectInput(input)
      rejectUnknownFields(input, ['name', 'content'], 'skin create')
      const body = input as { name?: unknown; content?: unknown }
      const skin = settings.createUserSkin(body.name, body.content)
      return this.result(
        'skin.create',
        { skin: this.describeSkin(skin), appliesTo: 'settings' },
        t('assistant:cli.skinCreated', { id: skin.id, name: skin.name })
      )
    }
    if (action === 'update') {
      const [skinId] = this.requirePositionals(args, 1)
      const input = this.readSkinJsonInput(args.slice(2), stdin)
      requireJsonObjectInput(input)
      rejectUnknownFields(input, SKIN_CONTENT_KEYS, 'skin update')
      this.requireUserSkin(skinId)
      const skin = settings.updateUserSkin(skinId, input)
      return this.result(
        'skin.update',
        { skin: this.describeSkin(skin), appliesTo: 'settings' },
        t('assistant:cli.skinUpdated', { id: skin.id, name: skin.name })
      )
    }
    if (action === 'duplicate') {
      this.requireArgs(args.slice(1), 1)
      this.findSkin(args[1])
      const skin = settings.duplicateSkin(args[1])
      return this.result(
        'skin.duplicate',
        { skin: this.describeSkin(skin), appliesTo: 'settings' },
        t('assistant:cli.skinDuplicated', { sourceId: args[1], id: skin.id, name: skin.name })
      )
    }
    if (action === 'rename') {
      this.requireArgs(args.slice(1), 2)
      this.requireUserSkin(args[1])
      const skin = settings.renameUserSkin(args[1], args[2])
      return this.result(
        'skin.rename',
        { skin: this.describeSkin(skin), appliesTo: 'settings' },
        t('assistant:cli.skinRenamed', { id: skin.id, name: skin.name })
      )
    }
    if (action === 'delete') {
      this.requireArgs(args.slice(1), 1)
      this.requireUserSkin(args[1])
      settings.deleteUserSkin(args[1])
      const activeSkinId = settings.getSnapshot().appearance.activeSkinId
      return this.result(
        'skin.delete',
        { deleted: true, skinId: args[1], activeSkinId, appliesTo: 'settings' },
        t('assistant:cli.skinDeleted', { id: args[1], activeId: activeSkinId })
      )
    }
    if (action === 'import') {
      const source = readAssistantCommandInput({
        args: args.slice(1),
        stdin,
        workspaceRoot: this.options.workspace.rootPath,
        maxBytes: MAX_IMPORT_BYTES
      })
      const skin = settings.importSkin(source.content)
      return this.result(
        'skin.import',
        { skin: this.describeSkin(skin), appliesTo: 'settings' },
        t('assistant:cli.skinImported', { id: skin.id, name: skin.name })
      )
    }
    if (action === 'export') {
      this.requireArgs(args.slice(1), 1)
      this.findSkin(args[1])
      const json = settings.exportSkin(args[1])
      let parsed: unknown
      try {
        parsed = JSON.parse(json) as unknown
      } catch {
        throw new AssistantCommandError('VALIDATION_ERROR', 2, t('errors:assistantCommand.inputJsonInvalid'))
      }
      return this.result(
        'skin.export',
        { skinId: args[1], skinExport: parsed },
        json
      )
    }
    if (action === 'fonts') {
      this.requireArgs(args.slice(1), 0)
      const fontFamilies = await this.options.listInstalledFontFamilies()
      return this.result(
        'skin.fonts',
        { fontFamilies },
        fontFamilies.length ? fontFamilies.join('\n') : t('assistant:cli.skinNoFonts')
      )
    }
    throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.invalidSkinSubcommand'))
  }

  private readSkinJsonInput(args: string[], stdin: string | undefined): unknown {
    const source = readAssistantCommandInput({
      args,
      stdin,
      workspaceRoot: this.options.workspace.rootPath,
      maxBytes: MAX_IMPORT_BYTES
    })
    return parseAssistantCommandJson(source.content)
  }

  private findSkin(id: string): Skin {
    const builtin = getBuiltinSkin(id)
    if (builtin) return builtin
    const user = this.options.settingsService.getSnapshot().skins.find((skin) => skin.id === id)
    if (user) return user
    throw new AssistantCommandError('NOT_FOUND', 3, t('errors:assistantCommand.skinNotFound'))
  }

  private requireUserSkin(id: string): UserSkin {
    if (getBuiltinSkin(id)) {
      throw new AssistantCommandError('VALIDATION_ERROR', 2, t('errors:assistantCommand.skinBuiltinImmutable'))
    }
    const skin = this.options.settingsService.getSnapshot().skins.find((candidate) => candidate.id === id)
    if (!skin) throw new AssistantCommandError('NOT_FOUND', 3, t('errors:assistantCommand.skinNotFound'))
    return skin
  }

  private describeSkin(skin: Skin): AssistantSkinInfo {
    const activeId = this.options.settingsService.getSnapshot().appearance.activeSkinId
    return {
      id: skin.id,
      name: skin.builtin ? t(skin.nameKey as TranslationKey) : skin.name,
      builtin: skin.builtin,
      active: skin.id === activeId,
      content: {
        mode: skin.mode,
        colors: skin.colors,
        typography: skin.typography,
        radius: skin.radius,
        background: skin.background,
        spacingScale: skin.spacingScale
      }
    }
  }

  private describeSkinSummary(
    skin: Skin,
    activeId: string
  ): { id: string; name: string; builtin: boolean; active: boolean } {
    return {
      id: skin.id,
      name: skin.builtin ? t(skin.nameKey as TranslationKey) : skin.name,
      builtin: skin.builtin,
      active: skin.id === activeId
    }
  }

  private async resolveEffectiveTarget(): Promise<ResolvedExecutionTarget> {
    const service = this.options.shellService as ShellService & {
      resolveEffectiveTarget?: () => Promise<ResolvedExecutionTarget>
    }
    return service.resolveEffectiveTarget
      ? service.resolveEffectiveTarget()
      : service.resolveEffectiveShell()
  }

  private parseWorkflowJson(source: string): unknown {
    if (!source.trim()) throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.workflowJsonEmpty'))
    try {
      return JSON.parse(source) as unknown
    } catch {
      throw new AssistantCommandError('INVALID_JSON', 2, t('errors:assistantCommand.workflowJsonParse'))
    }
  }

  private requireArgs(args: string[], count: number): void {
    if (args.length !== count) {
      throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.argCount', { count }))
    }
  }

  /**
   * Extract leading positional arguments (before any --flag). Commands whose
   * usage places flags after the positionals use this instead of requireArgs.
   */
  private requirePositionals(args: string[], count: number): string[] {
    const positional: string[] = []
    for (let index = 1; index < args.length && positional.length < count; index += 1) {
      const argument = args[index]
      if (!argument || argument.startsWith('--')) break
      positional.push(argument)
    }
    if (positional.length !== count) {
      throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.argCount', { count }))
    }
    return positional
  }

  private result(command: string, data: unknown, text: string): AssistantCommandResult {
    return {
      data: { version: 1, command, ...(isObject(data) ? data : { value: data }) },
      text
    }
  }
}

function formatShellSnapshot(snapshot: ShellSnapshot): string {
  const selection = snapshot.preferences.selection.mode === 'automatic'
    ? 'automatic'
    : `explicit (${snapshot.preferences.selection.shell.displayName})`
  const effective = snapshot.effectiveShell
    ? `${snapshot.effectiveShell.displayName} (${snapshot.effectiveShell.executablePath})`
    : `${t('assistant:cli.shellUnavailable')}${snapshot.error ? ` (${snapshot.error})` : ''}`
  return [
    t('assistant:cli.shellSelection', { selection }),
    t('assistant:cli.shellEffective', { detail: effective }),
    ...(snapshot.candidates.length
      ? [
          t('assistant:cli.shellCandidates'),
          ...snapshot.candidates.map((candidate) => (
            `  ${candidate.id}\t${candidate.displayName}\t${candidate.executablePath}`
          ))
        ]
      : [t('assistant:cli.shellNoCandidates')])
  ].join('\n')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
