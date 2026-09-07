import { createHash } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import { ensureWorkflowVersion, type AppDatabase } from './database'
import { t } from './i18n'
import type { ProcessRunner } from './processRunner'
import {
  persistWorkflowRuntimeState,
  readWorkflowRuntimeState,
  restoreWorkflowRuntimeState,
  type RuntimeRestoreResult
} from './runtimePersistence'
import {
  WorkflowRuntimeEngine,
  type WorkflowRuntimeAdapter,
  type WorkflowRuntimeState,
  type WorkflowRuntimeStatus,
  type WorkflowRuntimeStartOptions
} from '../shared/workflowRuntime'
import {
  parseWorkflowDefinition,
  parseWorkflowDefinitionStructure,
  type VariableValue,
  type WorkflowDefinition
} from '../shared/workflow'
import {
  toExecutionTargetDescriptor,
  type ExecutionTargetDescriptor,
  type ResolvedExecutionTarget,
  type WorkflowExecutionContext
} from '../shared/shell'
import type { TerminalRetryMode } from '../shared/terminalSession'
import {
  bindTerminalCommandTemplate,
  restoreTerminalCommandTemplate,
  TerminalRetryTemplateError,
  type TerminalCommandTemplateSnapshot,
  type TerminalRetryDraft,
  type TerminalRetryEdit
} from '../shared/terminalRetry'
import type { ProcessRetrySource } from './processRunner'

type WorkflowExecutionTargetService = {
  resolveEffectiveTarget: () => Promise<ResolvedExecutionTarget>
  resolveTarget: (target: ExecutionTargetDescriptor) => Promise<ResolvedExecutionTarget>
  resolveTargetPath: (target: ResolvedExecutionTarget, value: string) => Promise<string>
  resolveProjectPath?: (target: ResolvedExecutionTarget, value: string) => Promise<string>
}

export type WorkflowRuntimeStartRequest = Omit<WorkflowRuntimeStartOptions, 'projectDir'> & {
  projectDir?: string
}

type PreparedTerminalRetryDraft = {
  draft: TerminalRetryDraft
  snapshot: TerminalCommandTemplateSnapshot
  source: ProcessRetrySource
}

export class WorkflowRuntimeService {
  private readonly engines = new Map<string, WorkflowRuntimeEngine>()
  private readonly pendingTerminalRetries = new Set<string>()
  private readonly taskOperations = new Map<string, Promise<void>>()
  private readonly cancelledTaskLaunches = new Set<string>()
  private shuttingDown = false
  private shutdownPromise: Promise<void> | null = null

  constructor(
    private readonly db: AppDatabase,
    private readonly processRunner: ProcessRunner,
    private readonly getWindow: () => BrowserWindow | null,
    private readonly onTaskTerminal?: () => void,
    private readonly executionTargets?: WorkflowExecutionTargetService
  ) {}

  async start(options: WorkflowRuntimeStartRequest): Promise<WorkflowRuntimeState> {
    return this.serializeTask(options.taskId, () => this.startInternal(options))
  }

  private async startInternal(
    options: WorkflowRuntimeStartRequest
  ): Promise<WorkflowRuntimeState> {
    this.assertRuntimeAvailable()
    this.cancelledTaskLaunches.delete(options.taskId)
    const workflow = parseWorkflowDefinition(options.workflow)
    const project = this.db.prepare('select id, path from projects where id = ?').get(options.projectId) as
      { id: string; path: string } | undefined
    if (!project && this.executionTargets) throw new Error(t('errors:database.projectNotFound'))
    const hostProjectDir = project?.path ?? options.projectDir
    if (!hostProjectDir) throw new Error(t('errors:database.projectNotFound'))
    let executionContext: WorkflowExecutionContext | undefined
    let targetProjectDir = hostProjectDir
    if (this.executionTargets) {
      const target = await this.executionTargets.resolveEffectiveTarget()
      targetProjectDir = this.executionTargets.resolveProjectPath
        ? await this.executionTargets.resolveProjectPath(target, hostProjectDir)
        : await this.executionTargets.resolveTargetPath(target, hostProjectDir)
      executionContext = {
        version: 1,
        target: toExecutionTargetDescriptor(target),
        hostProjectDir,
        targetProjectDir
      }
    }
    const startOptions: WorkflowRuntimeStartOptions = {
      ...options,
      workflow,
      projectDir: targetProjectDir,
      ...(executionContext ? { executionContext } : {}),
      translator: t
    }
    const active = this.engines.get(options.taskId)
    if (!active) await this.processRunner.killByTask(options.taskId)
    this.assertRuntimeAvailable()
    const persisted = active ? null : this.restoreWithoutActiveEngine(options.taskId).state
    const existingStatus = active?.getState().status ?? persisted?.status
    if (existingStatus === 'running' || existingStatus === 'waiting-input') {
      throw new Error(t('errors:workflowRuntime.stillRunning'))
    }

    const workflowVersion = ensureWorkflowVersion(this.db, workflow)
    const engine = new WorkflowRuntimeEngine(
      startOptions,
      this.createAdapter(workflow, workflowVersion)
    )
    const task = persistWorkflowRuntimeState(
      this.db,
      engine.getState(),
      'running',
      workflow,
      workflowVersion
    )
    this.engines.set(options.taskId, engine)
    this.runEngineOperation(options.taskId, engine, 'start', () => engine.start())
    return { ...engine.getState(), task }
  }

