import { evaluateExpression } from './expression'
import { MAX_PROCESS_RESULT_CHARS, tailText } from './terminalBuffer'
import {
  bindShellCommand,
  getSystemVariables,
  interpolate,
  sortVariableDefinitions,
  type HookConfig,
  type InputNodeConfig,
  type InteractiveTerminalConfig,
  type LastCommand,
  type NodeRunStatus,
  type NonInteractiveTerminalConfig,
  type ParallelGatewayConfig,
  type StartNodeConfig,
  type VariableDefinition,
  type VariableValue,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode
} from './workflow'
import type {
  ExecutionTargetDescriptor,
  ShellNeutralCommand,
  WorkflowExecutionContext
} from './shell'
import type { Translator } from './i18n/translator'
import type { TranslationKey } from './i18n/types'

export type WorkflowRuntimeStatus = 'running' | 'waiting-input' | 'completed' | 'failed' | 'stopped' | 'interrupted'

export type WorkflowRuntimeNodeRun = {
  nodeId: string
  status: NodeRunStatus
  sessionId?: string
  stdout?: string
  stderr?: string
  exitCode?: number | null
}

export type WorkflowRuntimeBranchRun = {
  branchId: string
  splitNodeId: string
  entryEdgeId: string
  entryNodeId: string
  currentNodeId: string
  status: WorkflowRuntimeStatus
  nodeIds: string[]
  reachedJoinEdgeId?: string
  reachedJoinNodeId?: string
  variables: Record<string, VariableValue>
  error?: string
}

export type WorkflowRuntimeParallelBranchResult = {
  branchId: string
  entryEdgeId: string
  entryNodeId: string
  reachedJoinEdgeId?: string
  reachedJoinNodeId?: string
  status: 'completed' | 'failed' | 'stopped' | 'interrupted'
  nodeIds: string[]
  variables: Record<string, VariableValue>
  lastCommand?: LastCommand & { nodeId: string }
  nodeRuns: Record<string, WorkflowRuntimeNodeRun>
  error?: string
}

export type WorkflowRuntimeParallelJoinResult = {
  splitNodeId: string
  joinNodeId: string
  requiredIncomingEdgeIds: string[]
  branches: Record<string, WorkflowRuntimeParallelBranchResult>
}

export type WorkflowRuntimeTaskSnapshot = {
  id: string
  project_id: string
  title: string
  status: WorkflowRuntimeStatus
  created_at?: string
  updated_at?: string
}

export type WorkflowRuntimeState = {
  taskId: string
  projectId: string
  projectDir: string
  executionContext?: WorkflowExecutionContext
  workflowId: string
  status: WorkflowRuntimeStatus
  currentNodeId: string
  variables: Record<string, VariableValue>
  nodeRuns: Record<string, WorkflowRuntimeNodeRun>
  executionOrder: string[]
  activeBranches: string[]
  branchRuns: Record<string, WorkflowRuntimeBranchRun>
  parallelResults: Record<string, WorkflowRuntimeParallelJoinResult>
  lastJoinResultSplitNodeId?: string
  workflowCompleted: boolean
  error?: string
  task?: WorkflowRuntimeTaskSnapshot
}

type WorkflowRuntimeProcessRequest = {
  taskId: string
  nodeId: string
  kind: 'interactive' | 'non-interactive'
  command: ShellNeutralCommand
  displayCommand?: string
  cwd: string
  sourceCwd?: string
  executionTarget?: ExecutionTargetDescriptor
  env?: Record<string, string>
  timeoutMs?: number
  preparationError?: string
}

export type WorkflowRuntimeProcessResult = {
  sessionId: string
  stdout: string
  stderr: string
  exitCode: number | null
  status?: 'closed' | 'killed' | 'failed' | 'interrupted'
}

type WorkflowRuntimeHookRequest = {
  taskId: string
  nodeId: string
  hookType: 'start' | 'end'
  command: ShellNeutralCommand
  cwd: string
  sourceCwd?: string
  executionTarget?: ExecutionTargetDescriptor
  env?: Record<string, string>
  preparationError?: string
}

type WorkflowRuntimeHookResult = {
  hookRunId: string
  stdout: string
  stderr: string
  exitCode: number | null
  status?: 'completed' | 'failed' | 'killed'
}

export type WorkflowRuntimeAdapter = {
  emitState: (state: WorkflowRuntimeState) => void
  persistTask: (
    state: WorkflowRuntimeState,
    taskStatus: WorkflowRuntimeStatus
  ) => Promise<WorkflowRuntimeTaskSnapshot | undefined>
  runProcess: (request: WorkflowRuntimeProcessRequest) => Promise<WorkflowRuntimeProcessResult>
  runHook: (request: WorkflowRuntimeHookRequest) => Promise<WorkflowRuntimeHookResult>
  killTask: (taskId: string, terminalStatus?: 'killed' | 'interrupted') => Promise<number>
}

export type WorkflowRuntimeStartOptions = {
  taskId: string
  projectId: string
  projectDir: string
  workflow: WorkflowDefinition
  variables: Record<string, VariableValue>
  startNodeId?: string
  initialState?: WorkflowRuntimeState
  executionContext?: WorkflowExecutionContext
  translator?: Translator
}

export class WorkflowRuntimeEngine {
  private static readonly MAX_NODE_EXECUTIONS = 1000
  private readonly workflow: WorkflowDefinition
  private readonly adapter: WorkflowRuntimeAdapter
  private readonly translator?: Translator
  private stopped = false
  private readonly submittedInputScopes = new Set<string>()
  private state: WorkflowRuntimeState
  private nodeExecutionCount = 0
  private operationQueue: Promise<unknown> = Promise.resolve()
  private readonly branchOperationQueues = new Map<string, Promise<unknown>>()
  private readonly parallelTerminalRetryBranches = new Map<string, string>()

