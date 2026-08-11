import { AppError } from './appError'
import type { ShellNeutralCommand } from './shell'
import type { TranslationKey } from './i18n/types'
import type { TranslationIssue } from './i18n/translator'

export type NodeType =
  | 'start'
  | 'interactive-terminal'
  | 'non-interactive-terminal'
  | 'input'
  | 'exclusive-gateway'
  | 'parallel-gateway'
  | 'end'

export type VariableValue = string | number | boolean | null

export type VariableType = 'text' | 'number'

export type VariableDefinition = {
  key: string
  label: string
  type: VariableType
  required: boolean
  order?: number
  defaultValue?: unknown
  options?: string[]
}

export type HookConfig = {
  enabled: boolean
  command: string
  cwd?: string
  env?: Record<string, string>
  failPolicy: 'continue' | 'fail-node'
}

export type StartNodeConfig = {
  variables: VariableDefinition[]
}

export type InteractiveTerminalConfig = {
  command: string
  cwd: string
  env?: Record<string, string>
  shell?: string
  autoStart: boolean
}

export type NonInteractiveTerminalConfig = {
  command: string
  cwd: string
  env?: Record<string, string>
  timeoutMs?: number
  successExitCodes: number[]
}

export type InputNodeConfig = {
  variables: VariableDefinition[]
}

export type ExclusiveGatewayConfig = {
  defaultEdgeId?: string
}

export type ParallelGatewayConfig = {
  mode: 'split' | 'join'
  joinIncomingEdgeIds?: string[]
}

export type EndNodeConfig = Record<string, never>

export type WorkflowNode = {
  id: string
  type: NodeType
  name: string
  config:
    | StartNodeConfig
    | InteractiveTerminalConfig
    | NonInteractiveTerminalConfig
    | InputNodeConfig
    | ExclusiveGatewayConfig
    | ParallelGatewayConfig
    | EndNodeConfig
  startHook?: HookConfig
  endHook?: HookConfig
}

export type WorkflowEdge = {
  id: string
  from: string
  to: string
  condition?: string
  isDefault?: boolean
}

export type WorkflowDefinition = {
  id: string
  name: string
  description?: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  layout?: {
    nodes: Record<string, { x: number; y: number }>
  }
}

const WORKFLOW_NODE_TYPES: readonly NodeType[] = [
  'start',
  'interactive-terminal',
  'non-interactive-terminal',
  'input',
  'exclusive-gateway',
  'parallel-gateway',
  'end'
]

const MAX_WORKFLOW_NODES = 1_000
const MAX_WORKFLOW_EDGES = 5_000
const MAX_WORKFLOW_STRING = 100_000

/**
 * Structural runtime boundary for persisted workflow definitions. This accepts
 * snapshots that are structurally safe but may be temporarily incomplete (for
 * example a stopped historical designer snapshot).
 */
export function parseWorkflowDefinitionStructure(value: unknown): WorkflowDefinition {
  const workflow = requireRecord(value, 'Workflow')
  const id = requireBoundedString(workflow.id, 'Workflow ID', 1, 512)
  const name = requireBoundedString(workflow.name, 'Workflow name', 1, 512)
  const description = optionalBoundedString(workflow.description, 'Workflow description', MAX_WORKFLOW_STRING)
  const rawNodes = requireArray(workflow.nodes, 'Workflow nodes', MAX_WORKFLOW_NODES)
  const rawEdges = requireArray(workflow.edges, 'Workflow edges', MAX_WORKFLOW_EDGES)

  const nodeIds = new Set<string>()
  const nodes = rawNodes.map((rawNode, index) => {
    const node = parseWorkflowNode(rawNode, index)
    if (nodeIds.has(node.id)) {
      throw new AppError({
        code: 'WORKFLOW_INVALID',
        message: `Duplicate node ID: ${node.id}`,
        i18nKey: 'errors:workflowValidation.duplicateNodeId',
        params: { id: node.id }
      })
    }
    nodeIds.add(node.id)
    return node
  })

  const edgeIds = new Set<string>()
  const edges = rawEdges.map((rawEdge, index) => {
    const edge = parseWorkflowEdge(rawEdge, index)
    if (edgeIds.has(edge.id)) {
      throw new AppError({
        code: 'WORKFLOW_INVALID',
        message: `Duplicate edge ID: ${edge.id}`,
        i18nKey: 'errors:workflowValidation.duplicateEdgeId',
        params: { id: edge.id }
      })
    }
    edgeIds.add(edge.id)
    if (!nodeIds.has(edge.from)) {
      throw new AppError({
        code: 'WORKFLOW_INVALID',
        message: `${edge.id}: source node does not exist`,
        i18nKey: 'errors:workflowValidation.fromNodeMissing',
        params: { id: edge.id }
      })
    }
    if (!nodeIds.has(edge.to)) {
      throw new AppError({
        code: 'WORKFLOW_INVALID',
        message: `${edge.id}: target node does not exist`,
        i18nKey: 'errors:workflowValidation.toNodeMissing',
        params: { id: edge.id }
      })
    }
    return edge
  })

  const layout = parseWorkflowLayout(workflow.layout, nodeIds)
  const parsed: WorkflowDefinition = {
    id,
    name,
    ...(description === undefined ? {} : { description }),
    nodes,
    edges,
    ...(layout ? { layout } : {})
  }
  return parsed
}