  async updateVariables(
    taskId: string,
    variables: Record<string, VariableValue>,
    branchId?: string
  ): Promise<WorkflowRuntimeState | null> {
    return this.serializeTask(
      taskId,
      () => this.updateVariablesInternal(taskId, variables, branchId)
    )
  }

  private async updateVariablesInternal(
    taskId: string,
    variables: Record<string, VariableValue>,
    branchId?: string
  ): Promise<WorkflowRuntimeState | null> {
    this.assertRuntimeAvailable()
    let engine = this.engines.get(taskId)
    if (!engine) {
      await this.restoreInternal(taskId)
      engine = this.engines.get(taskId)
    }
    if (!engine) return null
    this.runEngineOperation(
      taskId,
      engine,
      'updateVariables',
      () => engine.updateVariables(variables, branchId)
    )
    return engine.getState()
  }

  async stop(taskId: string): Promise<WorkflowRuntimeState | null> {
    return this.serializeTask(taskId, () => this.stopInternal(taskId))
  }

  private async stopInternal(taskId: string): Promise<WorkflowRuntimeState | null> {
    this.cancelledTaskLaunches.add(taskId)
    const engine = this.engines.get(taskId)
    if (!engine) {
      await this.processRunner.killByTask(taskId)
      return null
    }
    try {
      await engine.stop()
      return engine.getState()
    } finally {
      this.releaseEngineIfTerminal(taskId, engine)
    }
  }

  private async interruptInternal(taskId: string): Promise<WorkflowRuntimeState | null> {
    this.cancelledTaskLaunches.add(taskId)
    const engine = this.engines.get(taskId)
    if (!engine) {
      await this.processRunner.killByTask(taskId, 'interrupted')
      return null
    }
    try {
      await engine.interrupt()
      return engine.getState()
    } finally {
      this.releaseEngineIfTerminal(taskId, engine)
    }
  }

  getState(taskId: string): WorkflowRuntimeState | null {
    return this.engines.get(taskId)?.getState() ?? null
  }

  hasActiveTasks(): boolean {
    return this.engines.size > 0 ||
      this.taskOperations.size > 0 ||
      this.pendingTerminalRetries.size > 0
  }

  async retryNode(
    taskId: string,
    nodeId: string,
    branchId?: string
  ): Promise<WorkflowRuntimeState> {
    return this.serializeTask(taskId, () => this.retryNodeInternal(taskId, nodeId, branchId))
  }

  private async retryNodeInternal(
    taskId: string,
    nodeId: string,
    branchId?: string
  ): Promise<WorkflowRuntimeState> {
    this.assertRuntimeAvailable()
    this.cancelledTaskLaunches.delete(taskId)
    const engine = this.getEngineForNodeRetry(taskId, nodeId, branchId)
    if (!engine) throw new Error(t('errors:workflowRuntime.nodeStateChanged'))

    const started = await engine.beginNodeRetry(nodeId, branchId)
    if (!started) {
      this.releaseEngineIfTerminal(taskId, engine)
      throw new Error(t('errors:workflowRuntime.nodeStateChanged'))
    }
    this.assertRuntimeAvailable()
    this.engines.set(taskId, engine)
    this.runEngineOperation(
      taskId,
      engine,
      'retryNode',
      () => engine.continueNodeRetry(nodeId, branchId)
    )
    return engine.getState()
  }