  constructor(options: WorkflowRuntimeStartOptions, adapter: WorkflowRuntimeAdapter) {
    this.workflow = options.workflow
    this.adapter = adapter
    this.translator = options.translator
    this.state = options.initialState
      ? cloneRuntimeState(options.initialState)
      : {
          taskId: options.taskId,
          projectId: options.projectId,
          projectDir: options.projectDir,
          ...(options.executionContext ? { executionContext: deepClone(options.executionContext) } : {}),
          workflowId: options.workflow.id,
          status: 'running',
          currentNodeId: options.startNodeId ?? options.workflow.nodes[0]?.id ?? '',
          variables: { ...options.variables },
          nodeRuns: {},
          executionOrder: [],
          activeBranches: [],
          branchRuns: {},
          parallelResults: {},
          workflowCompleted: false
        }
  }

  getState(): WorkflowRuntimeState {
    return {
      ...this.state,
      executionContext: this.state.executionContext
        ? deepClone(this.state.executionContext)
        : undefined,
      variables: { ...this.state.variables },
      nodeRuns: Object.fromEntries(
        Object.entries(this.state.nodeRuns).map(([key, value]) => [key, { ...value }])
      ),
      executionOrder: [...this.state.executionOrder],
      activeBranches: [...this.state.activeBranches],
      branchRuns: Object.fromEntries(
        Object.entries(this.state.branchRuns).map(([key, value]) => [
          key,
          { ...value, nodeIds: [...value.nodeIds], variables: { ...value.variables } }
        ])
      ),
      parallelResults: deepClone(this.state.parallelResults),
      task: this.state.task ? { ...this.state.task } : undefined
    }
  }