/** Runtime boundary for workflow writes and explicit validation. */
export function parseWorkflowDefinition(value: unknown): WorkflowDefinition {
  const normalized = parseWorkflowDefinitionStructure(value)
  const errors = validateWorkflow(normalized)
  if (errors.length > 0) {
    throw new AppError({
      code: 'WORKFLOW_INVALID',
      message: 'Invalid workflow definition',
      i18nKey: 'errors:workflowValidation.workflow'
    })
  }
  return normalized
}

function parseWorkflowNode(value: unknown, index: number): WorkflowNode {
  const label = `Node ${index + 1}`
  const node = requireRecord(value, label)
  const id = requireBoundedString(node.id, `${label} ID`, 1, 512)
  if (typeof node.type !== 'string' || !WORKFLOW_NODE_TYPES.includes(node.type as NodeType)) {
    throw new AppError({
      code: 'WORKFLOW_INVALID',
      message: `${id}: unsupported node type`,
      i18nKey: 'errors:workflowValidation.unsupportedNodeType',
      params: { id }
    })
  }
  const type = node.type as NodeType
  const name = requireBoundedString(node.name, `${id}: node name`, 1, 512)
  const config = parseNodeConfig(type, node.config, id)
  const startHook = node.startHook === undefined
    ? undefined
    : parseHookConfig(node.startHook, `${id}: startHook`)
  const endHook = node.endHook === undefined
    ? undefined
    : parseHookConfig(node.endHook, `${id}: endHook`)
  return {
    id,
    type,
    name,
    config,
    ...(startHook ? { startHook } : {}),
    ...(endHook ? { endHook } : {})
  }
}

function parseNodeConfig(type: NodeType, value: unknown, nodeId: string): WorkflowNode['config'] {
  const config = requireRecord(value, `${nodeId}: config`)
  if (type === 'start' || type === 'input') {
    return { variables: parseVariableDefinitions(config.variables, `${nodeId}: variables`) }
  }
  if (type === 'interactive-terminal') {
    return {
      command: requireBoundedString(config.command, `${nodeId}: command`, 1, MAX_WORKFLOW_STRING),
      cwd: requireBoundedString(config.cwd, `${nodeId}: cwd`, 1, 4_096),
      ...(config.env === undefined ? {} : { env: parseStringRecord(config.env, `${nodeId}: env`) }),
      ...(config.shell === undefined ? {} : {
        shell: requireBoundedString(config.shell, `${nodeId}: shell`, 1, 4_096)
      }),
      autoStart: requireBoolean(config.autoStart, `${nodeId}: autoStart`)
    }
  }
  if (type === 'non-interactive-terminal') {
    const successExitCodes = requireArray(config.successExitCodes, `${nodeId}: successExitCodes`, 256)
      .map((code) => requireInteger(code, `${nodeId}: successExitCodes`, -255, 255))
    return {
      command: requireBoundedString(config.command, `${nodeId}: command`, 1, MAX_WORKFLOW_STRING),
      cwd: requireBoundedString(config.cwd, `${nodeId}: cwd`, 1, 4_096),
      ...(config.env === undefined ? {} : { env: parseStringRecord(config.env, `${nodeId}: env`) }),
      ...(config.timeoutMs === undefined ? {} : {
        timeoutMs: requireInteger(config.timeoutMs, `${nodeId}: timeoutMs`, 1, 86_400_000)
      }),
      successExitCodes
    }
  }
  if (type === 'exclusive-gateway') {
    return config.defaultEdgeId === undefined
      ? {}
      : { defaultEdgeId: requireBoundedString(config.defaultEdgeId, `${nodeId}: defaultEdgeId`, 1, 512) }
  }
  if (type === 'parallel-gateway') {
    if (config.mode !== 'split' && config.mode !== 'join') {
      throw new AppError({
        code: 'WORKFLOW_INVALID',
        message: `${nodeId}: mode must be split or join`,
        i18nKey: 'errors:workflowValidation.gatewayMode',
        params: { id: nodeId }
      })
    }
    const joinIncomingEdgeIds = config.joinIncomingEdgeIds === undefined
      ? undefined
      : requireArray(config.joinIncomingEdgeIds, `${nodeId}: joinIncomingEdgeIds`, MAX_WORKFLOW_EDGES)
        .map((edgeId) => requireBoundedString(edgeId, `${nodeId}: joinIncomingEdgeIds`, 1, 512))
    return {
      mode: config.mode,
      ...(joinIncomingEdgeIds ? { joinIncomingEdgeIds } : {})
    }
  }
  return {}
}