  async retryTerminal(
    sessionId: string,
    mode: TerminalRetryMode | 'auto' = 'auto',
    edit?: TerminalRetryEdit
  ): Promise<string> {
    this.assertRuntimeAvailable()
    if (this.pendingTerminalRetries.has(sessionId)) {
      throw new Error(t('errors:workflowRuntime.retryAlreadyQueued'))
    }

    const target = this.processRunner.getRetryTarget(sessionId)
    this.cancelledTaskLaunches.delete(target.taskId)
    this.pendingTerminalRetries.add(sessionId)

    try {
      return await this.serializeTask(
        target.taskId,
        () => this.retryTerminalInternal(sessionId, target, mode, edit)
      )
    } catch (error) {
      this.pendingTerminalRetries.delete(sessionId)
      throw error
    }
  }

  private async retryTerminalInternal(
    sessionId: string,
    target: ReturnType<ProcessRunner['getRetryTarget']>,
    mode: TerminalRetryMode | 'auto',
    edit?: TerminalRetryEdit
  ): Promise<string> {
    this.assertRuntimeAvailable()
    let prepared: PreparedTerminalRetryDraft | undefined
    let commandEdited = false
    if (edit) {
      if (mode === 'auto') throw new Error(t('errors:session.retryDataInvalid'))
      prepared = await this.prepareTerminalRetryDraft(sessionId, mode)
      if (prepared.draft.revision !== edit.revision) {
        throw new Error(t('errors:workflowRuntime.retryDraftChanged'))
      }
      if (!edit.command.trim()) throw new Error(t('errors:session.retryCommandEmpty'))
      if (edit.command.includes('\0')) throw new Error(t('errors:session.commandContainsNul'))
      commandEdited = edit.command !== prepared.draft.command
    }
    if (mode === 'standalone') {
      return this.retryStandaloneTerminal(
        sessionId,
        commandEdited && edit && prepared ? { edit, prepared } : undefined
      )
    }

    const engine = this.getEngineForTerminalRetry(target.taskId, target.nodeId)
    if (!engine) {
      if (mode === 'workflow') throw new Error(t('errors:workflowRuntime.nodeStateChanged'))
      return this.retryStandaloneTerminal(sessionId)
    }

    let retryStart: Awaited<ReturnType<WorkflowRuntimeEngine['beginTerminalRetry']>>
    try {
      retryStart = await engine.beginTerminalRetry(
        target.nodeId,
        target.sessionId,
        commandEdited && edit && prepared
          ? {
              command: edit.command,
              ...(prepared.snapshot.syntax === 'replay'
                ? { replaySnapshot: prepared.snapshot }
                : {})
            }
          : undefined
      )
    } catch (error) {
      throw this.describeTerminalRetryTemplateError(error)
    }
    if (retryStart === false) {
      this.releaseEngineIfTerminal(target.taskId, engine)
      throw new Error(t('errors:workflowRuntime.nodeStateChanged'))
    }
    this.assertRuntimeAvailable()
    this.engines.set(target.taskId, engine)

    let retried: ReturnType<ProcessRunner['retry']>
    try {
      retried = retryStart.commandOverride
        ? commandEdited
          ? this.processRunner.retry(
              sessionId,
              retryStart.commandOverride,
              { preserveDefaultCommand: true }
            )
          : this.processRunner.retry(sessionId, retryStart.commandOverride)
        : this.processRunner.retry(sessionId)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await engine.completeTerminalRetry(target.nodeId, target.sessionId, {
        sessionId: target.sessionId,
        stdout: '',
        stderr: message,
        exitCode: -1,
        status: 'failed'
      })
      this.releaseEngineIfTerminal(target.taskId, engine)
      throw error
    }

    this.runEngineOperation(
      retried.taskId,
      engine,
      'retryTerminal',
      async () => {
        try {
          const result = await retried.result
          await engine.completeTerminalRetry(retried.nodeId, retried.sessionId, result)
        } finally {
          this.pendingTerminalRetries.delete(sessionId)
        }
      }
    )
    return retried.sessionId
  }

