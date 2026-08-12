import { sortVariableDefinitions } from '../shared/workflow'
import type {
  InputNodeConfig,
  NodeRunStatus,
  StartNodeConfig,
  VariableDefinition,
  VariableValue,
  WorkflowDefinition,
  WorkflowNode
} from '../shared/workflow'
import type { WorkflowRuntimeBranchRun } from '../shared/workflowRuntime'
import type { TranslationKey } from '../shared/i18n/types'
import { isAppError } from '../shared/appError'
import { getAutomaticTaskTitle } from '../shared/taskTitle'
import { i18n } from './i18n'

export type NodeRun = {
  nodeId: string
  status: NodeRunStatus
  sessionId?: string
  stdout?: string
  stderr?: string
  exitCode?: number | null
}

export function getNodeTypeLabel(type: WorkflowNode['type']): TranslationKey {
  if (type === 'start') return 'workflow:nodeType.start'
  if (type === 'interactive-terminal') return 'workflow:nodeType.interactiveTerminal'
  if (type === 'non-interactive-terminal') return 'workflow:nodeType.nonInteractiveTerminal'
  if (type === 'input') return 'workflow:nodeType.input'
  if (type === 'exclusive-gateway') return 'workflow:nodeType.exclusiveGateway'
  if (type === 'parallel-gateway') return 'workflow:nodeType.parallelGateway'
  return 'workflow:nodeType.end'
}

export function getCurrentInputVariables(node: WorkflowNode): VariableDefinition[] {
  if (node.type === 'start' || node.type === 'input') {
    return sortVariableDefinitions((node.config as StartNodeConfig | InputNodeConfig).variables)
  }
  return []
}

export function getDefaultVariables(workflow: WorkflowDefinition): Record<string, VariableValue> {
  const defaults: Record<string, VariableValue> = {}
  for (const node of workflow.nodes) {
    if (node.type !== 'start') continue
    for (const variable of (node.config as StartNodeConfig).variables) {
      defaults[variable.key] = coerceValue(variable.defaultValue ?? '', variable.type)
    }
  }
  return defaults
}

export function getDefaultNodeConfig(type: WorkflowNode['type']): WorkflowNode['config'] {
  if (type === 'start' || type === 'input') return { variables: [] }
  if (type === 'interactive-terminal') return { command: '', cwd: '${sys_project_dir}', autoStart: true }
  if (type === 'non-interactive-terminal') return { command: '', cwd: '${sys_project_dir}', successExitCodes: [0] }
  if (type === 'exclusive-gateway') return {}
  if (type === 'parallel-gateway') return { mode: 'split' }
  return {}
}

export function coerceValue(value: unknown, type: string): VariableValue {
  if (type === 'number') {
    if (value === undefined || value === null || value === '') return 0
    const n = Number(value)
    return Number.isNaN(n) ? 0 : n
  }
  if (value === undefined || value === null) return ''
  return String(value)
}

export type NodeStopTarget =
  | { kind: 'terminal-session'; sessionId: string }
  | { kind: 'unavailable' }
  | { kind: 'workflow' }

export function getNodeStopTarget(node: WorkflowNode, sessions: TerminalSession[]): NodeStopTarget {
  if (node.type === 'interactive-terminal' || node.type === 'non-interactive-terminal') {
    const sessionKind = node.type === 'interactive-terminal' ? 'interactive' : 'non-interactive'
    const session = sessions.find((item) =>
      item.node_id === node.id &&
      item.kind === sessionKind &&
      item.status.startsWith('running')
    )
    if (session) return { kind: 'terminal-session', sessionId: session.id }
    return { kind: 'unavailable' }
  }
  return { kind: 'workflow' }
}

export function getTaskTitle(
  workflow: WorkflowDefinition,
  variables: Record<string, VariableValue>
): string {
  return getAutomaticTaskTitle(workflow, variables, i18n.t('task:defaultTitle'))
}

export function mergeTaskRecord<T extends { id: string }>(
  tasks: T[],
  task: T,
  moveToFront: boolean
): T[] {
  if (moveToFront) {
    return [task, ...tasks.filter((item) => item.id !== task.id)]
  }

  const taskIndex = tasks.findIndex((item) => item.id === task.id)
  if (taskIndex < 0) return [task, ...tasks]
  return tasks.map((item, index) => index === taskIndex ? task : item)
}

export function canStartNewTask({ hasActiveProject }: { hasActiveProject: boolean }): boolean {
  return hasActiveProject
}

export function canSwitchTaskWorkflow({
  isNewTaskDraft,
  activeTaskId,
  persistedTaskIds,
  runtimeTaskId,
  startingWorkflowTaskId
}: {
  isNewTaskDraft: boolean
  activeTaskId: string
  persistedTaskIds: string[]
  runtimeTaskId: string | null
  startingWorkflowTaskId: string | null
}): boolean {
  return Boolean(
    isNewTaskDraft &&
    !persistedTaskIds.includes(activeTaskId) &&
    runtimeTaskId !== activeTaskId &&
    startingWorkflowTaskId !== activeTaskId
  )
}

