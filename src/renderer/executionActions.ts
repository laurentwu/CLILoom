import type { NodeRunStatus, WorkflowNode } from '../shared/workflow'
import {
  isRetryableRunStatus,
  type WorkflowRuntimeStatus
} from '../shared/workflowRuntime'
import {
  isTerminalSessionRunning,
  type TerminalSessionStatus
} from '../shared/terminalSession'

export type WorkflowAction = 'stop-workflow'

export type NodeAction = 'run' | 'continue' | 'retry-node'

export type TerminalWorkflowRole = 'current' | 'retryable' | 'history'

export type TerminalAction =
  | 'end-and-continue'
  | 'retry-workflow'
  | 'rerun-command'
  | 'stop-command'

export function getWorkflowAction(
  status: WorkflowRuntimeStatus | null
): WorkflowAction | null {
  return status === 'running' || status === 'waiting-input'
    ? 'stop-workflow'
    : null
}

export function getNodeAction({
  nodeType,
  status,
  canOperate,
  canRun,
  hasWorkflowRetrySession
}: {
  nodeType: WorkflowNode['type']
  status: NodeRunStatus
  canOperate: boolean
  canRun: boolean
  hasWorkflowRetrySession: boolean
}): NodeAction | null {
  if (!canOperate) return null
  if (status === 'pending') return canRun ? 'run' : null
  if (status === 'waiting-input') return 'continue'
  if (!isRetryableRunStatus(status)) return null

  const isTerminalNode = nodeType === 'interactive-terminal' || nodeType === 'non-interactive-terminal'
  return isTerminalNode && hasWorkflowRetrySession ? null : 'retry-node'
}

export function getTerminalWorkflowRole({
  sessionId,
  sessionIsLatest,
  nodeStatus,
  nodeSessionId,
  canOperate
}: {
  sessionId: string
  sessionIsLatest: boolean
  nodeStatus: NodeRunStatus
  nodeSessionId?: string
  canOperate: boolean
}): TerminalWorkflowRole {
  if (!canOperate) return 'history'
  const belongsToCurrentRun = nodeSessionId
    ? nodeSessionId === sessionId
    : sessionIsLatest && (
        nodeStatus === 'running' ||
        nodeStatus === 'stopped' ||
        nodeStatus === 'interrupted'
      )
  if (!belongsToCurrentRun) return 'history'
  if (nodeStatus === 'running') return 'current'
  return isRetryableRunStatus(nodeStatus) ? 'retryable' : 'history'
}

export function getTerminalAction(
  status: TerminalSessionStatus,
  role: TerminalWorkflowRole
): TerminalAction | null {
  if (role === 'current') {
    return isTerminalSessionRunning(status) ? 'end-and-continue' : null
  }
  if (role === 'retryable') {
    return isTerminalSessionRunning(status) ? null : 'retry-workflow'
  }
  return isTerminalSessionRunning(status) ? 'stop-command' : 'rerun-command'
}