function parseVariableDefinitions(value: unknown, label: string): VariableDefinition[] {
  return requireArray(value, label, 1_000).map((rawVariable, index) => {
    const variable = requireRecord(rawVariable, `${label}[${index}]`)
    if (variable.type !== 'text' && variable.type !== 'number') {
      throw new AppError({
        code: 'WORKFLOW_INVALID',
        message: `${label}[${index}]: type must be text or number`,
        i18nKey: 'errors:workflowValidation.variableType',
        params: { label, index }
      })
    }
    const options = variable.options === undefined
      ? undefined
      : requireArray(variable.options, `${label}[${index}].options`, 1_000)
        .map((option) => requireBoundedString(option, `${label}[${index}].options`, 0, 10_000))
    return {
      key: requireBoundedString(variable.key, `${label}[${index}].key`, 1, 512),
      label: requireBoundedString(variable.label, `${label}[${index}].label`, 1, 512),
      type: variable.type,
      required: requireBoolean(variable.required, `${label}[${index}].required`),
      ...(variable.order === undefined ? {} : {
        order: requireInteger(variable.order, `${label}[${index}].order`, 1, 1_000_000)
      }),
      ...(variable.defaultValue === undefined ? {} : {
        defaultValue: parseJsonScalar(variable.defaultValue, `${label}[${index}].defaultValue`)
      }),
      ...(options ? { options } : {})
    }
  })
}

function parseHookConfig(value: unknown, label: string): HookConfig {
  const hook = requireRecord(value, label)
  if (hook.failPolicy !== 'continue' && hook.failPolicy !== 'fail-node') {
    throw new AppError({
      code: 'WORKFLOW_INVALID',
      message: `${label}: failPolicy must be continue or fail-node`,
      i18nKey: 'errors:workflowValidation.failPolicy',
      params: { label }
    })
  }
  return {
    enabled: requireBoolean(hook.enabled, `${label}.enabled`),
    command: requireBoundedString(hook.command, `${label}.command`, 0, MAX_WORKFLOW_STRING),
    ...(hook.cwd === undefined ? {} : { cwd: requireBoundedString(hook.cwd, `${label}.cwd`, 1, 4_096) }),
    ...(hook.env === undefined ? {} : { env: parseStringRecord(hook.env, `${label}.env`) }),
    failPolicy: hook.failPolicy
  }
}

function parseWorkflowEdge(value: unknown, index: number): WorkflowEdge {
  const edge = requireRecord(value, `Edge ${index + 1}`)
  const id = requireBoundedString(edge.id, `Edge ${index + 1} ID`, 1, 512)
  return {
    id,
    from: requireBoundedString(edge.from, `${id}: from`, 1, 512),
    to: requireBoundedString(edge.to, `${id}: to`, 1, 512),
    ...(edge.condition === undefined ? {} : {
      condition: requireBoundedString(edge.condition, `${id}: condition`, 0, MAX_WORKFLOW_STRING)
    }),
    ...(edge.isDefault === undefined ? {} : {
      isDefault: requireBoolean(edge.isDefault, `${id}: isDefault`)
    })
  }
}

function parseWorkflowLayout(
  value: unknown,
  nodeIds: Set<string>
): WorkflowDefinition['layout'] | undefined {
  if (value === undefined) return undefined
  const layout = requireRecord(value, 'Workflow layout')
  const rawNodes = requireRecord(layout.nodes, 'Workflow layout nodes')
  if (Object.keys(rawNodes).length > MAX_WORKFLOW_NODES) {
    throw new AppError({
      code: 'WORKFLOW_INVALID',
      message: 'Too many workflow layout nodes',
      i18nKey: 'errors:workflowValidation.tooManyLayoutNodes'
    })
  }
  const nodes: Record<string, { x: number; y: number }> = {}
  for (const [nodeId, rawPosition] of Object.entries(rawNodes)) {
    if (!nodeIds.has(nodeId)) {
      throw new AppError({
        code: 'WORKFLOW_INVALID',
        message: `Workflow layout references a missing node: ${nodeId}`,
        i18nKey: 'errors:workflowValidation.layoutNodeMissing',
        params: { id: nodeId }
      })
    }
    const positionLabel = `${nodeId}: layout position`
    const position = requireRecord(rawPosition, positionLabel)
    nodes[nodeId] = {
      x: requireFiniteNumber(position.x, `${nodeId}: x`),
      y: requireFiniteNumber(position.y, `${nodeId}: y`)
    }
  }
  return { nodes }
}

