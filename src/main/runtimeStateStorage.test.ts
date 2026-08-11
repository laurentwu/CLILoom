import { describe, expect, it } from 'vitest'
import { MAX_PROCESS_RESULT_CHARS } from '../shared/terminalBuffer'
import type { WorkflowRuntimeState } from '../shared/workflowRuntime'
import {
  compactRuntimeState,
  compactStoredNodeRunOutput,
  compactStoredRuntimeContext,
  toStoredTaskContext,
  toStoredTaskContextRecord,
  toStoredWorkflowContext,
  toStoredWorkflowContextRecord
} from './runtimeStateStorage'

function oversizedOutput(label: string): string {
  return `${label}:${'x'.repeat(MAX_PROCESS_RESULT_CHARS)}:tail`
}

function state(): WorkflowRuntimeState {
  return {
    taskId: 'task-1',
    projectId: 'project-1',
    projectDir: '/repo',
    workflowId: 'workflow-1',
    status: 'completed',
    currentNodeId: 'end',
    variables: { prompt: 'test' },
    nodeRuns: {
      terminal: {
        nodeId: 'terminal',
        status: 'completed',
        stdout: oversizedOutput('node-stdout'),
        stderr: oversizedOutput('node-stderr'),
        exitCode: 0
      }
    },
    executionOrder: ['terminal', 'end'],
    activeBranches: [],
    branchRuns: {},
    parallelResults: {
      split: {
        splitNodeId: 'split',
        joinNodeId: 'join',
        requiredIncomingEdgeIds: ['edge-left'],
        branches: {
          'edge-left': {
            branchId: 'branch-left',
            entryEdgeId: 'edge-left',
            entryNodeId: 'left',
            reachedJoinEdgeId: 'left-join',
            reachedJoinNodeId: 'join',
            status: 'completed',
            nodeIds: ['left'],
            variables: {},
            lastCommand: {
              nodeId: 'left',
              stdout: oversizedOutput('command-stdout'),
              stderr: oversizedOutput('command-stderr'),
              exitCode: 0
            },
            nodeRuns: {
              left: {
                nodeId: 'left',
                status: 'completed',
                stdout: oversizedOutput('branch-stdout'),
                stderr: oversizedOutput('branch-stderr'),
                exitCode: 0
              }
            }
          }
        }
      }
    },
    workflowCompleted: true,
    task: {
      id: 'task-1',
      project_id: 'project-1',
      title: 'Task',
      status: 'completed'
    }
  }
}