  private retryStandaloneTerminal(
    sessionId: string,
    edited?: { edit: TerminalRetryEdit; prepared: PreparedTerminalRetryDraft }
  ): string {
    let retried: ReturnType<ProcessRunner['retry']>
    if (edited) {
      try {
        const command = bindTerminalCommandTemplate(
          edited.edit.command,
          edited.prepared.snapshot,
          Object.keys(edited.prepared.source.retry.env ?? {})
        )
        retried = this.processRunner.retry(sessionId, {
          command,
          displayCommand: displayNeutralCommand(command),
          commandTemplate: {
            ...edited.prepared.snapshot,
            template: edited.edit.command
          }
        }, { preserveDefaultCommand: true })
      } catch (error) {
        throw this.describeTerminalRetryTemplateError(error)
      }
    } else {
      retried = this.processRunner.retry(sessionId)
    }
    void retried.result.then(
      () => this.pendingTerminalRetries.delete(sessionId),
      () => this.pendingTerminalRetries.delete(sessionId)
    )
    return retried.sessionId
  }

  async getTerminalRetryDraft(
    sessionId: string,
    mode: TerminalRetryMode
  ): Promise<TerminalRetryDraft> {
    this.assertRuntimeAvailable()
    return (await this.prepareTerminalRetryDraft(sessionId, mode)).draft
  }

  private async prepareTerminalRetryDraft(
    sessionId: string,
    mode: TerminalRetryMode
  ): Promise<PreparedTerminalRetryDraft> {
    const source = this.processRunner.getRetrySource(sessionId)
    const savedCommand = source.defaultCommand ?? source.retry
    let command = ''
    let draftSource: TerminalRetryDraft['source'] = 'saved-command'
    let snapshot: TerminalCommandTemplateSnapshot
    let workflowRevision: Record<string, unknown> | undefined

    if (mode === 'workflow') {
      const inspection = this.inspectWorkflowTerminalRetry(source)
      const configuredCommand = inspection.engine.getTerminalRetryCommand(source.nodeId)
      if (!inspection.engine.canRetryTerminalNode(source.nodeId)) {
        throw new Error(t('errors:workflowRuntime.nodeStateChanged'))
      }
      this.assertTerminalSessionIdentity(source, inspection.state, inspection.terminalSessions)
      if (configuredCommand !== undefined) {
        command = configuredCommand
        draftSource = 'workflow-retry-command'
        snapshot = { version: 1, syntax: 'workflow', template: command, variables: {} }
      } else {
        snapshot = restoreTerminalCommandTemplate(savedCommand.command, savedCommand.commandTemplate)
        command = snapshot.template
      }
      const run = this.db.prepare(
        'select id, workflow_id, workflow_version from workflow_runs where task_id = ? order by updated_at desc limit 1'
      ).get(source.taskId) as Record<string, unknown> | undefined
      const nodeRun = inspection.state.nodeRuns[source.nodeId]
      const branch = Object.values(inspection.state.branchRuns).find(
        (item) => item.currentNodeId === source.nodeId && item.nodeIds.includes(source.nodeId)
      )
      workflowRevision = {
        run: run ?? null,
        nodeId: source.nodeId,
        nodeRun: nodeRun ?? null,
        branchId: branch?.branchId ?? null,
        branchStatus: branch?.status ?? null
      }
    } else {
      snapshot = restoreTerminalCommandTemplate(savedCommand.command, savedCommand.commandTemplate)
      command = snapshot.template
    }

    const revision = createHash('sha256').update(stableStringify({
      sessionId,
      mode,
      updatedAt: source.updatedAt,
      storedJson: source.storedJson,
      defaultSource: savedCommand,
      command,
      workflow: workflowRevision ?? null
    })).digest('hex')
    const executionTargetName = source.retry.target?.displayName
      ?? await this.resolveRetryTargetName()
    const draft: TerminalRetryDraft = {
      sessionId,
      mode,
      revision,
      command,
      source: draftSource,
      syntax: snapshot.syntax,
      cwd: source.retry.targetCwd ?? source.cwd,
      executionTargetName,
      hasSavedVariables: snapshot.syntax === 'replay' && Object.keys(snapshot.variables).length > 0
    }
    return { draft, snapshot, source }
  }