function parseStringRecord(value: unknown, label: string): Record<string, string> {
  const record = requireRecord(value, label)
  if (Object.keys(record).length > 1_000) {
    throw new AppError({
      code: 'WORKFLOW_INVALID',
      message: `${label}: too many entries`,
      i18nKey: 'errors:workflowValidation.tooManyEntries',
      params: { label }
    })
  }
  const parsed: Record<string, string> = {}
  for (const [key, item] of Object.entries(record)) {
    if (!key || key.length > 512 || key.includes('\0')) {
      throw new AppError({
        code: 'WORKFLOW_INVALID',
        message: `${label} contains an invalid key`,
        i18nKey: 'errors:workflowValidation.invalidKey',
        params: { label }
      })
    }
    parsed[key] = requireBoundedString(item, `${label}.${key}`, 0, MAX_WORKFLOW_STRING)
  }
  return parsed
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AppError({
      code: 'WORKFLOW_INVALID',
      message: `${label} must be an object`,
      i18nKey: 'errors:workflowValidation.mustBeObject',
      params: { label }
    })
  }
  return value as Record<string, unknown>
}

function requireArray(value: unknown, label: string, maxLength: number): unknown[] {
  if (!Array.isArray(value)) {
    throw new AppError({
      code: 'WORKFLOW_INVALID',
      message: `${label} must be an array`,
      i18nKey: 'errors:workflowValidation.mustBeArray',
      params: { label }
    })
  }
  if (value.length > maxLength) {
    throw new AppError({
      code: 'WORKFLOW_INVALID',
      message: `${label} count exceeds the limit of ${maxLength}`,
      i18nKey: 'errors:workflowValidation.arrayTooLong',
      params: { label, maxLength }
    })
  }
  return value
}

function requireBoundedString(
  value: unknown,
  label: string,
  minLength: number,
  maxLength: number
): string {
  if (typeof value !== 'string') {
    throw new AppError({
      code: 'WORKFLOW_INVALID',
      message: `${label} must be a string`,
      i18nKey: 'errors:workflowValidation.mustBeString',
      params: { label }
    })
  }
  if (value.includes('\0')) {
    throw new AppError({
      code: 'WORKFLOW_INVALID',
      message: `${label} must not contain a NUL character`,
      i18nKey: 'errors:workflowValidation.mustNotContainNul',
      params: { label }
    })
  }
  if (value.length < minLength) {
    throw new AppError({
      code: 'WORKFLOW_INVALID',
      message: `${label} must not be empty`,
      i18nKey: 'errors:workflowValidation.mustNotBeEmpty',
      params: { label }
    })
  }
  if (value.length > maxLength) {
    throw new AppError({
      code: 'WORKFLOW_INVALID',
      message: `${label} is too long`,
      i18nKey: 'errors:workflowValidation.tooLong',
      params: { label }
    })
  }
  return value
}

function optionalBoundedString(value: unknown, label: string, maxLength: number): string | undefined {
  return value === undefined ? undefined : requireBoundedString(value, label, 0, maxLength)
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new AppError({
      code: 'WORKFLOW_INVALID',
      message: `${label} must be a boolean`,
      i18nKey: 'errors:workflowValidation.mustBeBoolean',
      params: { label }
    })
  }
  return value
}

function requireInteger(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new AppError({
      code: 'WORKFLOW_INVALID',
      message: `${label} must be an integer between ${min} and ${max}`,
      i18nKey: 'errors:workflowValidation.mustBeInteger',
      params: { label, min, max }
    })
  }
  return value as number
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 10_000_000) {
    throw new AppError({
      code: 'WORKFLOW_INVALID',
      message: `${label} must be a finite number`,
      i18nKey: 'errors:workflowValidation.mustBeFinite',
      params: { label }
    })
  }
  return value
}

function parseJsonScalar(value: unknown, label: string): string | number | boolean | null {
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') return requireBoundedString(value, label, 0, MAX_WORKFLOW_STRING)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new AppError({
    code: 'WORKFLOW_INVALID',
    message: `${label} must be a string, number, boolean, or null`,
    i18nKey: 'errors:workflowValidation.mustBePrimitive',
    params: { label }
  })
}

type WorkflowEntityKind = 'workflow' | 'node' | 'edge'