  private tr(key: TranslationKey, params: Record<string, unknown>, english: string): string {
    return this.translator ? this.translator(key, params) : english
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = operation
    const next = this.operationQueue.then(run, run)
    this.operationQueue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  private serializeBranch<T>(branchId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.branchOperationQueues.get(branchId) ?? Promise.resolve()
    const next = previous.then(operation, operation)
    const tail = next.then(
      () => undefined,
      () => undefined
    )
    this.branchOperationQueues.set(branchId, tail)
    void tail.then(() => {
      if (this.branchOperationQueues.get(branchId) === tail) {
        this.branchOperationQueues.delete(branchId)
      }
    })
    return next
  }

  async start(): Promise<WorkflowRuntimeState> {
    return this.serialize(() => this.startInternal())
  }

  private async startInternal(): Promise<WorkflowRuntimeState> {
    this.stopped = false
    this.state.status = 'running'
    await this.runLoop()
    return this.getState()
  }

  async updateVariables(variables: Record<string, VariableValue>, branchId?: string): Promise<WorkflowRuntimeState> {
    return this.serialize(() => this.updateVariablesInternal(variables, branchId))
  }

  canRetryNode(nodeId: string, branchId?: string): boolean {
    const run = this.state.nodeRuns[nodeId]
    if (!this.findNode(nodeId) || !run || !isRetryableRunStatus(run.status)) return false

    const branch = this.findBranchForNode(nodeId, branchId)
    if (branch) return isRetryableRunStatus(branch.status)
    if (branchId) return false
    return this.state.currentNodeId === nodeId && isRetryableRunStatus(this.state.status)
  }

  async beginNodeRetry(nodeId: string, branchId?: string): Promise<boolean> {
    return this.serialize(() => this.beginNodeRetryInternal(nodeId, branchId))
  }

  async continueNodeRetry(nodeId: string, branchId?: string): Promise<WorkflowRuntimeState> {
    return this.serialize(() => this.continueNodeRetryInternal(nodeId, branchId))
  }

  private async continueNodeRetryInternal(
    nodeId: string,
    branchId?: string
  ): Promise<WorkflowRuntimeState> {
    const run = this.state.nodeRuns[nodeId]
    if (this.stopped || run?.status !== 'running') return this.getState()

    const branch = this.findBranchForNode(nodeId, branchId)
    if (branch) {
      if (branch.status !== 'running') return this.getState()
      await this.runBranch(branch)
      const shouldContinueWorkflow = await this.updateAfterSplit(branch.splitNodeId)
      if (shouldContinueWorkflow) {
        await this.runLoop()
      }
    } else if (this.state.currentNodeId === nodeId && this.state.status === 'running') {
      await this.runLoop()
    }

    return this.getState()
  }

  canRetryTerminalNode(nodeId: string): boolean {
    const node = this.findNode(nodeId)
    return Boolean(node?.type.includes('terminal') && this.canRetryNode(nodeId))
  }

  async beginTerminalRetry(nodeId: string, sessionId: string): Promise<boolean> {
    const branch = this.findBranchForNode(nodeId)
    if (!branch || !isRetryableRunStatus(branch.status)) {
      return this.serialize(() => this.beginTerminalRetryInternal(nodeId, sessionId))
    }

    // The workflow queue remains occupied while sibling branches run. Waiting
    // only for this branch lets its failed terminal restart immediately.
    return this.serializeBranch(branch.branchId, async () => {
      const started = await this.beginTerminalRetryInternal(nodeId, sessionId, branch.branchId)
      if (started) this.parallelTerminalRetryBranches.set(sessionId, branch.branchId)
      return started
    })
  }

  private async beginTerminalRetryInternal(
    nodeId: string,
    sessionId: string,
    branchId?: string
  ): Promise<boolean> {
    const node = this.findNode(nodeId)
    if (!node?.type.includes('terminal') || !this.canRetryNode(nodeId, branchId)) return false
    return this.beginNodeRetryInternal(nodeId, branchId, sessionId)
  }

  private async beginNodeRetryInternal(
    nodeId: string,
    branchId?: string,
    sessionId?: string
  ): Promise<boolean> {
    if (!this.canRetryNode(nodeId, branchId)) return false

    const branch = this.findBranchForNode(nodeId, branchId)
    this.stopped = false
    this.state.nodeRuns[nodeId] = {
      nodeId,
      status: 'running',
      ...(sessionId ? { sessionId } : {})
    }
    this.state.status = 'running'
    this.state.workflowCompleted = false
    delete this.state.error

    if (branch) {
      branch.status = 'running'
      delete branch.error
      delete branch.reachedJoinEdgeId
      delete branch.reachedJoinNodeId
      delete this.state.parallelResults[branch.splitNodeId]
      if (this.state.lastJoinResultSplitNodeId === branch.splitNodeId) {
        delete this.state.lastJoinResultSplitNodeId
      }
      this.state.activeBranches = Object.values(this.state.branchRuns)
        .filter((item) => item.status === 'running' || item.status === 'waiting-input')
        .map((item) => item.branchId)
    }

    await this.persistAndEmit('running')
    return true
  }

  async completeTerminalRetry(
    nodeId: string,
    sessionId: string,
    result: WorkflowRuntimeProcessResult
  ): Promise<WorkflowRuntimeState> {
    const branchId = this.parallelTerminalRetryBranches.get(sessionId)
    if (!branchId) {
      return this.serialize(() => this.completeTerminalRetryInternal(nodeId, sessionId, result))
    }

    return this.serializeBranch(branchId, async () => {
      try {
        return await this.completeTerminalRetryInternal(nodeId, sessionId, result, branchId)
      } finally {
        if (this.parallelTerminalRetryBranches.get(sessionId) === branchId) {
          this.parallelTerminalRetryBranches.delete(sessionId)
        }
      }
    })
  }

  private async completeTerminalRetryInternal(
    nodeId: string,
    sessionId: string,
    result: WorkflowRuntimeProcessResult,
    branchId?: string
  ): Promise<WorkflowRuntimeState> {
    const run = this.state.nodeRuns[nodeId]
    if (this.stopped || run?.status !== 'running' || run.sessionId !== sessionId) {
      return this.getState()
    }

    const node = this.findNode(nodeId)
    if (!node?.type.includes('terminal')) return this.getState()

    const branch = branchId
      ? this.findBranchForNode(nodeId, branchId)
      : Object.values(this.state.branchRuns).find(
          (item) => item.currentNodeId === nodeId && item.status === 'running'
        )
    const completed = await this.completeTerminalNode(node, result, {
      moveNext: !branch,
      runHooks: true,
      branch
    })

    if (branch) {
      if (completed && this.advanceBranch(branch, this.getOutgoingEdges(node.id)[0])) {
        await this.runBranch(branch)
      }
      const shouldContinueWorkflow = await this.updateAfterSplit(branch.splitNodeId)
      if (shouldContinueWorkflow) {
        await this.runLoop()
      }
    } else if (completed && this.state.status === 'running') {
      await this.runLoop()
    }

    return this.getState()
  }

  private async updateVariablesInternal(variables: Record<string, VariableValue>, branchId?: string): Promise<WorkflowRuntimeState> {
    if (branchId) {
      const branch = this.state.branchRuns[branchId]
      if (!branch) {
        this.state.status = 'failed'
        this.state.error = this.tr('errors:runtime.branchNotFound', { id: branchId }, `Branch not found: ${branchId}`)
        await this.persistAndEmit('failed')
        return this.getState()
      }

      branch.variables = { ...branch.variables, ...variables }
      if (branch.status === 'waiting-input') {
        this.submittedInputScopes.add(this.inputScope(branch.currentNodeId, branch))
        branch.status = 'running'
        this.state.status = 'running'
        await this.runBranch(branch)
        const shouldContinueWorkflow = await this.updateAfterSplit(branch.splitNodeId)
        if (shouldContinueWorkflow) {
          await this.runLoop()
        }
      } else {
        await this.persistAndEmit(this.state.status)
      }
      return this.getState()
    }

    this.state.variables = { ...this.state.variables, ...variables }
    if (this.state.status === 'waiting-input') {
      this.submittedInputScopes.add(this.inputScope(this.state.currentNodeId))
      this.state.status = 'running'
      await this.runLoop()
    } else {
      await this.persistAndEmit(this.state.status)
    }
    return this.getState()
  }

  async stop(): Promise<WorkflowRuntimeState> {
    return this.terminate('stopped')
  }

  async interrupt(): Promise<WorkflowRuntimeState> {
    return this.terminate('interrupted')
  }

  private async terminate(
    status: Extract<WorkflowRuntimeStatus, 'stopped' | 'interrupted'>
  ): Promise<WorkflowRuntimeState> {
    this.stopped = true
    if (status === 'interrupted') {
      await this.adapter.killTask(this.state.taskId, 'interrupted')
    } else {
      await this.adapter.killTask(this.state.taskId)
    }
    for (const run of Object.values(this.state.nodeRuns)) {
      if (run.status === 'running' || run.status === 'waiting-input') {
        run.status = status
        if (status === 'stopped') {
          run.stderr = run.stderr ?? this.tr('status:runtime.userStopped', {}, 'User stopped')
        }
      }
    }
    for (const branch of Object.values(this.state.branchRuns)) {
      if (branch.status === 'running' || branch.status === 'waiting-input') {
        branch.status = status
        if (status === 'stopped') {
          branch.error = branch.error ?? this.tr('status:runtime.userStopped', {}, 'User stopped')
        }
      }
    }
    this.state.activeBranches = []
    this.state.status = status
    await this.persistAndEmit(status)
    return this.getState()
  }

  private async runLoop(): Promise<void> {
    while (this.state.status === 'running' && !this.stopped) {
      const node = this.findNode(this.state.currentNodeId)
      if (!node) {
        await this.failCurrentNode(this.tr('errors:runtime.nodeNotFound', { id: this.state.currentNodeId }, `Node not found: ${this.state.currentNodeId}`))
        return
      }

      if (!this.recordExecution(node.id)) {
        await this.failCurrentNode(this.tr('errors:runtime.executionLimit', { limit: WorkflowRuntimeEngine.MAX_NODE_EXECUTIONS }, `Workflow execution count exceeded the limit (${WorkflowRuntimeEngine.MAX_NODE_EXECUTIONS}); there may be an infinite loop`))
        return
      }
      await this.persistAndEmit('running')
      if (this.stopped) return

      if (node.startHook?.enabled) {
        const outcome = await this.runHook(node, node.startHook, 'start')
        if (this.stopped) return
        if (!outcome.ok) {
          await this.failCurrentNode(outcome.error ?? this.tr('errors:runtime.startHookFailed', {}, 'startHook failed'))
          return
        }
      }

      if (node.type === 'start' || node.type === 'input') {
        await this.runInputNode(node)
        continue
      }

      if (node.type === 'exclusive-gateway') {
        await this.runExclusiveGateway(node)
        continue
      }

      if (node.type === 'parallel-gateway') {
        const shouldContinueWorkflow = await this.runParallelGateway(node)
        if (!shouldContinueWorkflow) return
        continue
      }

      if (node.type === 'end') {
        await this.runEndNode(node)
        return
      }

      await this.runTerminalNode(node, { moveNext: true, runHooks: true })
    }
  }

  private async runInputNode(node: WorkflowNode, branch?: WorkflowRuntimeBranchRun): Promise<boolean> {
    const config = node.config as StartNodeConfig | InputNodeConfig
    const variables = branch?.variables ?? this.state.variables
    const definitions = sortVariableDefinitions(config.variables)
    this.applyVariableDefaults(definitions, variables)
    const missing = definitions.filter((variable) => variable.required && isEmptyValue(variables[variable.key]))
    const inputSubmitted = node.type !== 'input'
      || this.submittedInputScopes.delete(this.inputScope(node.id, branch))

    if (node.type === 'input' && (!inputSubmitted || missing.length > 0)) {
      this.state.nodeRuns[node.id] = {
        nodeId: node.id,
        status: 'waiting-input',
        stderr: missing.length > 0
          ? this.tr('errors:runtime.missingVariables', { names: missing.map((item) => item.label).join(', ') }, `Missing required variables: ${missing.map((item) => item.label).join(', ')}`)
          : undefined
      }
      if (branch) {
        branch.status = 'waiting-input'
        branch.currentNodeId = node.id
      }
      this.state.status = 'waiting-input'
      await this.persistAndEmit('waiting-input')
      return false
    }

    if (missing.length > 0) {
      await this.failCurrentNode(this.tr('errors:runtime.missingVariables', { names: missing.map((item) => item.label).join(', ') }, `Missing required variables: ${missing.map((item) => item.label).join(', ')}`))
      return false
    }

    this.state.nodeRuns[node.id] = { nodeId: node.id, status: 'completed' }
    if (node.endHook?.enabled) {
      const outcome = await this.runHook(node, node.endHook, 'end', branch)
      if (this.stopped) return false
      if (!outcome.ok) {
        if (branch) {
          this.failBranch(branch, outcome.error ?? this.tr('errors:runtime.endHookFailed', {}, 'endHook failed'))
          await this.persistAndEmit(this.state.status)
        } else {
          await this.failCurrentNode(outcome.error ?? this.tr('errors:runtime.endHookFailed', {}, 'endHook failed'))
        }
        return false
      }
    }
    if (!branch) this.selectNextNode(node.id)
    await this.persistAndEmit('running')
    return true
  }

  private async runExclusiveGateway(node: WorkflowNode): Promise<void> {
    const edge = this.selectExclusiveEdge(node)

    if (!edge) {
      await this.failCurrentNode(this.tr('errors:runtime.noSatisfiedBranch', {}, 'No branch satisfied the conditions'))
      return
    }

    this.state.nodeRuns[node.id] = {
      nodeId: node.id,
      status: 'completed',
      stdout: this.tr('terminal:transcript.selectedBranch', { id: edge.id }, `Selected branch: ${edge.id}`)
    }
    if (node.endHook?.enabled) {
      const outcome = await this.runHook(node, node.endHook, 'end')
      if (this.stopped) return
      if (!outcome.ok) {
        await this.failCurrentNode(outcome.error ?? this.tr('errors:runtime.endHookFailed', {}, 'endHook failed'))
        return
      }
    }
    this.state.currentNodeId = edge.to
    await this.persistAndEmit('running')
  }

  private async runParallelGateway(node: WorkflowNode): Promise<boolean> {
    const config = node.config as ParallelGatewayConfig
    this.state.nodeRuns[node.id] = { nodeId: node.id, status: 'completed' }

    if (node.endHook?.enabled) {
      const outcome = await this.runHook(node, node.endHook, 'end')
      if (this.stopped) return false
      if (!outcome.ok) {
        await this.failCurrentNode(outcome.error ?? this.tr('errors:runtime.endHookFailed', {}, 'endHook failed'))
        return false
      }
    }

    if (config.mode === 'split') {
      if (this.state.lastJoinResultSplitNodeId === node.id) {
        delete this.state.lastJoinResultSplitNodeId
      }
      const outgoing = this.getOutgoingEdges(node.id)
      const branches = outgoing.map((edge) => {
        const branch: WorkflowRuntimeBranchRun = {
          branchId: this.createBranchId(node.id, edge.id),
          splitNodeId: node.id,
          entryEdgeId: edge.id,
          entryNodeId: edge.to,
          currentNodeId: edge.to,
          status: 'running',
          nodeIds: [],
          variables: { ...this.state.variables }
        }
        this.state.branchRuns[branch.branchId] = branch
        return branch
      })

      this.state.activeBranches = branches.map((branch) => branch.branchId)
      await this.persistAndEmit('running')
      await this.runSplitBranches(branches)
      return this.updateAfterSplit(node.id)
    }

    this.selectNextNode(node.id)
    await this.persistAndEmit('running')
    return true
  }

  private async runSplitBranches(branches: WorkflowRuntimeBranchRun[]): Promise<void> {
    await Promise.allSettled(branches.map((branch) => (
      this.serializeBranch(branch.branchId, () => this.runBranch(branch))
    )))
  }

  private async runBranch(branch: WorkflowRuntimeBranchRun): Promise<void> {
    while (branch.status === 'running' && !this.stopped) {
      const node = this.findNode(branch.currentNodeId)
      if (!node) {
        this.failBranch(branch, this.tr('errors:runtime.nodeNotFound', { id: branch.currentNodeId }, `Node not found: ${branch.currentNodeId}`))
        await this.persistAndEmit(this.state.status)
        return
      }

      if (node.type === 'parallel-gateway') {
        const config = node.config as ParallelGatewayConfig
        if (config.mode === 'join') {
          branch.status = 'completed'
          branch.currentNodeId = node.id
          branch.reachedJoinNodeId = node.id
          if (config.joinIncomingEdgeIds?.includes(branch.entryEdgeId)) {
            branch.reachedJoinEdgeId = branch.entryEdgeId
          }
          await this.persistAndEmit(this.state.status)
          return
        }
      }

      if (!this.recordExecution(node.id)) {
        this.failBranch(branch, this.tr('errors:runtime.executionLimit', { limit: WorkflowRuntimeEngine.MAX_NODE_EXECUTIONS }, `Workflow execution count exceeded the limit (${WorkflowRuntimeEngine.MAX_NODE_EXECUTIONS}); there may be an infinite loop`))
        await this.persistAndEmit(this.state.status)
        return
      }
      if (!branch.nodeIds.includes(node.id)) branch.nodeIds.push(node.id)
      await this.persistAndEmit(this.state.status)
      if (this.stopped) return

      if (node.startHook?.enabled) {
        const outcome = await this.runHook(node, node.startHook, 'start', branch)
        if (this.stopped) return
        if (!outcome.ok) {
          this.failBranch(branch, outcome.error ?? this.tr('errors:runtime.startHookFailed', {}, 'startHook failed'))
          await this.persistAndEmit(this.state.status)
          return
        }
      }

      if (node.type === 'start' || node.type === 'input') {
        const completed = await this.runInputNode(node, branch)
        if (!completed) return
        if (!this.advanceBranch(branch, this.getOutgoingEdges(node.id)[0])) return
        continue
      }

      if (node.type === 'exclusive-gateway') {
        const edge = this.selectExclusiveEdge(node, branch)
        if (!edge) {
          this.failBranch(branch, this.tr('errors:runtime.noSatisfiedBranch', {}, 'No branch satisfied the conditions'))
          await this.persistAndEmit(this.state.status)
          return
        }
        this.state.nodeRuns[node.id] = {
          nodeId: node.id,
          status: 'completed',
          stdout: this.tr('terminal:transcript.selectedBranch', { id: edge.id }, `Selected branch: ${edge.id}`)
        }
        if (node.endHook?.enabled) {
          const outcome = await this.runHook(node, node.endHook, 'end', branch)
          if (this.stopped) return
          if (!outcome.ok) {
            this.failBranch(branch, outcome.error ?? this.tr('errors:runtime.endHookFailed', {}, 'endHook failed'))
            await this.persistAndEmit(this.state.status)
            return
          }
        }
        if (!this.advanceBranch(branch, edge)) return
        continue
      }

      if (node.type === 'parallel-gateway') {
        this.failBranch(branch, this.tr('errors:runtime.nestedSplitUnsupported', {}, 'Nested split inside a branch is not supported'))
        await this.persistAndEmit(this.state.status)
        return
      }

      if (node.type === 'end') {
        this.state.nodeRuns[node.id] = { nodeId: node.id, status: 'completed' }
        if (node.endHook?.enabled) {
          const outcome = await this.runHook(node, node.endHook, 'end', branch)
          if (this.stopped) return
          if (!outcome.ok) {
            this.failBranch(branch, outcome.error ?? this.tr('errors:runtime.endHookFailed', {}, 'endHook failed'))
            await this.persistAndEmit(this.state.status)
            return
          }
        }
        branch.status = 'completed'
        await this.persistAndEmit(this.state.status)
        return
      }

      const completed = await this.runTerminalNode(node, { moveNext: false, runHooks: true, branch })
      if (!completed) return
      if (!this.advanceBranch(branch, this.getOutgoingEdges(node.id)[0])) return
    }
  }

  private advanceBranch(branch: WorkflowRuntimeBranchRun, edge?: WorkflowEdge): boolean {
    if (!edge) {
      branch.status = 'completed'
      return false
    }

    const target = this.findNode(edge.to)
    if (target?.type === 'parallel-gateway') {
      const targetConfig = target.config as ParallelGatewayConfig
      if (targetConfig.mode === 'join' && targetConfig.joinIncomingEdgeIds?.includes(edge.id)) {
        branch.status = 'completed'
        branch.currentNodeId = target.id
        branch.reachedJoinEdgeId = edge.id
        branch.reachedJoinNodeId = target.id
        return false
      }
    }

    branch.currentNodeId = edge.to
    return true
  }

  private async updateAfterSplit(splitNodeId: string): Promise<boolean> {
    if (this.stopped) return false
    const branches = Object.values(this.state.branchRuns).filter((branch) => branch.splitNodeId === splitNodeId)
    const waitingBranches = branches.filter((branch) => branch.status === 'waiting-input')
    const runningBranches = branches.filter((branch) => branch.status === 'running')
    const failedBranches = branches.filter((branch) => branch.status === 'failed' || branch.status === 'stopped')
    const interruptedBranches = branches.filter((branch) => branch.status === 'interrupted')
    const reachedJoinNodeId = branches.find((branch) => branch.reachedJoinNodeId)?.reachedJoinNodeId
    const joinNode = reachedJoinNodeId ? this.findNode(reachedJoinNodeId) : undefined

    this.state.activeBranches = [...waitingBranches, ...runningBranches].map((branch) => branch.branchId)

    if (joinNode?.type === 'parallel-gateway') {
      const joinConfig = joinNode.config as ParallelGatewayConfig
      const requiredIncomingEdgeIds = joinConfig.joinIncomingEdgeIds ?? []
      this.state.parallelResults[splitNodeId] = {
        splitNodeId,
        joinNodeId: joinNode.id,
        requiredIncomingEdgeIds,
        branches: Object.fromEntries(branches.map((branch) => [branch.entryEdgeId, this.getBranchResult(branch)]))
      }

      const arrivedEdgeIds = new Set(branches.map((branch) => branch.reachedJoinEdgeId).filter(Boolean))
      const allRequiredArrived = requiredIncomingEdgeIds.every((edgeId) => arrivedEdgeIds.has(edgeId))
      if (allRequiredArrived && failedBranches.length === 0 && interruptedBranches.length === 0) {
        // A retried branch and an original sibling can finish together. Only
        // the first completion that reaches the join may continue the workflow.
        if (this.state.lastJoinResultSplitNodeId === splitNodeId) return false
        this.state.lastJoinResultSplitNodeId = splitNodeId
        this.state.activeBranches = []
        this.state.currentNodeId = joinNode.id
        this.state.status = 'running'
        await this.persistAndEmit('running')
        return true
      }
    }

    if (waitingBranches.length > 0 || runningBranches.length > 0) {
      const focusBranch = waitingBranches[0] ?? runningBranches[0]
      this.state.currentNodeId = focusBranch.currentNodeId
      this.state.status = waitingBranches.length > 0 ? 'waiting-input' : 'running'
      await this.persistAndEmit(this.state.status)
      return false
    }

    if (failedBranches.length > 0) {
      this.state.status = 'failed'
      this.state.error = failedBranches.map((branch) => branch.error).filter(Boolean).join('\n') || this.tr('errors:runtime.parallelBranchFailed', {}, 'Parallel branch failed')
      this.state.activeBranches = []
      await this.persistAndEmit('failed')
      return false
    }

    if (interruptedBranches.length > 0) {
      this.state.currentNodeId = interruptedBranches[0].currentNodeId
      this.state.status = 'interrupted'
      delete this.state.error
      this.state.activeBranches = []
      await this.persistAndEmit('interrupted')
      return false
    }

    if (joinNode?.type === 'parallel-gateway') {
      this.state.status = 'failed'
      this.state.error = this.tr('errors:runtime.parallelJoinUnmet', {}, 'Parallel join unmet: required incoming edges have not all arrived')
      this.state.activeBranches = []
      await this.persistAndEmit('failed')
      return false
    }

    this.state.activeBranches = []
    this.state.status = 'completed'
    this.state.workflowCompleted = true
    await this.persistAndEmit('completed')
    return false
  }

  private getBranchResult(branch: WorkflowRuntimeBranchRun): WorkflowRuntimeParallelBranchResult {
    const branchNodeRuns = Object.fromEntries(
      branch.nodeIds
        .map((nodeId) => [nodeId, this.state.nodeRuns[nodeId]])
        .filter((entry): entry is [string, WorkflowRuntimeNodeRun] => Boolean(entry[1]))
        .map(([nodeId, run]) => [nodeId, { ...run }])
    )
    const last = this.lastCommandRun(branch.nodeIds)
    const status = branch.status === 'failed' || branch.status === 'stopped' || branch.status === 'interrupted'
      ? branch.status
      : 'completed'
    return {
      branchId: branch.branchId,
      entryEdgeId: branch.entryEdgeId,
      entryNodeId: branch.entryNodeId,
      reachedJoinEdgeId: branch.reachedJoinEdgeId,
      reachedJoinNodeId: branch.reachedJoinNodeId,
      status,
      nodeIds: [...branch.nodeIds],
      variables: { ...branch.variables },
      lastCommand: last ? { nodeId: last.nodeId, ...last.command } : undefined,
      nodeRuns: branchNodeRuns,
      error: branch.error
    }
  }

  private failBranch(branch: WorkflowRuntimeBranchRun, message: string): void {
    branch.status = 'failed'
    branch.error = message
    this.state.nodeRuns[branch.currentNodeId] = {
      nodeId: branch.currentNodeId,
      status: 'failed',
      stderr: message
    }
  }

  private async runEndNode(node: WorkflowNode): Promise<void> {
    this.state.nodeRuns[node.id] = { nodeId: node.id, status: 'completed' }
    if (node.endHook?.enabled) {
      const outcome = await this.runHook(node, node.endHook, 'end')
      if (this.stopped) return
      if (!outcome.ok) {
        await this.failCurrentNode(outcome.error ?? this.tr('errors:runtime.endHookFailed', {}, 'endHook failed'))
        return
      }
    }
    this.state.status = 'completed'
    this.state.workflowCompleted = true
    await this.persistAndEmit('completed')
  }

  private async runTerminalNode(
    node: WorkflowNode,
    options: { moveNext: boolean; runHooks: boolean; branch?: WorkflowRuntimeBranchRun }
  ): Promise<boolean> {
    const isInteractive = node.type === 'interactive-terminal'
    const config = node.config as InteractiveTerminalConfig | NonInteractiveTerminalConfig
    const variables = this.contextVariables(node.id, options.branch)
    let command: ShellNeutralCommand
    let displayCommand: string
    let cwd: string
    let preparationError: string | undefined
    try {
      command = bindShellCommand(config.command, variables, Object.keys(config.env ?? {}))
      displayCommand = interpolate(config.command, variables)
      cwd = interpolate(config.cwd, variables)
    } catch (error) {
      command = { version: 1, segments: [{ type: 'literal', value: '' }], bindings: {} }
      displayCommand = config.command
      cwd = this.state.projectDir
      preparationError = error instanceof Error ? error.message : String(error)
    }

    this.state.nodeRuns[node.id] = { nodeId: node.id, status: 'running' }
    await this.persistAndEmit('running')
    if (this.stopped) return false

    const result = await this.adapter.runProcess({
      taskId: this.state.taskId,
      nodeId: node.id,
      kind: isInteractive ? 'interactive' : 'non-interactive',
      command,
      displayCommand,
      cwd,
      sourceCwd: cwd,
      executionTarget: this.state.executionContext?.target,
      env: config.env,
      timeoutMs: 'timeoutMs' in config ? config.timeoutMs : undefined,
      preparationError
    })

    if (this.stopped) return false

    return this.completeTerminalNode(node, result, options)
  }

  private async completeTerminalNode(
    node: WorkflowNode,
    result: WorkflowRuntimeProcessResult,
    options: { moveNext: boolean; runHooks: boolean; branch?: WorkflowRuntimeBranchRun }
  ): Promise<boolean> {
    const isInteractive = node.type === 'interactive-terminal'
    const config = node.config as InteractiveTerminalConfig | NonInteractiveTerminalConfig
    const successCodes = 'successExitCodes' in config ? config.successExitCodes : [0]
    const completed = result.status !== 'failed' && result.status !== 'interrupted' && (
      result.status === 'killed' || isInteractive || successCodes.includes(result.exitCode ?? -1)
    )
    this.state.nodeRuns[node.id] = {
      nodeId: node.id,
      status: completed ? 'completed' : 'failed',
      sessionId: result.sessionId,
      stdout: tailText(result.stdout, MAX_PROCESS_RESULT_CHARS),
      stderr: tailText(result.stderr, MAX_PROCESS_RESULT_CHARS),
      exitCode: result.exitCode
    }

    if (!completed) {
      if (options.branch) {
        options.branch.status = 'failed'
        options.branch.error = this.formatProcessFailure(node.name, result)
        await this.persistAndEmit(this.state.status)
      } else {
        this.state.status = 'failed'
        this.state.error = this.formatProcessFailure(node.name, result)
        await this.persistAndEmit('failed')
      }
      return false
    }

    if (options.runHooks && node.endHook?.enabled) {
      const outcome = await this.runHook(node, node.endHook, 'end', options.branch)
      if (this.stopped) return false
      if (!outcome.ok) {
        if (options.branch) {
          this.failBranch(options.branch, outcome.error ?? this.tr('errors:runtime.endHookFailed', {}, 'endHook failed'))
          await this.persistAndEmit(this.state.status)
        } else {
          await this.failCurrentNode(outcome.error ?? this.tr('errors:runtime.endHookFailed', {}, 'endHook failed'))
        }
        return false
      }
    }
    if (options.moveNext) this.selectNextNode(node.id)
    await this.persistAndEmit(this.state.status)
    return true
  }

  private async runHook(
    node: WorkflowNode,
    hook: HookConfig,
    hookType: 'start' | 'end',
    branch?: WorkflowRuntimeBranchRun
  ): Promise<{ ok: boolean; error?: string }> {
    let result: WorkflowRuntimeHookResult
    try {
      const variables = this.contextVariables(node.id, branch)
      let command: ShellNeutralCommand
      let cwd: string
      let preparationError: string | undefined
      try {
        command = bindShellCommand(hook.command, variables, Object.keys(hook.env ?? {}))
        cwd = hook.cwd ? interpolate(hook.cwd, variables) : this.state.projectDir
      } catch (error) {
        command = { version: 1, segments: [{ type: 'literal', value: '' }], bindings: {} }
        cwd = this.state.projectDir
        preparationError = error instanceof Error ? error.message : String(error)
      }
      result = await this.adapter.runHook({
        taskId: this.state.taskId,
        nodeId: node.id,
        hookType,
        command,
        cwd,
        sourceCwd: cwd,
        executionTarget: this.state.executionContext?.target,
        env: hook.env,
        preparationError
      })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return hook.failPolicy === 'fail-node'
        ? { ok: false, error: this.tr('errors:runtime.hookFailed', { hookType, detail }, `${hookType}Hook failed: ${detail}`) }
        : { ok: true }
    }
    const failed = result.status === 'failed' || result.status === 'killed' || result.exitCode !== 0
    if (!failed || hook.failPolicy === 'continue') return { ok: true }
    const detail = tailText(result.stderr, 2_000).trim() || this.tr('status:runtime.exitCode', { code: String(result.exitCode ?? 'null') }, `Exit code ${result.exitCode ?? 'null'}`)
    return { ok: false, error: this.tr('errors:runtime.hookFailed', { hookType, detail }, `${hookType}Hook failed: ${detail}`) }
  }

  private selectNextNode(nodeId: string): void {
    const edge = this.workflow.edges.find((item) => item.from === nodeId)
    if (edge) {
      this.state.currentNodeId = edge.to
      return
    }

    this.state.status = 'completed'
    this.state.workflowCompleted = true
  }

  private selectExclusiveEdge(node: WorkflowNode, branch?: WorkflowRuntimeBranchRun): WorkflowEdge | undefined {
    const edges = this.getOutgoingEdges(node.id)
    return edges.find((item) => item.condition && evaluateExpression(item.condition, this.contextVariables(node.id, branch)))
      ?? edges.find((item) => item.isDefault)
  }

  private getOutgoingEdges(nodeId: string): WorkflowEdge[] {
    return this.workflow.edges.filter((edge) => edge.from === nodeId)
  }

  private createBranchId(splitNodeId: string, entryEdgeId: string): string {
    return `${splitNodeId}:${entryEdgeId}`
  }

  private inputScope(nodeId: string, branch?: WorkflowRuntimeBranchRun): string {
    return branch ? `${branch.branchId}:${nodeId}` : `workflow:${nodeId}`
  }

  private async failCurrentNode(message: string): Promise<void> {
    this.state.nodeRuns[this.state.currentNodeId] = {
      nodeId: this.state.currentNodeId,
      status: 'failed',
      stderr: message
    }
    this.state.status = 'failed'
    this.state.error = message
    await this.persistAndEmit('failed')
  }

  private async persistAndEmit(taskStatus: WorkflowRuntimeStatus): Promise<void> {
    const task = await this.adapter.persistTask(this.getState(), taskStatus)
    if (task) this.state.task = task
    this.adapter.emitState(this.getState())
  }

  private contextVariables(currentNodeId: string, branch?: WorkflowRuntimeBranchRun): Record<string, VariableValue> {
    const last = this.lastCommandRun(branch?.nodeIds)
    const joinResult = this.state.lastJoinResultSplitNodeId
      ? this.state.parallelResults[this.state.lastJoinResultSplitNodeId]
      : undefined
    return {
      ...(branch?.variables ?? this.state.variables),
      ...getSystemVariables({
        taskId: this.state.taskId,
        projectDir: this.state.projectDir,
        workflowId: this.workflow.id,
        currentNodeId,
        lastNodeId: last?.nodeId,
        lastCommand: last?.command,
        branchId: branch?.branchId,
        branchSplitNodeId: branch?.splitNodeId,
        branchEntryEdgeId: branch?.entryEdgeId,
        joinSplitNodeId: joinResult?.splitNodeId,
        joinNodeId: joinResult?.joinNodeId,
        joinResultsJson: joinResult ? JSON.stringify(joinResult) : ''
      })
    }
  }

  private lastCommandRun(nodeIds?: string[]): { nodeId: string; command: LastCommand } | undefined {
    const order = nodeIds ?? this.state.executionOrder
    for (const nodeId of [...order].reverse()) {
      const run = this.state.nodeRuns[nodeId]
      if (!run || (run.status !== 'completed' && run.status !== 'failed')) continue
      if (run.stdout === undefined && run.stderr === undefined && run.exitCode === undefined) continue
      return {
        nodeId,
        command: {
          stdout: run.stdout ?? '',
          stderr: run.stderr ?? '',
          exitCode: run.exitCode ?? null
        }
      }
    }
    return undefined
  }

  private recordExecution(nodeId: string): boolean {
    this.nodeExecutionCount += 1
    if (this.nodeExecutionCount > WorkflowRuntimeEngine.MAX_NODE_EXECUTIONS) return false
    if (!this.state.executionOrder.includes(nodeId)) {
      this.state.executionOrder.push(nodeId)
    }
    return true
  }

  private applyVariableDefaults(variables: VariableDefinition[], target: Record<string, VariableValue>): void {
    for (const variable of variables) {
      if (target[variable.key] !== undefined || variable.defaultValue === undefined) continue
      target[variable.key] = coerceValue(variable.defaultValue, variable.type)
    }
  }

  private formatProcessFailure(name: string, result: WorkflowRuntimeProcessResult): string {
    const detail = tailText(result.stderr, 2_000).trim()
    if (detail) return `${name}: ${detail}`
    return this.tr('status:runtime.nodeExitCode', { name, code: String(result.exitCode ?? 'null') }, `${name}: exit code ${result.exitCode ?? 'null'}`)
  }

  private findBranchForNode(
    nodeId: string,
    branchId?: string
  ): WorkflowRuntimeBranchRun | undefined {
    if (branchId) {
      const branch = this.state.branchRuns[branchId]
      return branch?.currentNodeId === nodeId ? branch : undefined
    }
    return Object.values(this.state.branchRuns).find((branch) => (
      branch.currentNodeId === nodeId &&
      (branch.status === 'running' || isRetryableRunStatus(branch.status))
    ))
  }

  private findNode(nodeId: string): WorkflowNode | undefined {
    return this.workflow.nodes.find((node) => node.id === nodeId)
  }
}

function isEmptyValue(value: VariableValue | undefined): boolean {
  return value === undefined || value === null || value === ''
}

export function isRetryableRunStatus(status: NodeRunStatus | WorkflowRuntimeStatus): boolean {
  return status === 'failed' || status === 'stopped' || status === 'interrupted'
}

function coerceValue(value: unknown, type: string): VariableValue {
  if (type === 'number') {
    if (value === undefined || value === null || value === '') return 0
    const numberValue = Number(value)
    return Number.isNaN(numberValue) ? 0 : numberValue
  }
  if (value === undefined || value === null) return ''
  if (typeof value === 'boolean') return value
  return String(value)
}

function cloneRuntimeState(state: WorkflowRuntimeState): WorkflowRuntimeState {
  return deepClone(state)
}

function deepClone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(deepClone) as unknown as T
  const result: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>)) {
    result[key] = deepClone((value as Record<string, unknown>)[key])
  }
  return result as T
}
