import type {
  WorkflowRuntimeNodeRun,
  WorkflowRuntimeParallelJoinResult,
  WorkflowRuntimeState
} from '../shared/workflowRuntime'
import { MAX_PROCESS_RESULT_CHARS, tailText } from '../shared/terminalBuffer'

type JsonRecord = Record<string, unknown>

export function compactRuntimeState(state: WorkflowRuntimeState): WorkflowRuntimeState {
  return {
    ...state,
    nodeRuns: compactNodeRuns(state.nodeRuns),
    parallelResults: compactParallelResults(state.parallelResults),
    task: state.task ? { ...state.task } : undefined
  }
}

export function compactNodeRun(run: WorkflowRuntimeNodeRun): WorkflowRuntimeNodeRun {
  return {
    ...run,
    stdout: boundOutput(run.stdout),
    stderr: boundOutput(run.stderr)
  }
}

export function compactStoredNodeRunOutput(value: unknown): JsonRecord {
  if (!isRecord(value)) return {}
  return {
    ...value,
    stdout: boundUnknownOutput(value.stdout),
    stderr: boundUnknownOutput(value.stderr)
  }
}

export function compactStoredRuntimeContext(value: unknown): JsonRecord {
  if (!isRecord(value)) return {}
  const compacted: JsonRecord = {
    ...value,
    parallelResults: compactStoredParallelResults(value.parallelResults)
  }
  if (isRecord(value.nodeRuns)) {
    compacted.nodeRuns = Object.fromEntries(
      Object.entries(value.nodeRuns).map(([nodeId, run]) => [
        nodeId,
        isRecord(run)
          ? { ...run, ...compactStoredNodeRunOutput(run) }
          : run
      ])
    )
  }
  delete compacted.task
  return compacted
}

export function toStoredWorkflowContext(state: WorkflowRuntimeState): Omit<WorkflowRuntimeState, 'task' | 'nodeRuns'> {
  const { task: _task, nodeRuns: _nodeRuns, ...context } = state
  return {
    ...context,
    parallelResults: compactParallelResults(context.parallelResults)
  }
}

export function toStoredTaskContext(state: WorkflowRuntimeState): JsonRecord {
  return toStoredTaskContextRecord(state)
}

export function toStoredTaskContextRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) return {}
  const context = { ...value }
  delete context.task
  delete context.nodeRuns
  delete context.parallelResults
  return context
}

export function toStoredWorkflowContextRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) return {}
  const context: JsonRecord = {
    ...value,
    parallelResults: compactStoredParallelResults(value.parallelResults)
  }
  delete context.task
  delete context.nodeRuns
  return context
}

function compactNodeRuns(
  nodeRuns: Record<string, WorkflowRuntimeNodeRun>
): Record<string, WorkflowRuntimeNodeRun> {
  return Object.fromEntries(
    Object.entries(nodeRuns).map(([nodeId, run]) => [nodeId, compactNodeRun(run)])
  )
}

function compactParallelResults(
  parallelResults: Record<string, WorkflowRuntimeParallelJoinResult>
): Record<string, WorkflowRuntimeParallelJoinResult> {
  return Object.fromEntries(
    Object.entries(parallelResults).map(([splitNodeId, result]) => [
      splitNodeId,
      {
        ...result,
        branches: Object.fromEntries(
          Object.entries(result.branches).map(([edgeId, branch]) => [
            edgeId,
            {
              ...branch,
              lastCommand: branch.lastCommand
                ? {
                    ...branch.lastCommand,
                    stdout: tailText(branch.lastCommand.stdout, MAX_PROCESS_RESULT_CHARS),
                    stderr: tailText(branch.lastCommand.stderr, MAX_PROCESS_RESULT_CHARS)
                  }
                : undefined,
              nodeRuns: compactNodeRuns(branch.nodeRuns)
            }
          ])
        )
      }
    ])
  )
}

function compactStoredParallelResults(value: unknown): unknown {
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([splitNodeId, result]) => {
      if (!isRecord(result) || !isRecord(result.branches)) return [splitNodeId, result]
      return [
        splitNodeId,
        {
          ...result,
          branches: Object.fromEntries(
            Object.entries(result.branches).map(([edgeId, branch]) => {
              if (!isRecord(branch)) return [edgeId, branch]
              const compactedBranch: JsonRecord = { ...branch }
              if (isRecord(branch.lastCommand)) {
                compactedBranch.lastCommand = {
                  ...branch.lastCommand,
                  stdout: boundUnknownOutput(branch.lastCommand.stdout),
                  stderr: boundUnknownOutput(branch.lastCommand.stderr)
                }
              }
              if (isRecord(branch.nodeRuns)) {
                compactedBranch.nodeRuns = Object.fromEntries(
                  Object.entries(branch.nodeRuns).map(([nodeId, run]) => [
                    nodeId,
                    isRecord(run)
                      ? { ...run, ...compactStoredNodeRunOutput(run) }
                      : run
                  ])
                )
              }
              return [edgeId, compactedBranch]
            })
          )
        }
      ]
    })
  )
}

function boundOutput(value: string | undefined): string | undefined {
  return value === undefined ? undefined : tailText(value, MAX_PROCESS_RESULT_CHARS)
}

function boundUnknownOutput(value: unknown): unknown {
  return typeof value === 'string' ? tailText(value, MAX_PROCESS_RESULT_CHARS) : value
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