  private inspectWorkflowTerminalRetry(source: ProcessRetrySource): {
    engine: WorkflowRuntimeEngine
    state: WorkflowRuntimeState
    terminalSessions: RuntimeRestoreResult['terminalSessions']
  } {
    const persisted = readWorkflowRuntimeState(this.db, source.taskId, {
      isTerminalSessionLive: (session) => this.processRunner.hasLiveSession(session.id)
    })
    const active = this.engines.get(source.taskId)
    const state = active?.getState() ?? persisted.state
    if (!state || !persisted.workflow || persisted.workflowVersion === null) {
      throw new Error(t('errors:workflowRuntime.nodeStateChanged'))
    }
    const engine = active ?? new WorkflowRuntimeEngine({
      taskId: state.taskId,
      projectId: state.projectId,
      projectDir: state.projectDir,
      workflow: persisted.workflow,
      variables: state.variables,
      initialState: state,
      translator: t
    }, this.createAdapter(persisted.workflow, persisted.workflowVersion))
    return { engine, state, terminalSessions: persisted.terminalSessions }
  }

  private assertTerminalSessionIdentity(
    source: ProcessRetrySource,
    state: WorkflowRuntimeState,
    sessions: RuntimeRestoreResult['terminalSessions']
  ): void {
    const nodeRun = state.nodeRuns[source.nodeId]
    if (nodeRun?.sessionId) {
      if (nodeRun.sessionId !== source.sessionId) {
        throw new Error(t('errors:workflowRuntime.nodeStateChanged'))
      }
      return
    }
    const latest = sessions.filter((session) => session.node_id === source.nodeId).at(-1)
    if (latest?.id !== source.sessionId) {
      throw new Error(t('errors:workflowRuntime.nodeStateChanged'))
    }
  }

  private async resolveRetryTargetName(): Promise<string | null> {
    if (!this.executionTargets) return null
    return (await this.executionTargets.resolveEffectiveTarget()).displayName
  }

  private describeTerminalRetryTemplateError(error: unknown): Error {
    if (!(error instanceof TerminalRetryTemplateError)) {
      return error instanceof Error ? error : new Error(String(error))
    }
    if (error.code === 'unknown-saved-variable') {
      return new Error(t('errors:session.retrySavedVariableUnknown', { name: error.variable ?? '' }))
    }
    if (error.code === 'unknown-variable') {
      return new Error(t('errors:session.retryVariableUnknown', { name: error.variable ?? '' }))
    }
    return new Error(t('errors:session.retryCommandEmpty'))
  }

  async restore(taskId: string): Promise<RuntimeRestoreResult> {
    return this.serializeTask(taskId, () => this.restoreInternal(taskId))
  }

