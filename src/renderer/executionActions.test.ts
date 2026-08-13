import { describe, expect, it } from 'vitest'
import type { NodeRunStatus } from '../shared/workflow'
import type { WorkflowRuntimeStatus } from '../shared/workflowRuntime'
import type { TerminalSessionStatus } from '../shared/terminalSession'
import {
  getNodeAction,
  getTerminalAction,
  getTerminalWorkflowRole,
  getWorkflowAction
} from './executionActions'

describe('execution action mapping', () => {
  it.each([
    ['running', 'stop-workflow'],
    ['waiting-input', 'stop-workflow'],
    ['completed', null],
    ['failed', null],
    ['stopped', null],
    ['interrupted', null]
  ] as Array<[WorkflowRuntimeStatus, ReturnType<typeof getWorkflowAction>]>) (
    'maps workflow status %s to %s',
    (status, action) => {
      expect(getWorkflowAction(status)).toBe(action)
    }
  )

  it('does not expose a workflow action before a runtime exists', () => {
    expect(getWorkflowAction(null)).toBeNull()
  })

  it.each([
    ['pending', true, false, 'run'],
    ['pending', false, false, null],
    ['running', true, false, null],
    ['waiting-input', true, false, 'continue'],
    ['completed', true, false, null],
    ['failed', true, false, 'retry-node'],
    ['stopped', true, false, 'retry-node'],
    ['interrupted', true, false, 'retry-node']
  ] as Array<[NodeRunStatus, boolean, boolean, ReturnType<typeof getNodeAction>]>) (
    'maps non-terminal node status %s with canRun=%s to %s',
    (status, canRun, hasWorkflowRetrySession, action) => {
      expect(getNodeAction({
        nodeType: 'input',
        status,
        canOperate: true,
        canRun,
        hasWorkflowRetrySession
      })).toBe(action)
    }
  )

  it.each(['failed', 'stopped', 'interrupted'] as NodeRunStatus[])(
    'uses the terminal session retry instead of a second node action for %s',
    (status) => {
      expect(getNodeAction({
        nodeType: 'non-interactive-terminal',
        status,
        canOperate: true,
        canRun: false,
        hasWorkflowRetrySession: true
      })).toBeNull()
      expect(getNodeAction({
        nodeType: 'non-interactive-terminal',
        status,
        canOperate: true,
        canRun: false,
        hasWorkflowRetrySession: false
      })).toBe('retry-node')
    }
  )

  it('hides every node action when the node is not operable', () => {
    expect(getNodeAction({
      nodeType: 'start',
      status: 'pending',
      canOperate: false,
      canRun: true,
      hasWorkflowRetrySession: false
    })).toBeNull()
  })

  it.each([
    ['running', 'current', 'end-and-continue'],
    ['closed', 'current', null],
    ['closed', 'retryable', 'retry-workflow'],
    ['failed', 'retryable', 'retry-workflow'],
    ['interrupted', 'retryable', 'retry-workflow'],
    ['running', 'retryable', null],
    ['running', 'history', 'stop-command'],
    ['closed', 'history', 'rerun-command'],
    ['failed', 'history', 'rerun-command'],
    ['killed', 'history', 'rerun-command'],
    ['interrupted', 'history', 'rerun-command']
  ] as Array<[
    TerminalSessionStatus,
    Parameters<typeof getTerminalAction>[1],
    ReturnType<typeof getTerminalAction>
  ]>)('maps a %s %s terminal to %s', (status, role, action) => {
    expect(getTerminalAction(status, role)).toBe(action)
  })

  it('ties workflow terminal actions to the current run session', () => {
    expect(getTerminalWorkflowRole({
      sessionId: 'current',
      sessionIsLatest: true,
      nodeStatus: 'interrupted',
      nodeSessionId: 'current',
      canOperate: true
    })).toBe('retryable')
    expect(getTerminalWorkflowRole({
      sessionId: 'old',
      sessionIsLatest: false,
      nodeStatus: 'interrupted',
      nodeSessionId: 'current',
      canOperate: true
    })).toBe('history')
  })

  it('uses the latest session when an interrupted node was persisted before receiving its session id', () => {
    expect(getTerminalWorkflowRole({
      sessionId: 'latest',
      sessionIsLatest: true,
      nodeStatus: 'interrupted',
      canOperate: true
    })).toBe('retryable')
  })

  it('uses the latest session while a running node is still waiting for its session id', () => {
    expect(getTerminalWorkflowRole({
      sessionId: 'latest',
      sessionIsLatest: true,
      nodeStatus: 'running',
      canOperate: true
    })).toBe('current')
  })

  it('does not attach an unrelated latest session to a failed node without a session id', () => {
    expect(getTerminalWorkflowRole({
      sessionId: 'historical-session',
      sessionIsLatest: true,
      nodeStatus: 'failed',
      canOperate: true
    })).toBe('history')
  })

  it('uses the latest session for a stopped node whose result was discarded by workflow stop', () => {
    expect(getTerminalWorkflowRole({
      sessionId: 'stopped-session',
      sessionIsLatest: true,
      nodeStatus: 'stopped',
      canOperate: true
    })).toBe('retryable')
  })
})
