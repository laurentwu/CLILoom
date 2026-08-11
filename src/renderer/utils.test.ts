import { describe, expect, it } from 'vitest'
import type { WorkflowNode } from '../shared/workflow'
import {
  canAcceptTerminalInput,
  canRetryTerminalSession,
  canStartNewTask,
  canSwitchTaskWorkflow,
  getBranchRouteNodeIds,
  getCurrentInputVariables,
  getNodeDetailZoomTarget,
  getNodeOperationState,
  getNextActiveProjectIdAfterDelete,
  getNodeStopTarget,
  getParallelGroupBranchesForNode,
  hasModifiedWorkflowVariables,
  mergeTaskRecord,
  shouldResetActiveTaskAfterDelete,
  type TerminalSession
} from './utils'
import type { WorkflowRuntimeBranchRun } from '../shared/workflowRuntime'

describe('renderer runtime helpers', () => {
  it('returns input variables in their configured order', () => {
    const node: WorkflowNode = {
      id: 'start',
      type: 'start',
      name: 'Start',
      config: {
        variables: [
          { key: 'unset', label: 'Unset', type: 'text', required: false },
          { key: 'second', label: 'Second', type: 'text', required: false, order: 2 },
          { key: 'first', label: 'First', type: 'text', required: false, order: 1 }
        ]
      }
    }

    expect(getCurrentInputVariables(node).map((variable) => variable.key)).toEqual([
      'first',
      'second',
      'unset'
    ])
  })

  it('stops a running interactive terminal session instead of stopping the workflow', () => {
    const node: WorkflowNode = {
      id: 'terminal',
      type: 'interactive-terminal',
      name: 'Terminal',
      config: { command: 'bash', cwd: '${sys_project_dir}', autoStart: true }
    }
    const sessions: TerminalSession[] = [
      {
        id: 'session-1',
        task_id: 'task-1',
        node_id: 'terminal',
        kind: 'interactive',
        command: 'bash',
        cwd: '/repo',
        status: 'running',
        transcript: ''
      }
    ]

    expect(getNodeStopTarget(node, sessions)).toEqual({ kind: 'terminal-session', sessionId: 'session-1' })
  })

  it('stops a running non-interactive terminal session instead of stopping the workflow', () => {
    const node: WorkflowNode = {
      id: 'cmd',
      type: 'non-interactive-terminal',
      name: 'Command',
      config: { command: 'npm test', cwd: '${sys_project_dir}', successExitCodes: [0] }
    }
    const sessions: TerminalSession[] = [
      {
        id: 'session-1',
        task_id: 'task-1',
        node_id: 'cmd',
        kind: 'non-interactive',
        command: 'npm test',
        cwd: '/repo',
        status: 'running',
        transcript: ''
      }
    ]

    expect(getNodeStopTarget(node, sessions)).toEqual({ kind: 'terminal-session', sessionId: 'session-1' })
  })

  it('does not fall back to stopping the workflow when a non-interactive terminal session is not ready yet', () => {
    const node: WorkflowNode = {
      id: 'cmd',
      type: 'non-interactive-terminal',
      name: 'Command',
      config: { command: 'npm test', cwd: '${sys_project_dir}', successExitCodes: [0] }
    }

    expect(getNodeStopTarget(node, [])).toEqual({ kind: 'unavailable' })
  })

  it('ignores running interactive terminal sessions from other nodes', () => {
    const node: WorkflowNode = {
      id: 'terminal-2',
      type: 'interactive-terminal',
      name: 'Terminal 2',
      config: { command: 'bash', cwd: '${sys_project_dir}', autoStart: true }
    }
    const sessions: TerminalSession[] = [
      {
        id: 'session-1',
        task_id: 'task-1',
        node_id: 'terminal-1',
        kind: 'interactive',
        command: 'bash',
        cwd: '/repo',
        status: 'running',
        transcript: ''
      }
    ]

    expect(getNodeStopTarget(node, sessions)).toEqual({ kind: 'unavailable' })
  })

  it('does not fall back to stopping the workflow when an interactive terminal session is not ready yet', () => {
    const node: WorkflowNode = {
      id: 'terminal',
      type: 'interactive-terminal',
      name: 'Terminal',
      config: { command: 'bash', cwd: '${sys_project_dir}', autoStart: true }
    }

    expect(getNodeStopTarget(node, [])).toEqual({ kind: 'unavailable' })
  })

  it('allows starting a new task when a project exists even if a draft already exists', () => {
    expect(canStartNewTask({ hasActiveProject: true })).toBe(true)
  })

  it('does not allow starting a new task without an active project', () => {
    expect(canStartNewTask({ hasActiveProject: false })).toBe(false)
  })

  it('allows switching workflows only for an explicit unstarted task draft', () => {
    const draft = {
      isNewTaskDraft: true,
      activeTaskId: 'draft-1',
      persistedTaskIds: [],
      runtimeTaskId: null,
      startingWorkflowTaskId: null
    }

    expect(canSwitchTaskWorkflow(draft)).toBe(true)
    expect(canSwitchTaskWorkflow({ ...draft, isNewTaskDraft: false })).toBe(false)
    expect(canSwitchTaskWorkflow({ ...draft, persistedTaskIds: ['draft-1'] })).toBe(false)
    expect(canSwitchTaskWorkflow({ ...draft, runtimeTaskId: 'draft-1' })).toBe(false)
    expect(canSwitchTaskWorkflow({ ...draft, startingWorkflowTaskId: 'draft-1' })).toBe(false)
  })

  it('ignores runtime and startup state owned by other tasks when switching workflows', () => {
    expect(canSwitchTaskWorkflow({
      isNewTaskDraft: true,
      activeTaskId: 'draft-1',
      persistedTaskIds: ['task-2'],
      runtimeTaskId: 'task-2',
      startingWorkflowTaskId: 'task-3'
    })).toBe(true)
  })

  it('detects workflow variable changes without depending on key order', () => {
    expect(hasModifiedWorkflowVariables(
      { prompt: 'hello', count: 2, enabled: true, optional: null },
      { optional: null, enabled: true, count: 2, prompt: 'hello' }
    )).toBe(false)

    expect(hasModifiedWorkflowVariables({ prompt: 'changed' }, { prompt: 'hello' })).toBe(true)
    expect(hasModifiedWorkflowVariables({ prompt: 'hello', extra: '' }, { prompt: 'hello' })).toBe(true)
    expect(hasModifiedWorkflowVariables({}, { prompt: '' })).toBe(true)
  })

  it.each([
    ['string', { value: 'changed' }, { value: 'default' }],
    ['number', { value: 2 }, { value: 1 }],
    ['boolean', { value: false }, { value: true }],
    ['null', { value: null }, { value: '' }]
  ] as const)('detects a changed %s workflow variable', (_type, variables, defaults) => {
    expect(hasModifiedWorkflowVariables(variables, defaults)).toBe(true)
  })

  it('keeps a loaded task in place until a node operation moves it to the front', () => {
    const tasks = [
      { id: 'task-1', status: 'completed' },
      { id: 'task-2', status: 'waiting-input' },
      { id: 'task-3', status: 'draft' }
    ]
    const updatedTask = { id: 'task-2', status: 'running' }

    expect(mergeTaskRecord(tasks, updatedTask, false)).toEqual([
      tasks[0],
      updatedTask,
      tasks[2]
    ])
    expect(mergeTaskRecord(tasks, updatedTask, true)).toEqual([
      updatedTask,
      tasks[0],
      tasks[2]
    ])
  })

  it('allows operating an active parallel branch node even when global current node is another branch', () => {
    const branches: Record<string, WorkflowRuntimeBranchRun> = {
      'split:edge-a': {
        branchId: 'split:edge-a',
        splitNodeId: 'split',
        entryEdgeId: 'edge-a',
        entryNodeId: 'terminal-a',
        currentNodeId: 'terminal-a',
        status: 'running',
        nodeIds: ['terminal-a'],
        variables: {}
      },
      'split:edge-b': {
        branchId: 'split:edge-b',
        splitNodeId: 'split',
        entryEdgeId: 'edge-b',
        entryNodeId: 'terminal-b',
        currentNodeId: 'terminal-b',
        status: 'running',
        nodeIds: ['terminal-b'],
        variables: {}
      }
    }

    expect(getNodeOperationState({
      nodeId: 'terminal-b',
      runtimeCurrentNodeId: 'terminal-a',
      isRunning: true,
      isWaitingForInput: false,
      branchRuns: branches
    })).toEqual({
      branchId: 'split:edge-b',
      canOperate: true,
      isRunning: true,
      isWaitingForInput: false
    })
  })

  it('keeps the single node zoom target tied to the entry surface', () => {
    expect(getNodeDetailZoomTarget(null)).toEqual({ kind: 'graph' })
    expect(getNodeDetailZoomTarget({ kind: 'parallel', splitNodeId: 'split' })).toEqual({ kind: 'parallel', splitNodeId: 'split' })
  })

  it('does not allow input for interrupted terminal sessions', () => {
    expect(canAcceptTerminalInput({
      id: 'session-1',
      task_id: 'task-1',
      node_id: 'terminal',
      kind: 'interactive',
      command: 'bash',
      cwd: '/repo',
      status: 'interrupted',
      transcript: ''
    })).toBe(false)
  })

  it('allows retry for every ended terminal state but not running sessions', () => {
    const session: TerminalSession = {
      id: 'session-1',
      task_id: 'task-1',
      node_id: 'terminal',
      kind: 'interactive',
      command: 'bash',
      cwd: '/repo',
      status: 'closed',
      transcript: ''
    }

    for (const status of ['closed', 'closed (0)', 'failed', 'killed', 'interrupted']) {
      expect(canRetryTerminalSession({ ...session, status })).toBe(true)
    }
    expect(canRetryTerminalSession({ ...session, status: 'running' })).toBe(false)
  })

  it('allows input for running interactive terminal sessions', () => {
    expect(canAcceptTerminalInput({
      id: 'session-1',
      task_id: 'task-1',
      node_id: 'terminal',
      kind: 'interactive',
      command: 'bash',
      cwd: '/repo',
      status: 'running',
      transcript: ''
    })).toBe(true)
  })

  it('shows all routes when a related parallel gateway is focused', () => {
    const split: WorkflowNode = {
      id: 'split',
      type: 'parallel-gateway',
      name: 'Split',
      config: { mode: 'split' }
    }
    const join: WorkflowNode = {
      id: 'join',
      type: 'parallel-gateway',
      name: 'Join',
      config: { mode: 'join', joinIncomingEdgeIds: ['edge-a-join', 'edge-b-join'] }
    }
    const branches: Record<string, WorkflowRuntimeBranchRun> = {
      'split:edge-a': {
        branchId: 'split:edge-a',
        splitNodeId: 'split',
        entryEdgeId: 'edge-a',
        entryNodeId: 'a1',
        currentNodeId: 'join',
        status: 'completed',
        nodeIds: ['a1', 'a2'],
        reachedJoinNodeId: 'join',
        reachedJoinEdgeId: 'edge-a-join',
        variables: {}
      },
      'split:edge-b': {
        branchId: 'split:edge-b',
        splitNodeId: 'split',
        entryEdgeId: 'edge-b',
        entryNodeId: 'b1',
        currentNodeId: 'join',
        status: 'completed',
        nodeIds: ['b1'],
        reachedJoinNodeId: 'join',
        reachedJoinEdgeId: 'edge-b-join',
        variables: {}
      }
    }

    expect(getParallelGroupBranchesForNode(split, branches).map((branch) => branch.branchId)).toEqual(['split:edge-a', 'split:edge-b'])
    expect(getParallelGroupBranchesForNode(join, branches).map((branch) => branch.branchId)).toEqual(['split:edge-a', 'split:edge-b'])
  })

  it('keeps route nodes focused as single node details', () => {
    const routeNode: WorkflowNode = {
      id: 'a1',
      type: 'non-interactive-terminal',
      name: 'A1',
      config: { command: 'echo a1', cwd: '${sys_project_dir}', successExitCodes: [0] }
    }
    const branches: Record<string, WorkflowRuntimeBranchRun> = {
      'split:edge-a': {
        branchId: 'split:edge-a',
        splitNodeId: 'split',
        entryEdgeId: 'edge-a',
        entryNodeId: 'a1',
        currentNodeId: 'a2',
        status: 'running',
        nodeIds: ['a1'],
        variables: {}
      }
    }

    expect(getParallelGroupBranchesForNode(routeNode, branches)).toEqual([])
  })

  it('renders each branch route from entry through the current node once', () => {
    const branch: WorkflowRuntimeBranchRun = {
      branchId: 'split:edge-a',
      splitNodeId: 'split',
      entryEdgeId: 'edge-a',
      entryNodeId: 'a1',
      currentNodeId: 'a2',
      status: 'running',
      nodeIds: ['a1'],
      variables: {}
    }

    expect(getBranchRouteNodeIds(branch)).toEqual(['a1', 'a2'])
  })

  it('resets the task workspace when the active task is deleted', () => {
    expect(shouldResetActiveTaskAfterDelete({ activeTaskId: 'task-1', deletedTaskId: 'task-1' })).toBe(true)
    expect(shouldResetActiveTaskAfterDelete({ activeTaskId: 'task-1', deletedTaskId: 'task-2' })).toBe(false)
  })

  it('selects the next project when deleting the active project', () => {
    const projects = [
      { id: 'project-1' },
      { id: 'project-2' },
      { id: 'project-3' }
    ]

    expect(getNextActiveProjectIdAfterDelete({ projects, deletedProjectId: 'project-1' })).toBe('project-2')
    expect(getNextActiveProjectIdAfterDelete({ projects, deletedProjectId: 'project-2' })).toBe('project-1')
    expect(getNextActiveProjectIdAfterDelete({ projects: [{ id: 'project-1' }], deletedProjectId: 'project-1' })).toBeNull()
  })
})