export function duplicateWorkflowDefinition(
  definition: WorkflowDefinition,
  options: {
    name: string
    createId: (kind: WorkflowEntityKind, sourceId: string) => string
  }
): WorkflowDefinition {
  const duplicate = structuredClone(definition)
  const nodeIds = new Map(
    duplicate.nodes.map((node) => [node.id, options.createId('node', node.id)])
  )
  const edgeIds = new Map(
    duplicate.edges.map((edge) => [edge.id, options.createId('edge', edge.id)])
  )

  return {
    ...duplicate,
    id: options.createId('workflow', duplicate.id),
    name: options.name,
    nodes: duplicate.nodes.map((node) => {
      let config = node.config

      if (node.type === 'exclusive-gateway') {
        const exclusiveConfig = node.config as ExclusiveGatewayConfig
        config = exclusiveConfig.defaultEdgeId
          ? {
              ...exclusiveConfig,
              defaultEdgeId: edgeIds.get(exclusiveConfig.defaultEdgeId) ?? exclusiveConfig.defaultEdgeId
            }
          : exclusiveConfig
      }

      if (node.type === 'parallel-gateway') {
        const parallelConfig = node.config as ParallelGatewayConfig
        config = parallelConfig.joinIncomingEdgeIds
          ? {
              ...parallelConfig,
              joinIncomingEdgeIds: parallelConfig.joinIncomingEdgeIds.map(
                (edgeId) => edgeIds.get(edgeId) ?? edgeId
              )
            }
          : parallelConfig
      }

      return {
        ...node,
        id: nodeIds.get(node.id) ?? node.id,
        config
      }
    }),
    edges: duplicate.edges.map((edge) => ({
      ...edge,
      id: edgeIds.get(edge.id) ?? edge.id,
      from: nodeIds.get(edge.from) ?? edge.from,
      to: nodeIds.get(edge.to) ?? edge.to
    })),
    layout: duplicate.layout
      ? {
          nodes: Object.fromEntries(
            Object.entries(duplicate.layout.nodes).map(([nodeId, position]) => [
              nodeIds.get(nodeId) ?? nodeId,
              position
            ])
          )
        }
      : undefined
  }
}

export type LastCommand = {
  stdout: string
  stderr: string
  exitCode: number | null
}

export type NodeRunStatus = 'pending' | 'running' | 'waiting-input' | 'completed' | 'failed' | 'stopped' | 'interrupted'

export const SYSTEM_VARIABLES = [
  'sys_task_id',
  'sys_project_dir',
  'sys_workflow_id',
  'sys_current_node_id',
  'sys_last_node_id',
  'sys_last_command_stdout',
  'sys_last_command_stderr',
  'sys_last_command_exit_code',
  'sys_branch_id',
  'sys_branch_split_node_id',
  'sys_branch_entry_edge_id',
  'sys_join_split_node_id',
  'sys_join_node_id',
  'sys_join_results_json'
] as const

type SystemVariableName = (typeof SYSTEM_VARIABLES)[number]

export function validateUserVariableKey(key: string): TranslationIssue | null {
  if (!key.trim()) return { key: 'errors:workflowValidation.variableKeyEmpty' }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return { key: 'errors:workflowValidation.variableKeyPattern' }
  if (key.startsWith('sys_')) return { key: 'errors:workflowValidation.variableKeySysPrefix' }
  return null
}

export function validateVariableDefinitions(variables: VariableDefinition[]): TranslationIssue[] {
  const errors: TranslationIssue[] = []
  const seen = new Set<string>()

  for (const variable of variables) {
    const keyError = validateUserVariableKey(variable.key)
    if (keyError) errors.push(keyError)
    if (
      variable.order !== undefined &&
      (!Number.isInteger(variable.order) || variable.order < 1)
    ) {
      errors.push({
        key: 'errors:workflowValidation.variableOrderInvalid',
        params: { label: variable.label || variable.key }
      })
    }
    if (seen.has(variable.key)) {
      errors.push({
        key: 'errors:workflowValidation.variableKeyDuplicate',
        params: { key: variable.key }
      })
    }
    seen.add(variable.key)
  }

  return errors
}

export function sortVariableDefinitions(variables: VariableDefinition[]): VariableDefinition[] {
  return variables
    .map((variable, index) => ({ variable, index }))
    .sort((left, right) => {
      const leftOrder =
        Number.isInteger(left.variable.order) && left.variable.order! >= 1
          ? left.variable.order!
          : Number.POSITIVE_INFINITY
      const rightOrder =
        Number.isInteger(right.variable.order) && right.variable.order! >= 1
          ? right.variable.order!
          : Number.POSITIVE_INFINITY
      return leftOrder - rightOrder || left.index - right.index
    })
    .map(({ variable }) => variable)
}