  private async restoreInternal(taskId: string): Promise<RuntimeRestoreResult> {
    this.assertRuntimeAvailable()
    const active = this.engines.get(taskId)
    if (!active) await this.processRunner.killByTask(taskId)
    this.assertRuntimeAvailable()
    const restored = active
      ? restoreWorkflowRuntimeState(this.db, taskId, {
          isTerminalSessionLive: (session) => this.processRunner.hasLiveSession(session.id),
          getLiveTerminalTranscript: (session) => (
            this.processRunner.getLiveTranscriptSnapshot(session.id)
          ),
          reconcileRunning: false
        })
      : this.restoreWithoutActiveEngine(taskId)
    if (active) return { ...restored, state: active.getState() }

    if (restored.state?.status === 'waiting-input') {
      const workflow = restored.workflow ?? this.getWorkflow(restored.state.workflowId)
      if (workflow) {
        const workflowVersion = restored.workflowVersion ?? ensureWorkflowVersion(this.db, workflow)
        const contextAdded = await this.ensureExecutionContext(restored.state)
        if (contextAdded) {
          const task = persistWorkflowRuntimeState(
            this.db,
            restored.state,
            restored.state.status,
            workflow,
            workflowVersion
          )
          if (task) restored.state.task = task
        }
        const engine = new WorkflowRuntimeEngine({
          taskId: restored.state.taskId,
          projectId: restored.state.projectId,
          projectDir: restored.state.projectDir,
          workflow,
          variables: restored.state.variables,
          initialState: restored.state,
          translator: t
        }, this.createAdapter(workflow, workflowVersion))
        this.engines.set(taskId, engine)
      }
    }

    return restored
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise
    this.shuttingDown = true
    const taskIds = new Set([
      ...this.engines.keys(),
      ...this.taskOperations.keys()
    ])
    this.shutdownPromise = (async () => {
      const failures: string[] = []
      const interrupted = await Promise.allSettled(
        [...taskIds].map((taskId) => (
          this.serializeTask(taskId, () => this.interruptInternal(taskId))
        ))
      )
      for (const result of interrupted) {
        if (result.status === 'rejected') {
          failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason))
        }
      }
      try {
        await this.processRunner.killAll('interrupted')
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
      if (failures.length > 0) {
        throw new Error(t('errors:workflowRuntime.shutdownFailed', { detail: failures.join('; ') }))
      }
    })()
    const currentShutdown = this.shutdownPromise
    void currentShutdown.catch(() => {
      if (this.shutdownPromise === currentShutdown) this.shutdownPromise = null
    })
    return currentShutdown
  }

  private serializeTask<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.taskOperations.get(taskId) ?? Promise.resolve()
    const result = previous.then(operation, operation)
    const tail = result.then(
      () => undefined,
      () => undefined
    )
    this.taskOperations.set(taskId, tail)
    void tail.then(() => {
      if (this.taskOperations.get(taskId) === tail) this.taskOperations.delete(taskId)
    })
    return result
  }

  private assertRuntimeAvailable(): void {
    if (this.shuttingDown) throw new Error(t('errors:workflowRuntime.shuttingDown'))
  }

  private restoreWithoutActiveEngine(taskId: string): RuntimeRestoreResult {
    return restoreWorkflowRuntimeState(this.db, taskId, {
      isTerminalSessionLive: () => false
    })
  }

  private runEngineOperation(
    taskId: string,
    engine: WorkflowRuntimeEngine,
    operationName: string,
    operation: () => Promise<unknown>
  ): void {
    void operation()
      .catch((error: unknown) => {
        console.error(`[WorkflowRuntimeService] ${operationName} failed:`, error)
      })
      .finally(() => {
        this.releaseEngineIfTerminal(taskId, engine)
      })
  }

  private releaseEngineIfTerminal(taskId: string, engine: WorkflowRuntimeEngine): void {
    const status: WorkflowRuntimeStatus = engine.getState().status
    if (status === 'running' || status === 'waiting-input') return
    if (this.engines.get(taskId) === engine) {
      this.engines.delete(taskId)
      this.onTaskTerminal?.()
    }
  }

  private getEngineForTerminalRetry(taskId: string, nodeId: string): WorkflowRuntimeEngine | null {
    const active = this.engines.get(taskId)
    if (active) return active

    const engine = this.restoreEngineForRetry(taskId)
    if (!engine?.canRetryTerminalNode(nodeId)) return null

    this.engines.set(taskId, engine)
    return engine
  }

  private getEngineForNodeRetry(
    taskId: string,
    nodeId: string,
    branchId?: string
  ): WorkflowRuntimeEngine | null {
    const active = this.engines.get(taskId)
    if (active) return active.canRetryNode(nodeId, branchId) ? active : null

    const engine = this.restoreEngineForRetry(taskId)
    if (!engine?.canRetryNode(nodeId, branchId)) return null

    this.engines.set(taskId, engine)
    return engine
  }

  private restoreEngineForRetry(taskId: string): WorkflowRuntimeEngine | null {
    const restored = restoreWorkflowRuntimeState(this.db, taskId, {
      isTerminalSessionLive: (session) => this.processRunner.hasLiveSession(session.id),
      getLiveTerminalTranscript: (session) => (
        this.processRunner.getLiveTranscriptSnapshot(session.id)
      )
    })
    if (!restored.state) return null

    const workflow = restored.workflow ?? this.getWorkflow(restored.state.workflowId)
    if (!workflow) return null
    const workflowVersion = restored.workflowVersion ?? ensureWorkflowVersion(this.db, workflow)
    const engine = new WorkflowRuntimeEngine({
      taskId: restored.state.taskId,
      projectId: restored.state.projectId,
      projectDir: restored.state.projectDir,
      workflow,
      variables: restored.state.variables,
      initialState: restored.state,
      translator: t
    }, this.createAdapter(workflow, workflowVersion))
    return engine
  }

  private createAdapter(
    workflow: WorkflowDefinition,
    workflowVersion: number
  ): WorkflowRuntimeAdapter {
    return {
      emitState: (state: WorkflowRuntimeState) => {
        this.getWindow()?.webContents.send('workflow:state', state)
      },
      persistTask: async (
        state: WorkflowRuntimeState,
        taskStatus: WorkflowRuntimeStatus
      ) => {
        return persistWorkflowRuntimeState(
          this.db,
          state,
          taskStatus,
          workflow,
          workflowVersion
        )
      },
      runProcess: async (request) => {
        if (this.isTaskLaunchCancelled(request.taskId)) return cancelledProcessResult()
        if (!request.executionTarget || !this.executionTargets) return this.processRunner.run(request)
        try {
          const target = await this.executionTargets.resolveTarget(request.executionTarget)
          if (this.isTaskLaunchCancelled(request.taskId)) return cancelledProcessResult()
          const cwd = await this.executionTargets.resolveTargetPath(target, request.cwd)
          if (this.isTaskLaunchCancelled(request.taskId)) return cancelledProcessResult()
          return this.processRunner.run({ ...request, sourceCwd: request.cwd, cwd })
        } catch (error) {
          if (this.isTaskLaunchCancelled(request.taskId)) return cancelledProcessResult()
          return this.processRunner.run({
            ...request,
            sourceCwd: request.cwd,
            preparationError: request.preparationError ?? errorMessage(error)
          })
        }
      },
      runHook: async (request) => {
        if (this.isTaskLaunchCancelled(request.taskId)) return cancelledHookResult()
        if (!request.executionTarget || !this.executionTargets) return this.processRunner.runHook(request)
        try {
          const target = await this.executionTargets.resolveTarget(request.executionTarget)
          if (this.isTaskLaunchCancelled(request.taskId)) return cancelledHookResult()
          const cwd = await this.executionTargets.resolveTargetPath(target, request.cwd)
          if (this.isTaskLaunchCancelled(request.taskId)) return cancelledHookResult()
          return this.processRunner.runHook({ ...request, sourceCwd: request.cwd, cwd })
        } catch (error) {
          if (this.isTaskLaunchCancelled(request.taskId)) return cancelledHookResult()
          return this.processRunner.runHook({
            ...request,
            sourceCwd: request.cwd,
            preparationError: request.preparationError ?? errorMessage(error)
          })
        }
      },
      killTask: async (taskId: string, terminalStatus) => (
        this.processRunner.killByTask(taskId, terminalStatus)
      )
    }
  }

  private getWorkflow(workflowId: string): WorkflowDefinition | null {
    const row = this.db.prepare('select definition_json from workflows where id = ?').get(workflowId) as { definition_json: string } | undefined
    if (!row) return null
    return parseWorkflowDefinitionStructure(JSON.parse(row.definition_json) as unknown)
  }

  private async ensureExecutionContext(state: WorkflowRuntimeState): Promise<boolean> {
    if (state.executionContext || !this.executionTargets) return false
    const project = this.db.prepare('select path from projects where id = ?').get(state.projectId) as
      { path: string } | undefined
    if (!project) throw new Error(t('errors:database.projectNotFound'))
    const target = await this.executionTargets.resolveEffectiveTarget()
    const targetProjectDir = this.executionTargets.resolveProjectPath
      ? await this.executionTargets.resolveProjectPath(target, project.path)
      : await this.executionTargets.resolveTargetPath(target, project.path)
    state.projectDir = targetProjectDir
    state.executionContext = {
      version: 1,
      target: toExecutionTargetDescriptor(target),
      hostProjectDir: project.path,
      targetProjectDir
    }
    return true
  }

  private isTaskLaunchCancelled(taskId: string): boolean {
    return this.shuttingDown || this.cancelledTaskLaunches.has(taskId)
  }
}

function cancelledProcessResult() {
  return {
    sessionId: '',
    stdout: '',
    stderr: '',
    exitCode: null,
    status: 'killed' as const
  }
}

function cancelledHookResult() {
  return {
    hookRunId: '',
    stdout: '',
    stderr: '',
    exitCode: null,
    status: 'killed' as const
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function displayNeutralCommand(command: import('../shared/shell').ShellNeutralCommand): string {
  return command.segments.map((segment) => (
    segment.type === 'literal' ? segment.value : command.bindings[segment.name]
  )).join('')
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value))
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJsonValue(item)])
  )
}