describe('runtime state storage', () => {
  it('bounds runtime output at every nesting level without mutating the source state', () => {
    const source = state()
    const sourceNodeOutput = source.nodeRuns.terminal.stdout!
    const sourceNodeError = source.nodeRuns.terminal.stderr!
    const sourceBranch = source.parallelResults.split.branches['edge-left']
    const sourceCommandOutput = sourceBranch.lastCommand!.stdout
    const sourceCommandError = sourceBranch.lastCommand!.stderr
    const sourceBranchOutput = sourceBranch.nodeRuns.left.stdout!
    const sourceBranchError = sourceBranch.nodeRuns.left.stderr!

    const compacted = compactRuntimeState(source)

    expect(compacted.nodeRuns.terminal.stdout).toBe(sourceNodeOutput.slice(-MAX_PROCESS_RESULT_CHARS))
    expect(compacted.nodeRuns.terminal.stderr).toBe(sourceNodeError.slice(-MAX_PROCESS_RESULT_CHARS))
    expect(compacted.parallelResults.split.branches['edge-left'].lastCommand?.stdout)
      .toBe(sourceCommandOutput.slice(-MAX_PROCESS_RESULT_CHARS))
    expect(compacted.parallelResults.split.branches['edge-left'].lastCommand?.stderr)
      .toBe(sourceCommandError.slice(-MAX_PROCESS_RESULT_CHARS))
    expect(compacted.parallelResults.split.branches['edge-left'].nodeRuns.left.stdout)
      .toBe(sourceBranchOutput.slice(-MAX_PROCESS_RESULT_CHARS))
    expect(compacted.parallelResults.split.branches['edge-left'].nodeRuns.left.stderr)
      .toBe(sourceBranchError.slice(-MAX_PROCESS_RESULT_CHARS))
    expect(compacted.task).toEqual(source.task)
    expect(compacted.task).not.toBe(source.task)
    expect(source.nodeRuns.terminal.stdout).toBe(sourceNodeOutput)
    expect(source.nodeRuns.terminal.stderr).toBe(sourceNodeError)
    expect(sourceBranch.lastCommand?.stdout).toBe(sourceCommandOutput)
    expect(sourceBranch.lastCommand?.stderr).toBe(sourceCommandError)
    expect(sourceBranch.nodeRuns.left.stdout).toBe(sourceBranchOutput)
    expect(sourceBranch.nodeRuns.left.stderr).toBe(sourceBranchError)
  })

  it('compacts persisted JSON shapes while preserving unknown fields', () => {
    const stdout = oversizedOutput('stored-stdout')
    const branchStdout = oversizedOutput('stored-branch-stdout')
    const compacted = compactStoredRuntimeContext({
      task: { id: 'duplicated-task' },
      custom: 'preserved',
      nodeRuns: {
        terminal: { stdout, stderr: 42, customRunField: true },
        legacy: 'preserved'
      },
      parallelResults: {
        split: {
          branches: {
            left: {
              lastCommand: { stdout: branchStdout, stderr: null, exitCode: 0 },
              nodeRuns: {
                left: { stdout: branchStdout, stderr: undefined }
              },
              customBranchField: true
            }
          }
        }
      }
    })

    expect(compacted).not.toHaveProperty('task')
    expect(compacted.custom).toBe('preserved')
    expect(compacted.nodeRuns).toMatchObject({
      terminal: {
        stdout: stdout.slice(-MAX_PROCESS_RESULT_CHARS),
        stderr: 42,
        customRunField: true
      },
      legacy: 'preserved'
    })
    expect(compacted.parallelResults).toMatchObject({
      split: {
        branches: {
          left: {
            lastCommand: {
              stdout: branchStdout.slice(-MAX_PROCESS_RESULT_CHARS),
              stderr: null,
              exitCode: 0
            },
            nodeRuns: {
              left: { stdout: branchStdout.slice(-MAX_PROCESS_RESULT_CHARS) }
            },
            customBranchField: true
          }
        }
      }
    })
  })

  it('separates task and workflow persistence contexts', () => {
    const source = state()
    const taskContext = toStoredTaskContext(source)
    const workflowContext = toStoredWorkflowContext(source)

    expect(taskContext).not.toHaveProperty('task')
    expect(taskContext).not.toHaveProperty('nodeRuns')
    expect(taskContext).not.toHaveProperty('parallelResults')
    expect(taskContext).toMatchObject({ taskId: 'task-1', workflowId: 'workflow-1' })

    expect(workflowContext).not.toHaveProperty('task')
    expect(workflowContext).not.toHaveProperty('nodeRuns')
    expect(workflowContext.parallelResults.split.branches['edge-left'].lastCommand?.stdout)
      .toHaveLength(MAX_PROCESS_RESULT_CHARS)

    expect(toStoredTaskContextRecord({
      task: { id: 'task-1' },
      nodeRuns: { terminal: {} },
      parallelResults: { split: {} },
      custom: 'task-context'
    })).toEqual({ custom: 'task-context' })

    const storedWorkflowContext = toStoredWorkflowContextRecord(source)
    expect(storedWorkflowContext).not.toHaveProperty('task')
    expect(storedWorkflowContext).not.toHaveProperty('nodeRuns')
    const storedParallelResults = storedWorkflowContext.parallelResults as WorkflowRuntimeState['parallelResults']
    expect(storedParallelResults.split.branches['edge-left'].lastCommand?.stdout)
      .toHaveLength(MAX_PROCESS_RESULT_CHARS)
  })

  it('handles malformed persisted values without inventing structure', () => {
    expect(compactStoredNodeRunOutput(null)).toEqual({})
    expect(compactStoredNodeRunOutput({ stdout: 7, stderr: ['legacy'] })).toEqual({
      stdout: 7,
      stderr: ['legacy']
    })
    expect(compactStoredRuntimeContext([])).toEqual({})
    expect(toStoredTaskContextRecord('invalid')).toEqual({})
    expect(toStoredWorkflowContextRecord(null)).toEqual({})
    expect(compactStoredRuntimeContext({
      task: 'remove',
      nodeRuns: 'legacy-node-runs',
      parallelResults: 'legacy-parallel-results'
    })).toEqual({
      nodeRuns: 'legacy-node-runs',
      parallelResults: 'legacy-parallel-results'
    })
  })
})