export function getSystemVariables(args: {
  taskId: string
  projectDir: string
  workflowId: string
  currentNodeId: string
  lastNodeId?: string
  lastCommand?: LastCommand
  branchId?: string
  branchSplitNodeId?: string
  branchEntryEdgeId?: string
  joinSplitNodeId?: string
  joinNodeId?: string
  joinResultsJson?: string
}): Record<SystemVariableName, VariableValue> {
  return {
    sys_task_id: args.taskId,
    sys_project_dir: args.projectDir,
    sys_workflow_id: args.workflowId,
    sys_current_node_id: args.currentNodeId,
    sys_last_node_id: args.lastNodeId ?? '',
    sys_last_command_stdout: args.lastCommand?.stdout ?? '',
    sys_last_command_stderr: args.lastCommand?.stderr ?? '',
    sys_last_command_exit_code: args.lastCommand?.exitCode ?? null,
    sys_branch_id: args.branchId ?? '',
    sys_branch_split_node_id: args.branchSplitNodeId ?? '',
    sys_branch_entry_edge_id: args.branchEntryEdgeId ?? '',
    sys_join_split_node_id: args.joinSplitNodeId ?? '',
    sys_join_node_id: args.joinNodeId ?? '',
    sys_join_results_json: args.joinResultsJson ?? ''
  }
}

export const SYSTEM_VARIABLE_DESCRIPTIONS: Record<SystemVariableName, TranslationKey> = {
  sys_task_id: 'workflow:systemVariable.sys_task_id',
  sys_project_dir: 'workflow:systemVariable.sys_project_dir',
  sys_workflow_id: 'workflow:systemVariable.sys_workflow_id',
  sys_current_node_id: 'workflow:systemVariable.sys_current_node_id',
  sys_last_node_id: 'workflow:systemVariable.sys_last_node_id',
  sys_last_command_stdout: 'workflow:systemVariable.sys_last_command_stdout',
  sys_last_command_stderr: 'workflow:systemVariable.sys_last_command_stderr',
  sys_last_command_exit_code: 'workflow:systemVariable.sys_last_command_exit_code',
  sys_branch_id: 'workflow:systemVariable.sys_branch_id',
  sys_branch_split_node_id: 'workflow:systemVariable.sys_branch_split_node_id',
  sys_branch_entry_edge_id: 'workflow:systemVariable.sys_branch_entry_edge_id',
  sys_join_split_node_id: 'workflow:systemVariable.sys_join_split_node_id',
  sys_join_node_id: 'workflow:systemVariable.sys_join_node_id',
  sys_join_results_json: 'workflow:systemVariable.sys_join_results_json'
}

const VARIABLE_REFERENCE_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g
const SHELL_VARIABLE_PREFIX = 'CLILOOM_INTERNAL_VALUE_'

export type BoundShellVariables = {
  command: string
  env: Record<string, string>
}

function stringifyVariable(value: VariableValue | undefined): string {
  if (value === undefined || value === null) return ''
  const result = String(value)
  if (result.includes('\0')) {
    throw new AppError({
      code: 'WORKFLOW_INVALID',
      message: 'Workflow variables must not contain a NUL character',
      i18nKey: 'errors:workflowValidation.workflowVariableNul'
    })
  }
  return result
}

export function interpolate(template: string, variables: Record<string, VariableValue>): string {
  return template.replace(VARIABLE_REFERENCE_PATTERN, (_match, key: string) => {
    return stringifyVariable(variables[key])
  })
}

// Keep untrusted values out of shell source. Shell parameter expansion does not
// recursively interpret command substitutions or quoting characters from values.
export function bindShellVariables(
  template: string,
  variables: Record<string, VariableValue>
): BoundShellVariables {
  const neutral = bindShellCommand(template, variables)
  return {
    command: neutral.segments.map((segment) => (
      segment.type === 'literal' ? segment.value : `\${${segment.name}}`
    )).join(''),
    env: { ...neutral.bindings }
  }
}

/**
 * Bind workflow values without choosing a shell syntax. The main process turns
 * binding segments into POSIX, PowerShell or cmd references immediately before
 * a process is spawned.
 */
export function bindShellCommand(
  template: string,
  variables: Record<string, VariableValue>,
  reservedEnvironmentNames: Iterable<string> = []
): ShellNeutralCommand {
  if (template.includes('\0')) {
    throw new AppError({
      code: 'WORKFLOW_INVALID',
      message: 'Terminal commands must not contain a NUL character',
      i18nKey: 'errors:workflowValidation.terminalCommandNul'
    })
  }

  const variableNames = new Map<string, string>()
  const bindings: Record<string, string> = {}
  const segments: ShellNeutralCommand['segments'] = []
  const reservedNames = new Set(
    [...reservedEnvironmentNames].map((name) => name.toLowerCase())
  )
  let literalStart = 0

  VARIABLE_REFERENCE_PATTERN.lastIndex = 0
  for (let match = VARIABLE_REFERENCE_PATTERN.exec(template); match; match = VARIABLE_REFERENCE_PATTERN.exec(template)) {
    if (match.index > literalStart) {
      segments.push({ type: 'literal', value: template.slice(literalStart, match.index) })
    }
    const key = match[1]
    let variableName = variableNames.get(key)
    if (!variableName) {
      let candidateIndex = variableNames.size
      do {
        variableName = `${SHELL_VARIABLE_PREFIX}${candidateIndex}`
        candidateIndex += 1
      } while (reservedNames.has(variableName.toLowerCase()) || Object.hasOwn(bindings, variableName))
      variableNames.set(key, variableName)
      bindings[variableName] = stringifyVariable(variables[key])
    }
    segments.push({ type: 'binding', name: variableName })
    literalStart = match.index + match[0].length
  }
  if (literalStart < template.length || segments.length === 0) {
    segments.push({ type: 'literal', value: template.slice(literalStart) })
  }

  return { version: 1, segments, bindings }
}

