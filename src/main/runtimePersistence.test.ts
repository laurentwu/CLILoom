import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deleteWorkflowWithRevision,
  openDatabase,
  saveWorkflowWithRevision,
  updateTaskTitle,
  type AppDatabase
} from './database'
import {
  persistWorkflowRuntimeState,
  reconcileRecoverableRuntimeState,
  restoreWorkflowRuntimeState
} from './runtimePersistence'
import type { WorkflowDefinition } from '../shared/workflow'
import type {
  WorkflowRuntimeState,
  WorkflowRuntimeStatus
} from '../shared/workflowRuntime'
import { MAX_PROCESS_RESULT_CHARS } from '../shared/terminalBuffer'

const dbs: Array<{ db: AppDatabase; dir: string }> = []

const workflow: WorkflowDefinition = {
  id: 'workflow-1',
  name: 'Original workflow',
  nodes: [
    { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
    {
      id: 'terminal',
      type: 'interactive-terminal',
      name: 'Terminal',
      config: { command: 'bash', cwd: '/repo', autoStart: true }
    },
    { id: 'end', type: 'end', name: 'End', config: {} }
  ],
  edges: [
    { id: 'start-terminal', from: 'start', to: 'terminal' },
    { id: 'terminal-end', from: 'terminal', to: 'end' }
  ]
}

function createDb(): AppDatabase {
  const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-runtime-'))
  const db = openDatabase(dir)
  dbs.push({ db, dir })
  return db
}

function state(overrides: Partial<WorkflowRuntimeState> = {}): WorkflowRuntimeState {
  return {
    taskId: 'task-1',
    projectId: 'project-1',
    projectDir: '/repo',
    workflowId: 'workflow-1',
    status: 'running',
    currentNodeId: 'terminal',
    variables: { prompt: 'hello' },
    nodeRuns: {
      start: { nodeId: 'start', status: 'completed' },
      terminal: { nodeId: 'terminal', status: 'running', sessionId: 'session-1' }
    },
    executionOrder: ['start', 'terminal'],
    activeBranches: [],
    branchRuns: {},
    parallelResults: {},
    workflowCompleted: false,
    ...overrides
  }
}

function persistState(
  db: AppDatabase,
  runtimeState: WorkflowRuntimeState,
  status: WorkflowRuntimeStatus,
  definition: WorkflowDefinition = workflow
) {
  return persistWorkflowRuntimeState(db, runtimeState, status, definition)
}

afterEach(() => {
  while (dbs.length > 0) {
    const item = dbs.pop()!
    item.db.close()
    rmSync(item.dir, { recursive: true, force: true })
  }
})

describe('runtime persistence', () => {
  it('round-trips a validated workflow execution target context', () => {
    const db = createDb()
    const executionContext = {
      version: 1 as const,
      target: {
        kind: 'native' as const,
        id: 'posix:%2Fbin%2Fbash',
        displayName: 'bash',
        family: 'posix' as const,
        executablePath: '/bin/bash'
      },
      hostProjectDir: '/work/demo',
      targetProjectDir: '/work/demo'
    }
    persistState(db, state({
      status: 'completed',
      nodeRuns: {},
      executionOrder: [],
      workflowCompleted: true,
      executionContext
    }), 'completed')

    expect(restoreWorkflowRuntimeState(db, 'task-1').state?.executionContext)
      .toEqual(executionContext)

    const row = db.prepare('select context_json from workflow_runs where task_id = ?')
      .get('task-1') as { context_json: string }
    const tampered = JSON.parse(row.context_json)
    tampered.executionContext.target.executablePath = ''
    db.prepare('update workflow_runs set context_json = ? where task_id = ?')
      .run(JSON.stringify(tampered), 'task-1')
    expect(restoreWorkflowRuntimeState(db, 'task-1').state?.executionContext).toBeUndefined()
  })

  it('fails closed when restoring a legacy WSL execution context', () => {
    const db = createDb()
    persistState(db, state({
      status: 'waiting-input',
      nodeRuns: {},
      executionOrder: []
    }), 'waiting-input')
    const row = db.prepare('select context_json from workflow_runs where task_id = ?')
      .get('task-1') as { context_json: string }
    const stored = JSON.parse(row.context_json)
    stored.executionContext = {
      version: 1,
      target: {
        kind: 'wsl',
        id: 'wsl:v1:Ubuntu',
        displayName: 'Ubuntu',
        family: 'posix',
        distributionName: 'Ubuntu'
      },
      hostProjectDir: 'C:\\work\\demo',
      targetProjectDir: '/mnt/c/work/demo'
    }
    db.prepare('update workflow_runs set context_json = ? where task_id = ?')
      .run(JSON.stringify(stored), 'task-1')

    expect(() => restoreWorkflowRuntimeState(db, 'task-1'))
      .toThrow('historical execution target that is no longer supported')
  })

  it('generates the title once from the first ordered variable and preserves manual renames', () => {
    const db = createDb()
    const titledWorkflow: WorkflowDefinition = {
      ...workflow,
      nodes: workflow.nodes.map((node) => node.type === 'start'
        ? {
            ...node,
            config: {
              variables: [
                { key: 'later', label: 'Later', type: 'text', required: false, order: 2 },
                { key: 'first', label: 'First', type: 'text', required: false, order: 1 }
              ]
            }
          }
        : node)
    }

    const created = persistState(db, state({
      variables: { later: 'Later value', first: 'Initial title' }
    }), 'running', titledWorkflow)
    expect(created.title).toBe('Initial title')

    const manualGrapheme = '👩🏽‍💻'
    updateTaskTitle(db, 'task-1', `  ${manualGrapheme.repeat(21)}  `)
    const renamed = db.prepare('select title from tasks where id = ?').get('task-1') as { title: string }
    expect(renamed.title).toBe(manualGrapheme.repeat(20))
    const persisted = persistState(db, state({
      variables: { later: 'Changed later value', first: 'Changed automatic title' }
    }), 'waiting-input', titledWorkflow)

    expect(persisted.title).toBe(manualGrapheme.repeat(20))
  })

  it('rejects invalid or empty manual task titles', () => {
    const db = createDb()

    expect(() => updateTaskTitle(db, 'task-1', 42 as unknown as string))
      .toThrow('Task name must be a string')
    expect(() => updateTaskTitle(db, 'task-1', '   '))
      .toThrow('Task name must not be empty')
  })

  it('persists workflow runs and node runs', () => {
    const db = createDb()

    persistState(db, state(), 'running')

    const workflowRun = db.prepare('select * from workflow_runs where task_id = ?').get('task-1') as {
      status: string
      current_node_id: string
      workflow_version: number
    }
    const nodeRun = db.prepare('select * from node_runs where run_id = ? and node_id = ?').get('task-1', 'terminal') as { status: string; output_json: string }
    expect(workflowRun).toMatchObject({
      status: 'running',
      current_node_id: 'terminal',
      workflow_version: 1
    })
    expect(nodeRun.status).toBe('running')
    expect(JSON.parse(nodeRun.output_json)).toMatchObject({ sessionId: 'session-1' })
  })

  it('stores numbered workflow versions and restores the exact task snapshot', () => {
    const db = createDb()
    const created = saveWorkflowWithRevision(db, workflow)
    persistState(db, state({
      taskId: 'task-original',
      status: 'completed',
      nodeRuns: {},
      executionOrder: [],
      workflowCompleted: true
    }), 'completed')

    const editedWorkflow: WorkflowDefinition = {
      ...workflow,
      name: 'Edited workflow',
      nodes: workflow.nodes.map((node) => (
        node.id === 'terminal' ? { ...node, name: 'Edited terminal' } : node
      ))
    }
    const updated = saveWorkflowWithRevision(db, editedWorkflow, created.revision)
    persistState(db, state({
      taskId: 'task-edited',
      status: 'completed',
      nodeRuns: {},
      executionOrder: [],
      workflowCompleted: true
    }), 'completed', editedWorkflow)

    const originalRun = db.prepare(
      'select workflow_version from workflow_runs where task_id = ?'
    ).get('task-original') as { workflow_version: number }
    const editedRun = db.prepare(
      'select workflow_version from workflow_runs where task_id = ?'
    ).get('task-edited') as { workflow_version: number }
    const versionCount = db.prepare(
      'select count(*) as count from workflow_versions where workflow_id = ?'
    ).get(workflow.id) as { count: number }

    expect(originalRun.workflow_version).toBe(1)
    expect(editedRun.workflow_version).toBe(2)
    expect(versionCount.count).toBe(2)
    deleteWorkflowWithRevision(db, workflow.id, updated.revision)
    expect(restoreWorkflowRuntimeState(db, 'task-original').workflow).toEqual(workflow)
    expect(restoreWorkflowRuntimeState(db, 'task-edited').workflow).toEqual(editedWorkflow)
  })

  it('bounds node output and avoids duplicating it in task and workflow contexts', () => {
    const db = createDb()
    const output = `old-${'x'.repeat(MAX_PROCESS_RESULT_CHARS)}-tail`
    const runtimeState = state({
      status: 'completed',
      nodeRuns: {
        terminal: {
          nodeId: 'terminal',
          status: 'completed',
          sessionId: 'session-1',
          stdout: output,
          stderr: output,
          exitCode: 0
        }
      },
      executionOrder: ['terminal'],
      workflowCompleted: true
    })

    const task = persistState(db, runtimeState, 'completed')

    const taskRow = db.prepare('select context_json from tasks where id = ?').get('task-1') as {
      context_json: string
    }
    const workflowRow = db.prepare(
      'select context_json from workflow_runs where id = ?'
    ).get('task-1') as { context_json: string }
    const nodeRow = db.prepare(
      'select output_json from node_runs where run_id = ? and node_id = ?'
    ).get('task-1', 'terminal') as { output_json: string }
    const taskContext = JSON.parse(taskRow.context_json) as { nodeRuns?: unknown; parallelResults?: unknown }
    const workflowContext = JSON.parse(workflowRow.context_json) as { nodeRuns?: unknown }
    const nodeOutput = JSON.parse(nodeRow.output_json) as { stdout: string; stderr: string }

    expect(task).not.toHaveProperty('context_json')
    expect(taskContext.nodeRuns).toBeUndefined()
    expect(taskContext.parallelResults).toBeUndefined()
    expect(workflowContext.nodeRuns).toBeUndefined()
    expect(nodeOutput.stdout).toBe(output.slice(-MAX_PROCESS_RESULT_CHARS))
    expect(nodeOutput.stderr).toBe(output.slice(-MAX_PROCESS_RESULT_CHARS))

    const restored = restoreWorkflowRuntimeState(db, 'task-1')
    expect(restored.state?.nodeRuns.terminal.stdout).toBe(output.slice(-MAX_PROCESS_RESULT_CHARS))
    expect(JSON.stringify(restored).length).toBeLessThan(MAX_PROCESS_RESULT_CHARS * 3)
  })

  it('restores state from workflow runs, node runs, and terminal sessions', () => {
    const db = createDb()
    persistState(db, state(), 'running')
    db.prepare(
      'insert into terminal_sessions (id, task_id, node_id, kind, command, cwd, status, transcript, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      'session-1',
      'task-1',
      'terminal',
      'interactive',
      'bash',
      '/repo',
      'running',
      'hello',
      '2026-06-17T00:00:00.000Z',
      '2026-06-17T00:00:00.000Z'
    )

    const restored = restoreWorkflowRuntimeState(db, 'task-1', {
      isTerminalSessionLive: (session) => session.id === 'session-1',
      getLiveTerminalTranscript: () => ({ transcript: 'live transcript', cursor: 7 })
    })

    expect(restored.state?.status).toBe('running')
    expect(restored.state?.nodeRuns.terminal).toMatchObject({ status: 'running', sessionId: 'session-1' })
    expect(restored.terminalSessions[0]).toMatchObject({
      id: 'session-1',
      status: 'running',
      transcript: 'live transcript',
      transcript_cursor: 7
    })
  })

  it('restores stale running sessions and node runs as interrupted', () => {
    const db = createDb()
    persistState(db, state(), 'running')
    db.prepare(
      'insert into terminal_sessions (id, task_id, node_id, kind, command, cwd, status, transcript, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      'session-1',
      'task-1',
      'terminal',
      'interactive',
      'bash',
      '/repo',
      'running',
      'hello',
      '2026-06-17T00:00:00.000Z',
      '2026-06-17T00:00:00.000Z'
    )

    const restored = restoreWorkflowRuntimeState(db, 'task-1', {
      isTerminalSessionLive: () => false
    })

    expect(restored.terminalSessions[0]).toMatchObject({
      id: 'session-1',
      status: 'interrupted',
      transcript: null
    })
    expect(restored.state?.nodeRuns.terminal).toMatchObject({ status: 'interrupted', sessionId: 'session-1' })
    expect(restored.state?.status).toBe('interrupted')
    const task = db.prepare('select status from tasks where id = ?').get('task-1') as { status: string }
    const workflowRun = db.prepare('select status from workflow_runs where task_id = ?').get('task-1') as { status: string }
    expect(task.status).toBe('interrupted')
    expect(workflowRun.status).toBe('interrupted')
  })

  it('restores stale and just-completed parallel terminal branches as interrupted', () => {
    const db = createDb()
    const parallelWorkflow: WorkflowDefinition = {
      id: 'parallel-workflow',
      name: 'Parallel workflow',
      nodes: [
        { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split' } },
        { id: 'a', type: 'non-interactive-terminal', name: 'A', config: { command: 'a', cwd: '/repo', successExitCodes: [0] } },
        { id: 'b', type: 'non-interactive-terminal', name: 'B', config: { command: 'b', cwd: '/repo', successExitCodes: [0] } },
        { id: 'join', type: 'parallel-gateway', name: 'Join', config: { mode: 'join', joinIncomingEdgeIds: ['a-join', 'b-join'] } }
      ],
      edges: [
        { id: 'split-a', from: 'split', to: 'a' },
        { id: 'split-b', from: 'split', to: 'b' },
        { id: 'a-join', from: 'a', to: 'join' },
        { id: 'b-join', from: 'b', to: 'join' }
      ]
    }
    persistState(db, state({
      workflowId: parallelWorkflow.id,
      currentNodeId: 'split',
      nodeRuns: {
        split: { nodeId: 'split', status: 'completed' },
        a: { nodeId: 'a', status: 'completed', sessionId: 'session-a', stdout: 'a ok', exitCode: 0 },
        b: { nodeId: 'b', status: 'running' }
      },
      executionOrder: ['split', 'a', 'b'],
      activeBranches: ['split:split-a', 'split:split-b'],
      branchRuns: {
        'split:split-a': {
          branchId: 'split:split-a',
          splitNodeId: 'split',
          entryEdgeId: 'split-a',
          entryNodeId: 'a',
          currentNodeId: 'a',
          status: 'running',
          nodeIds: ['a'],
          variables: {}
        },
        'split:split-b': {
          branchId: 'split:split-b',
          splitNodeId: 'split',
          entryEdgeId: 'split-b',
          entryNodeId: 'b',
          currentNodeId: 'b',
          status: 'running',
          nodeIds: ['b'],
          variables: {}
        }
      }
    }), 'running', parallelWorkflow)

    const restored = restoreWorkflowRuntimeState(db, 'task-1')

    expect(restored.state).toMatchObject({
      status: 'interrupted',
      activeBranches: [],
      nodeRuns: {
        a: { status: 'interrupted', sessionId: 'session-a', exitCode: 0 },
        b: { status: 'interrupted' }
      },
      branchRuns: {
        'split:split-a': { status: 'interrupted' },
        'split:split-b': { status: 'interrupted' }
      }
    })
  })

  it('reconciles stale running sessions to interrupted while preserving waiting input', () => {
    const db = createDb()
    persistState(db, state({
      status: 'waiting-input',
      currentNodeId: 'ask',
      nodeRuns: {
        start: { nodeId: 'start', status: 'completed' },
        terminal: { nodeId: 'terminal', status: 'running', sessionId: 'session-1' },
        ask: { nodeId: 'ask', status: 'waiting-input' }
      }
    }), 'waiting-input')
    db.prepare(
      'insert into terminal_sessions (id, task_id, node_id, kind, command, cwd, status, transcript, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      'session-1',
      'task-1',
      'terminal',
      'interactive',
      'bash',
      '/repo',
      'running',
      'hello',
      '2026-06-17T00:00:00.000Z',
      '2026-06-17T00:00:00.000Z'
    )

    reconcileRecoverableRuntimeState(db, { isTerminalSessionLive: () => false })

    const terminal = db.prepare('select status from terminal_sessions where id = ?').get('session-1') as { status: string }
    const nodeRun = db.prepare('select status from node_runs where run_id = ? and node_id = ?').get('task-1', 'terminal') as { status: string }
    const workflowRun = db.prepare('select status from workflow_runs where task_id = ?').get('task-1') as { status: string }
    expect(terminal.status).toBe('interrupted')
    expect(nodeRun.status).toBe('interrupted')
    expect(workflowRun.status).toBe('waiting-input')
  })

  it('reconciles interrupted siblings while preserving a waiting parallel branch', () => {
    const db = createDb()
    const parallelWorkflow: WorkflowDefinition = {
      id: 'waiting-parallel-workflow',
      name: 'Waiting parallel workflow',
      nodes: [
        { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split' } },
        {
          id: 'ask',
          type: 'input',
          name: 'Ask',
          config: { variables: [{ key: 'answer', label: 'Answer', type: 'text', required: true }] }
        },
        { id: 'terminal', type: 'non-interactive-terminal', name: 'Terminal', config: { command: 'work', cwd: '/repo', successExitCodes: [0] } },
        { id: 'join', type: 'parallel-gateway', name: 'Join', config: { mode: 'join', joinIncomingEdgeIds: ['ask-join', 'terminal-join'] } }
      ],
      edges: [
        { id: 'split-ask', from: 'split', to: 'ask' },
        { id: 'split-terminal', from: 'split', to: 'terminal' },
        { id: 'ask-join', from: 'ask', to: 'join' },
        { id: 'terminal-join', from: 'terminal', to: 'join' }
      ]
    }
    persistState(db, state({
      workflowId: parallelWorkflow.id,
      status: 'waiting-input',
      currentNodeId: 'ask',
      nodeRuns: {
        split: { nodeId: 'split', status: 'completed' },
        ask: { nodeId: 'ask', status: 'waiting-input' },
        terminal: { nodeId: 'terminal', status: 'running', sessionId: 'session-terminal' }
      },
      executionOrder: ['split', 'ask', 'terminal'],
      activeBranches: ['split:split-ask', 'split:split-terminal'],
      branchRuns: {
        'split:split-ask': {
          branchId: 'split:split-ask',
          splitNodeId: 'split',
          entryEdgeId: 'split-ask',
          entryNodeId: 'ask',
          currentNodeId: 'ask',
          status: 'waiting-input',
          nodeIds: ['ask'],
          variables: {}
        },
        'split:split-terminal': {
          branchId: 'split:split-terminal',
          splitNodeId: 'split',
          entryEdgeId: 'split-terminal',
          entryNodeId: 'terminal',
          currentNodeId: 'terminal',
          status: 'running',
          nodeIds: ['terminal'],
          variables: {}
        }
      }
    }), 'waiting-input', parallelWorkflow)
    db.prepare(
      'insert into terminal_sessions (id, task_id, node_id, kind, command, cwd, status, transcript, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      'session-terminal',
      'task-1',
      'terminal',
      'non-interactive',
      'work',
      '/repo',
      'running',
      '',
      '2026-06-17T00:00:00.000Z',
      '2026-06-17T00:00:00.000Z'
    )

    const restored = restoreWorkflowRuntimeState(db, 'task-1', {
      isTerminalSessionLive: () => false
    })

    expect(restored.state).toMatchObject({
      status: 'waiting-input',
      activeBranches: ['split:split-ask'],
      nodeRuns: {
        ask: { status: 'waiting-input' },
        terminal: { status: 'interrupted' }
      },
      branchRuns: {
        'split:split-ask': { status: 'waiting-input' },
        'split:split-terminal': { status: 'interrupted' }
      }
    })
  })

  it('restores a waiting input node when a later terminal update left the task stopped', () => {
    const db = createDb()
    const recoveryWorkflow: WorkflowDefinition = {
      id: 'workflow-1',
      name: 'Recovery workflow',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        { id: 'terminal', type: 'interactive-terminal', name: 'Terminal', config: { command: 'bash', cwd: '/repo', autoStart: true } },
        { id: 'ask', type: 'input', name: 'Ask', config: { variables: [{ key: 'answer', label: 'Answer', type: 'text', required: true }] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'start-terminal', from: 'start', to: 'terminal' },
        { id: 'terminal-ask', from: 'terminal', to: 'ask' },
        { id: 'ask-end', from: 'ask', to: 'end' }
      ]
    }
    persistState(db, state({
      status: 'stopped',
      currentNodeId: 'terminal',
      nodeRuns: {
        start: { nodeId: 'start', status: 'completed' },
        terminal: { nodeId: 'terminal', status: 'stopped', sessionId: 'session-1', stderr: '用户停止' },
        ask: { nodeId: 'ask', status: 'waiting-input' }
      },
      executionOrder: ['start', 'terminal', 'ask'],
      activeBranches: ['split:e-terminal'],
      branchRuns: {
        'split:e-terminal': {
          branchId: 'split:e-terminal',
          splitNodeId: 'split',
          entryEdgeId: 'e-terminal',
          entryNodeId: 'terminal',
          currentNodeId: 'terminal',
          status: 'running',
          nodeIds: ['terminal'],
          variables: {}
        }
      },
      error: 'Terminal: 用户停止'
    }), 'stopped', recoveryWorkflow)

    reconcileRecoverableRuntimeState(db)
    const restored = restoreWorkflowRuntimeState(db, 'task-1')

    expect(restored.state).toMatchObject({
      status: 'waiting-input',
      currentNodeId: 'ask',
      activeBranches: []
    })
    expect(restored.state?.error).toBeUndefined()
    expect(restored.state?.branchRuns['split:e-terminal'].status).toBe('stopped')
    const task = db.prepare('select status from tasks where id = ?').get('task-1') as { status: string }
    const workflowRun = db.prepare(
      'select status, current_node_id from workflow_runs where task_id = ?'
    ).get('task-1') as { status: string; current_node_id: string }
    expect(task.status).toBe('waiting-input')
    expect(workflowRun).toEqual({ status: 'waiting-input', current_node_id: 'ask' })
  })

  it('preserves ended_at of terminal node runs across re-persists', () => {
    const db = createDb()
    const completedState = state({
      nodeRuns: {
        start: { nodeId: 'start', status: 'completed' },
        terminal: { nodeId: 'terminal', status: 'completed', sessionId: 'session-1', exitCode: 0 }
      }
    })
    persistState(db, completedState, 'completed')
    const oldTimestamp = '2020-01-01T00:00:00.000Z'
    db.prepare('update node_runs set ended_at = ? where run_id = ? and node_id = ?').run(oldTimestamp, 'task-1', 'start')

    persistState(db, completedState, 'completed')

    const row = db.prepare('select ended_at from node_runs where run_id = ? and node_id = ?').get('task-1', 'start') as { ended_at: string }
    expect(row.ended_at).toBe(oldTimestamp)
  })

  it('recovers a fully completed workflow as completed instead of interrupted', () => {
    const db = createDb()
    persistState(db, state({
      status: 'running',
      nodeRuns: {
        start: { nodeId: 'start', status: 'completed' },
        terminal: { nodeId: 'terminal', status: 'completed', sessionId: 'session-1', exitCode: 0 }
      }
    }), 'running')

    reconcileRecoverableRuntimeState(db, { isTerminalSessionLive: () => false })

    const workflowRun = db.prepare('select status from workflow_runs where task_id = ?').get('task-1') as { status: string }
    expect(workflowRun.status).toBe('completed')
  })
})
