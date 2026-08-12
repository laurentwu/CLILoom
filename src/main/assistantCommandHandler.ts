import {
  PUBLIC_SETTING_DEFINITIONS,
  PUBLIC_SETTING_KEYS
} from '../shared/appSettings'
import { AppError } from '../shared/appError'
import type { AssistantBridgeRequest } from '../shared/assistant'
import { resolveAssistantCommand } from './assistantCommand'
import { readAssistantWorkspaceFile, type AssistantWorkspace } from './assistantWorkspace'
import type { ProjectRecord } from './database'
import { t } from './i18n'
import type { SettingsService } from './settingsService'
import {
  UserCancelledError,
  type WorkflowConfigService
} from './workflowConfigService'
import type { WorkflowDeleteImpact } from './database'
import type { ShellService } from './shellService'
import type { ResolvedExecutionTarget } from '../shared/shell'

const HELP_TEXT = `CLILoom assistant command

Usage:
  cliloom help
  cliloom context [--json]
  cliloom doctor [--json]
  cliloom workflow list [--json]
  cliloom workflow get <workflow-id> [--json]
  cliloom workflow validate (--stdin | --file <relative-path>) [--json]
  cliloom workflow save (--stdin | --file <relative-path>) [--expected-revision <revision>] [--json]
  cliloom workflow delete <workflow-id> [--json]
  cliloom project list [--json]
  cliloom project set-default-workflow <project-id> <workflow-id> [--json]
  cliloom settings list [--json]
  cliloom settings get <public-key> [--json]
  cliloom settings set <public-key> <value> [--json]`

export type AssistantCommandResult = {
  data: unknown
  text: string
}

export class AssistantCommandError extends AppError {
  readonly exitCode: number

  constructor(
    code: string,
    exitCode: number,
    message: string
  ) {
    super({ code, message })
    this.exitCode = exitCode
    this.name = 'AssistantCommandError'
  }
}

export class AssistantCommandHandler {
  constructor(private readonly options: {
    workflowService: WorkflowConfigService
    settingsService: SettingsService
    listProjects: () => ProjectRecord[]
    workspace: AssistantWorkspace
    appVersion: string
    environment: NodeJS.ProcessEnv
    shellService: ShellService
    confirmDelete: (impact: WorkflowDeleteImpact) => Promise<boolean>
  }) {}

  setEnvironment(environment: NodeJS.ProcessEnv): void {
    this.options.environment = environment
  }

  async handle(request: AssistantBridgeRequest): Promise<AssistantCommandResult> {
    const command = request.command || 'help'
    const args = request.args.filter((argument) => argument !== '--json')
    if (command === 'help' || command === '--help' || command === '-h') {
      this.requireArgs(args, 0)
      return this.result('help', { commands: HELP_TEXT.split('\n').slice(3) }, HELP_TEXT)
    }
    if (command === 'context') return this.context(args)
    if (command === 'doctor') return this.doctor(args)
    if (command === 'workflow') return this.workflow(args, request.stdin)
    if (command === 'project') return this.project(args)
    if (command === 'settings') return this.settings(args)
    throw new AssistantCommandError('UNKNOWN_COMMAND', 2, t('errors:assistantCommand.unknownCommand', { command }))
  }

  private context(args: string[]): AssistantCommandResult {
    this.requireArgs(args, 0)
    const settings = this.options.settingsService.listPublicSettings()
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
    const data = {
      appVersion: this.options.appVersion,
      capabilities: [
        'read and validate workflows',
        'create or revision-safe update workflows',
        'set project default workflows',
        'read and update public settings'
      ],
      publicSettings: PUBLIC_SETTING_KEYS.map((key) => ({
        key,
        value: settings[key],
        ...PUBLIC_SETTING_DEFINITIONS[key],
        ...(key === 'appearance.skin'
          ? { allowedValues: this.options.settingsService.listAvailableSkinIds() }
          : {})
      })),
      workflowSchema: {
        nodeTypes: [
          'start',
          'interactive-terminal',
          'non-interactive-terminal',
          'input',
          'exclusive-gateway',
          'parallel-gateway',
          'end'
        ],
        notes: [
          'A workflow has id, name, optional description, nodes, edges, and optional layout.',
          'Exactly one start node is required. References and node-specific config are validated.',
          'Use workflow get --json and pass its revision as --expected-revision when updating.'
        ]
      },
      projects,
      workflows,
      commands: HELP_TEXT.split('\n').slice(3)
    }
    const text = [
      `CLILoom ${this.options.appVersion} assistant context`,
      `${projects.length} project(s), ${workflows.length} workflow(s)`,
      '',
      'Public settings:',
      ...PUBLIC_SETTING_KEYS.map((key) => `  ${key} = ${settings[key] || '(not configured)'}`),
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
    if (action === 'validate') {
      const source = this.readWorkflowInput(args.slice(1), stdin, false)
      const workflow = this.parseWorkflowJson(source)
      const parsed = this.options.workflowService.validate(workflow)
      return this.result(
        'workflow.validate',
        { valid: true, workflowId: parsed.id },
        `Workflow ${parsed.id} is valid.`
      )
    }
    if (action === 'save') {
      const parsedOptions = this.readWorkflowInput(args.slice(1), stdin, true)
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
      return this.result(
        'settings.set',
        { key: args[1], value, appliesNextSession: args[1] === 'assistant.initializationCommand' },
        `${args[1]}=${value}${args[1] === 'assistant.initializationCommand' ? ' (applies to the next assistant session)' : ''}`
      )
    }
    throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.invalidSettingsSubcommand'))
  }

  private async resolveEffectiveTarget(): Promise<ResolvedExecutionTarget> {
    const service = this.options.shellService as ShellService & {
      resolveEffectiveTarget?: () => Promise<ResolvedExecutionTarget>
    }
    return service.resolveEffectiveTarget
      ? service.resolveEffectiveTarget()
      : service.resolveEffectiveShell()
  }

  private readWorkflowInput(
    args: string[],
    stdin: string | undefined,
    allowRevision: false
  ): string
  private readWorkflowInput(
    args: string[],
    stdin: string | undefined,
    allowRevision: true
  ): { content: string; expectedRevision?: number }
  private readWorkflowInput(
    args: string[],
    stdin: string | undefined,
    allowRevision: boolean
  ): string | { content: string; expectedRevision?: number } {
    let useStdin = false
    let filePath: string | undefined
    let expectedRevision: number | undefined
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index]
      if (argument === '--stdin') {
        if (useStdin) throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.stdinDuplicate'))
        useStdin = true
      } else if (argument === '--file') {
        if (filePath !== undefined || !args[index + 1]) {
          throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.fileRelative'))
        }
        filePath = args[index + 1]
        index += 1
      } else if (argument === '--expected-revision' && allowRevision) {
        const rawRevision = args[index + 1]
        const revision = Number(rawRevision)
        if (!rawRevision || !Number.isInteger(revision) || revision < 1) {
          throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.revisionPositive'))
        }
        expectedRevision = revision
        index += 1
      } else {
        throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.unknownArgument', { argument }))
      }
    }
    if (useStdin === Boolean(filePath)) {
      throw new AssistantCommandError('INVALID_ARGUMENT', 2, t('errors:assistantCommand.stdinOrFile'))
    }
    const content = useStdin
      ? stdin ?? ''
      : readAssistantWorkspaceFile(this.options.workspace.rootPath, filePath)
    return allowRevision ? { content, expectedRevision } : content
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

  private result(command: string, data: unknown, text: string): AssistantCommandResult {
    return {
      data: { version: 1, command, ...(isObject(data) ? data : { value: data }) },
      text
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