export function validateWorkflow(definition: WorkflowDefinition): TranslationIssue[] {
  const errors: TranslationIssue[] = []
  const startNodes = definition.nodes.filter((node) => node.type === 'start')
  const nodeIds = new Set(definition.nodes.map((node) => node.id))

  if (startNodes.length !== 1) errors.push({ key: 'errors:workflowValidation.singleStartNode' })

  for (const edge of definition.edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push({ key: 'errors:workflowValidation.fromNodeMissing', params: { id: edge.id } })
    }
    if (!nodeIds.has(edge.to)) {
      errors.push({ key: 'errors:workflowValidation.toNodeMissing', params: { id: edge.id } })
    }
  }

  for (const node of definition.nodes) {
    const outgoingEdges = definition.edges.filter((edge) => edge.from === node.id)
    const incomingEdges = definition.edges.filter((edge) => edge.to === node.id)

    if (node.type === 'start' && outgoingEdges.length === 0) errors.push({ key: 'errors:workflowValidation.startNeedsOutgoingEdge' })
    if (node.type === 'start' && incomingEdges.length > 0) errors.push({ key: 'errors:workflowValidation.startHasIncomingEdge' })
    if (node.type === 'end' && outgoingEdges.length > 0) {
      errors.push({ key: 'errors:workflowValidation.endHasOutgoingEdge', params: { name: node.name } })
    }
    if (node.type !== 'start' && incomingEdges.length === 0) {
      errors.push({ key: 'errors:workflowValidation.missingIncomingEdge', params: { name: node.name } })
    }
    if (node.type !== 'start' && node.type !== 'end' && outgoingEdges.length === 0) {
      errors.push({ key: 'errors:workflowValidation.missingOutgoingEdge', params: { name: node.name } })
    }
    if (node.type !== 'end' && node.type !== 'exclusive-gateway' && node.type !== 'parallel-gateway' && outgoingEdges.length > 1) {
      errors.push({ key: 'errors:workflowValidation.normalNodeSingleOutgoingEdge', params: { name: node.name } })
    }

    if (node.type === 'exclusive-gateway') {
      const config = node.config as ExclusiveGatewayConfig
      const defaultEdges = outgoingEdges.filter((edge) => edge.isDefault)
      if (defaultEdges.length > 1) {
        errors.push({ key: 'errors:workflowValidation.singleDefaultBranch', params: { name: node.name } })
      }
      if (config.defaultEdgeId && !outgoingEdges.some((edge) => edge.id === config.defaultEdgeId)) {
        errors.push({ key: 'errors:workflowValidation.invalidDefaultEdgeId', params: { name: node.name } })
      }
    }

    if (node.type === 'parallel-gateway') {
      const config = node.config as ParallelGatewayConfig
      if (config.mode === 'split' && outgoingEdges.length < 2) {
        errors.push({ key: 'errors:workflowValidation.splitNeedsTwoOutgoingEdges', params: { name: node.name } })
      }

      if (config.mode === 'join') {
        const joinIncomingEdgeIds = config.joinIncomingEdgeIds ?? []
        if (joinIncomingEdgeIds.length === 0) {
          errors.push({ key: 'errors:workflowValidation.joinNeedsIncomingEdgeIds', params: { name: node.name } })
        }

        const uniqueIds = new Set(joinIncomingEdgeIds)
        if (uniqueIds.size !== joinIncomingEdgeIds.length) {
          errors.push({ key: 'errors:workflowValidation.joinIncomingEdgeIdsDuplicate', params: { name: node.name } })
        }

        const referencedEdges = joinIncomingEdgeIds.map((edgeId) => definition.edges.find((edge) => edge.id === edgeId))
        if (referencedEdges.some((edge) => !edge)) {
          errors.push({ key: 'errors:workflowValidation.joinIncomingEdgeIdsMissingEdge', params: { name: node.name } })
        }
        if (referencedEdges.some((edge) => edge && edge.to !== node.id)) {
          errors.push({ key: 'errors:workflowValidation.joinIncomingEdgeIdsMustTargetJoin', params: { name: node.name } })
        }
      }
    }
  }

  const joinIncomingEdgeOwners = new Map<string, string>()
  for (const node of definition.nodes) {
    if (node.type !== 'parallel-gateway') continue
    const config = node.config as ParallelGatewayConfig
    if (config.mode !== 'join') continue
    for (const edgeId of config.joinIncomingEdgeIds ?? []) {
      const owner = joinIncomingEdgeOwners.get(edgeId)
      if (owner && owner !== node.id) {
        errors.push({ key: 'errors:workflowValidation.joinIncomingEdgeIdsSharedByMultipleJoins', params: { name: node.name } })
      }
      joinIncomingEdgeOwners.set(edgeId, node.id)
    }
  }

  for (const node of definition.nodes) {
    if (node.type === 'start' || node.type === 'input') {
      const config = node.config as StartNodeConfig | InputNodeConfig
      errors.push(...validateVariableDefinitions(config.variables ?? []))
    }

    if (node.type === 'interactive-terminal' || node.type === 'non-interactive-terminal') {
      const config = node.config as InteractiveTerminalConfig | NonInteractiveTerminalConfig
      const command = typeof config.command === 'string' ? config.command.trim() : ''
      const cwd = typeof config.cwd === 'string' ? config.cwd.trim() : ''
      if (!command) {
        errors.push({ key: 'errors:workflowValidation.terminalCommandEmpty', params: { name: node.name } })
      }
      if (!cwd) {
        errors.push({ key: 'errors:workflowValidation.workingDirEmpty', params: { name: node.name } })
      }
    }
  }

  return errors
}