export function hasModifiedWorkflowVariables(
  variables: Record<string, VariableValue>,
  defaults: Record<string, VariableValue>
): boolean {
  const variableKeys = Object.keys(variables)
  const defaultKeys = Object.keys(defaults)
  if (variableKeys.length !== defaultKeys.length) return true

  return defaultKeys.some((key) => (
    !Object.prototype.hasOwnProperty.call(variables, key) ||
    !Object.is(variables[key], defaults[key])
  ))
}

export function shouldResetActiveTaskAfterDelete({
  activeTaskId,
  deletedTaskId
}: {
  activeTaskId: string
  deletedTaskId: string
}): boolean {
  return activeTaskId === deletedTaskId
}

export function getNextActiveProjectIdAfterDelete<T extends { id: string }>({
  projects,
  deletedProjectId
}: {
  projects: T[]
  deletedProjectId: string
}): string | null {
  return projects.find((project) => project.id !== deletedProjectId)?.id ?? null
}

export type NodeOperationState = {
  branchId?: string
  canOperate: boolean
  isRunning: boolean
  isWaitingForInput: boolean
}

export function getNodeOperationState({
  nodeId,
  runtimeCurrentNodeId,
  isRunning,
  isWaitingForInput,
  branchRuns
}: {
  nodeId: string
  runtimeCurrentNodeId: string
  isRunning: boolean
  isWaitingForInput: boolean
  branchRuns: Record<string, WorkflowRuntimeBranchRun>
}): NodeOperationState {
  const activeBranch = Object.values(branchRuns).find((branch) =>
    branch.currentNodeId === nodeId &&
    (branch.status === 'running' || branch.status === 'waiting-input')
  )

  if (activeBranch) {
    return {
      branchId: activeBranch.branchId,
      canOperate: true,
      isRunning: activeBranch.status === 'running',
      isWaitingForInput: activeBranch.status === 'waiting-input'
    }
  }

  const isCurrentNode = runtimeCurrentNodeId === nodeId
  return {
    canOperate: isCurrentNode,
    isRunning: isRunning && isCurrentNode,
    isWaitingForInput: isWaitingForInput && isCurrentNode
  }
}

export type NodeDetailZoomTarget =
  | { kind: 'graph' }
  | { kind: 'parallel'; splitNodeId: string }

export function getNodeDetailZoomTarget(target: NodeDetailZoomTarget | null): NodeDetailZoomTarget {
  return target ?? { kind: 'graph' }
}

export function getNodeDetailZoomTitle(target: NodeDetailZoomTarget | null): string {
  return getNodeDetailZoomTarget(target).kind === 'parallel'
    ? i18n.t('node:zoom.backToGateway')
    : i18n.t('node:zoom.flowGraph')
}

export function getParallelGroupBranchesForNode(
  node: WorkflowNode | undefined,
  branchRuns: Record<string, WorkflowRuntimeBranchRun>
): WorkflowRuntimeBranchRun[] {
  if (!node || node.type !== 'parallel-gateway') return []

  const branches = Object.values(branchRuns)
  const splitBranches = branches.filter((branch) => branch.splitNodeId === node.id)
  if (splitBranches.length > 0) return splitBranches

  return branches.filter((branch) => branch.reachedJoinNodeId === node.id || branch.currentNodeId === node.id)
}

export function getBranchRouteNodeIds(branch: WorkflowRuntimeBranchRun): string[] {
  const nodeIds = [branch.entryNodeId, ...branch.nodeIds]
  if (branch.status === 'running' || branch.status === 'waiting-input') {
    nodeIds.push(branch.currentNodeId)
  }
  return Array.from(new Set(nodeIds.filter(Boolean)))
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function handleError(error: unknown, context: string) {
  console.error(`[${context}]`, error)
  const message = isAppError(error) && error.i18nKey
    ? i18n.t(error.i18nKey, error.params)
    : (error instanceof Error ? error.message : String(error))
  window.dispatchEvent(new CustomEvent('app:error', { detail: { text: `[${context}] ${message}`, type: 'error' } }))
}

export type TerminalSession = {
  id: string
  task_id: string
  node_id: string
  kind: string
  command: string
  cwd: string
  status: string
  transcript: string | null
  transcript_cursor?: number | null
  execution_target?: {
    kind: 'native'
    displayName: string
  }
}

export function canRetryTerminalSession(session: TerminalSession): boolean {
  return !session.status.startsWith('running')
}

export function canAcceptTerminalInput(session: TerminalSession): boolean {
  return session.kind === 'interactive' && session.status.startsWith('running')
}