export function getAvailableUserVariables(
  graph: { nodes: WorkflowNode[]; edges: WorkflowEdge[] },
  nodeId: string
): VariableDefinition[] {
  const node = graph.nodes.find((item) => item.id === nodeId)
  if (!node) return []

  const startNodes = graph.nodes.filter((item) => item.type === 'start')
  if (startNodes.length !== 1) return []
  const startId = startNodes[0].id

  const allDefs: VariableDefinition[] = []
  const allKeys = new Set<string>()
  const gen = new Map<string, Set<string>>()
  for (const item of graph.nodes) {
    if (item.type !== 'start' && item.type !== 'input') continue
    const config = item.config as StartNodeConfig | InputNodeConfig
    const keys = new Set<string>()
    for (const variable of config.variables ?? []) {
      if (validateUserVariableKey(variable.key) !== null) continue
      keys.add(variable.key)
      if (!allKeys.has(variable.key)) {
        allKeys.add(variable.key)
        allDefs.push(variable)
      }
    }
    gen.set(item.id, keys)
  }

  const preds = new Map<string, string[]>()
  const succs = new Map<string, string[]>()
  for (const item of graph.nodes) {
    preds.set(item.id, [])
    succs.set(item.id, [])
  }
  for (const edge of graph.edges) {
    preds.get(edge.to)?.push(edge.from)
    succs.get(edge.from)?.push(edge.to)
  }

  const inSets = new Map<string, Set<string>>()
  const outSets = new Map<string, Set<string>>()
  for (const item of graph.nodes) {
    const initial = item.id === startId ? new Set<string>() : new Set(allKeys)
    inSets.set(item.id, initial)
    outSets.set(item.id, new Set([...initial, ...(gen.get(item.id) ?? [])]))
  }

  const worklist: string[] = graph.nodes.map((item) => item.id)
  while (worklist.length > 0) {
    const current = worklist.shift()!
    const predList = preds.get(current) ?? []
    const newIn: Set<string> =
      current === startId
        ? new Set<string>()
        : predList.length === 0
          ? new Set(allKeys)
          : intersectSets(predList.map((p) => outSets.get(p) ?? new Set()))
    const newOut = new Set([...newIn, ...(gen.get(current) ?? [])])
    inSets.set(current, newIn)
    if (!setsEqual(newOut, outSets.get(current)!)) {
      outSets.set(current, newOut)
      for (const next of succs.get(current) ?? []) {
        if (!worklist.includes(next)) worklist.push(next)
      }
    }
  }

  const resultIn = inSets.get(nodeId) ?? new Set()
  return sortVariableDefinitions(allDefs.filter((definition) => resultIn.has(definition.key)))
}

function intersectSets<T>(sets: Set<T>[]): Set<T> {
  if (sets.length === 0) return new Set()
  const result = new Set(sets[0])
  for (let index = 1; index < sets.length; index += 1) {
    const current = sets[index]
    for (const value of [...result]) {
      if (!current.has(value)) result.delete(value)
    }
  }
  return result
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false
  for (const value of a) {
    if (!b.has(value)) return false
  }
  return true
}
