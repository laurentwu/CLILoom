import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addProject, openDatabase, type AppDatabase } from './database'
import type { ResolvedExecutionTarget } from '../shared/shell'
import { isUnsupportedProjectPath } from '../shared/projectPath'
import { persistWorkflowRuntimeState } from './runtimePersistence'
import { WorkflowRuntimeService } from './workflowRuntimeService'
import type { WorkflowDefinition } from '../shared/workflow'
import {
  WorkflowRuntimeEngine,
  type WorkflowRuntimeProcessResult,
  type WorkflowRuntimeState
} from '../shared/workflowRuntime'

const dbs: Array<{ db: AppDatabase; dir: string }> = []

const storedWorkflow: WorkflowDefinition = {
  id: 'stored-workflow',
  name: 'Stored workflow',
  nodes: [
    {
      id: 'start',
      type: 'start',
      name: 'Start',
      config: {
        variables: [{ key: 'prompt', label: 'Prompt', type: 'text', required: true }]
      }
    },
    {
      id: 'ask',
      type: 'input',
      name: 'Ask',
      config: {
        variables: [{ key: 'answer', label: 'Answer', type: 'text', required: true }]
      }
    },
    { id: 'end', type: 'end', name: 'End', config: {} }
  ],
  edges: [
    { id: 'start-ask', from: 'start', to: 'ask' },
    { id: 'ask-end', from: 'ask', to: 'end' }
  ]
}

function createDb(): AppDatabase {
  const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-service-'))
  const db = openDatabase(dir)
  dbs.push({ db, dir })
  return db
}

afterEach(() => {
  while (dbs.length > 0) {
    const item = dbs.pop()!
    item.db.close()
    rmSync(item.dir, { recursive: true, force: true })
  }
})

function state(): WorkflowRuntimeState {
  return {
    taskId: 'task-1',
    projectId: 'project-1',
    projectDir: '/repo',
    workflowId: storedWorkflow.id,
    status: 'waiting-input',
    currentNodeId: 'ask',
    variables: { prompt: 'hello' },
    nodeRuns: { ask: { nodeId: 'ask', status: 'waiting-input' } },
    executionOrder: ['ask'],
    activeBranches: [],
    branchRuns: {},
    parallelResults: {},
    workflowCompleted: false
  }
}

describe('WorkflowRuntimeService restore', () => {
  it('restores persisted runtime state and terminal sessions', async () => {
    const db = createDb()
    persistWorkflowRuntimeState(db, state(), 'waiting-input', storedWorkflow)
    db.prepare(
      'update workflows set name = ?, definition_json = ? where id = ?'
    ).run(
      'Edited current workflow',
      JSON.stringify({ ...storedWorkflow, name: 'Edited current workflow' }),
      storedWorkflow.id
    )
    const runner = {
      run: async () => ({ sessionId: 'session-1', stdout: '', stderr: '', exitCode: 0 }),
      runHook: async () => ({ hookRunId: 'hook-1', stdout: '', stderr: '', exitCode: 0 }),
      killByTask: () => 0,
      hasLiveSession: () => false
    }
    const service = new WorkflowRuntimeService(db, runner as never, () => null)

    const restored = await service.restore('task-1')

    expect(restored.state?.status).toBe('waiting-input')
    expect(restored.state?.currentNodeId).toBe('ask')
    expect(restored.workflow).toEqual(storedWorkflow)
    expect(restored.workflowVersion).toBe(1)
    expect(restored.terminalSessions).toEqual([])
    expect(service.getState('task-1')?.status).toBe('waiting-input')
  })

  it('stops live orphan PTYs and interrupts persisted running work without an engine', async () => {
    const db = createDb()
    const runningWorkflow: WorkflowDefinition = {
      id: 'running-workflow',
      name: 'Running workflow',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        {
          id: 'terminal',
          type: 'non-interactive-terminal',
          name: 'Terminal',
          config: { command: 'sleep 60', cwd: '/repo', successExitCodes: [0] }
        },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'start-terminal', from: 'start', to: 'terminal' },
        { id: 'terminal-end', from: 'terminal', to: 'end' }
      ]
    }
    persistWorkflowRuntimeState(db, {
      taskId: 'running-task',
      projectId: 'project-1',
      projectDir: '/repo',
      workflowId: runningWorkflow.id,
      status: 'running',
      currentNodeId: 'terminal',
      variables: {},
      nodeRuns: {
        start: { nodeId: 'start', status: 'completed' },
        terminal: { nodeId: 'terminal', status: 'running', sessionId: 'live-session' }
      },
      executionOrder: ['start', 'terminal'],
      activeBranches: [],
      branchRuns: {},
      parallelResults: {},
      workflowCompleted: false
    }, 'running', runningWorkflow)
    db.prepare(
      'insert into terminal_sessions (id, task_id, node_id, kind, command, cwd, status, transcript, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      'live-session',
      'running-task',
      'terminal',
      'non-interactive',
      'sleep 60',
      '/repo',
      'running',
      '',
      '2026-08-05T00:00:00.000Z',
      '2026-08-05T00:00:00.000Z'
    )
    const killByTask = vi.fn(() => 1)
    const runner = {
      run: async () => ({ sessionId: 'session-1', stdout: '', stderr: '', exitCode: 0 }),
      runHook: async () => ({ hookRunId: 'hook-1', stdout: '', stderr: '', exitCode: 0 }),
      killByTask,
      hasLiveSession: () => true
    }
    const service = new WorkflowRuntimeService(db, runner as never, () => null)

    const restored = await service.restore('running-task')

    expect(killByTask).toHaveBeenCalledWith('running-task')
    expect(restored.terminalSessions[0]).toMatchObject({
      id: 'live-session',
      status: 'interrupted'
    })
    expect(restored.state?.status).toBe('interrupted')
    expect(restored.state?.nodeRuns.terminal.status).toBe('interrupted')
    expect(service.getState('running-task')).toBeNull()
  })

  it('keeps persisted running state intact when restoring a task whose engine is live mid-flight', async () => {
    const db = createDb()
    const runningWorkflow: WorkflowDefinition = {
      id: 'live-running-workflow',
      name: 'Live running workflow',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        {
          id: 'terminal',
          type: 'non-interactive-terminal',
          name: 'Terminal',
          config: { command: 'sleep 60', cwd: '/repo', successExitCodes: [0] }
        },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'start-terminal', from: 'start', to: 'terminal' },
        { id: 'terminal-end', from: 'terminal', to: 'end' }
      ]
    }
    let resolveTerminal!: (result: WorkflowRuntimeProcessResult) => void
    const terminalResult = new Promise<WorkflowRuntimeProcessResult>((resolve) => {
      resolveTerminal = resolve
    })
    const killByTask = vi.fn(() => 0)
    const runner = {
      run: vi.fn(() => terminalResult),
      runHook: async () => ({ hookRunId: 'hook-1', stdout: '', stderr: '', exitCode: 0 }),
      killByTask,
      hasLiveSession: () => true,
      getLiveTranscriptSnapshot: () => ({ transcript: 'partial output', cursor: 3 })
    }
    const service = new WorkflowRuntimeService(db, runner as never, () => null)

    await service.start({
      taskId: 'live-running-task',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow: runningWorkflow,
      variables: {}
    })
    await vi.waitFor(() => {
      expect(runner.run).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'terminal' }))
    })
    killByTask.mockClear()

    const restored = await service.restore('live-running-task')

    expect(killByTask).not.toHaveBeenCalled()
    expect(restored.state?.status).toBe('running')
    expect(restored.state?.nodeRuns.terminal.status).toBe('running')
    expect(service.getState('live-running-task')?.status).toBe('running')
    const task = db.prepare('select status from tasks where id = ?')
      .get('live-running-task') as { status: string }
    const workflowRun = db.prepare('select status from workflow_runs where task_id = ?')
      .get('live-running-task') as { status: string }
    const nodeRun = db.prepare('select status from node_runs where run_id = ? and node_id = ?')
      .get('live-running-task', 'terminal') as { status: string }
    expect(task.status).toBe('running')
    expect(workflowRun.status).toBe('running')
    expect(nodeRun.status).toBe('running')

    resolveTerminal({ sessionId: 'live-session', stdout: 'done', stderr: '', exitCode: 0, status: 'closed' })
    await vi.waitFor(() => {
      const completed = db.prepare('select status from tasks where id = ?')
        .get('live-running-task') as { status: string }
      expect(completed.status).toBe('completed')
    })
  })

  it('validates the workflow before creating runtime records', async () => {
    const db = createDb()
    const runner = {
      run: async () => ({ sessionId: 'session-1', stdout: '', stderr: '', exitCode: 0 }),
      runHook: async () => ({ hookRunId: 'hook-1', stdout: '', stderr: '', exitCode: 0 }),
      killByTask: () => 0,
      hasLiveSession: () => false
    }
    const service = new WorkflowRuntimeService(db, runner as never, () => null)
    const invalidWorkflow = {
      ...storedWorkflow,
      nodes: storedWorkflow.nodes.map((node) => (
        node.id === 'start' ? { ...node, startHook: null } : node
      ))
    } as unknown as WorkflowDefinition

    await expect(service.start({
      taskId: 'invalid-task',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow: invalidWorkflow,
      variables: { prompt: 'hello' }
    })).rejects.toThrow('startHook must be an object')
    await expect(service.start({
      taskId: 'invalid-semantic-task',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow: {
        id: 'missing-start-workflow',
        name: 'Missing start workflow',
        nodes: [{ id: 'end', type: 'end', name: 'End', config: {} }],
        edges: []
      },
      variables: {}
    })).rejects.toThrow('Invalid workflow definition')
    expect(db.prepare('select count(*) as count from tasks').get()).toEqual({ count: 0 })
    expect(db.prepare('select count(*) as count from workflow_versions').get()).toEqual({ count: 0 })
  })

  it('returns the persisted task when a workflow is successfully started', async () => {
    const db = createDb()
    const runner = {
      run: async () => ({ sessionId: 'session-1', stdout: '', stderr: '', exitCode: 0 }),
      runHook: async () => ({ hookRunId: 'hook-1', stdout: '', stderr: '', exitCode: 0 }),
      killByTask: () => 0,
      hasLiveSession: () => false
    }
    const service = new WorkflowRuntimeService(db, runner as never, () => null)

    const started = await service.start({
      taskId: 'new-task',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow: storedWorkflow,
      variables: { prompt: 'hello' }
    })

    expect(started.task).toMatchObject({
      id: 'new-task',
      project_id: 'project-1',
      title: 'hello',
      status: 'running'
    })
    await vi.waitFor(() => {
      expect(service.getState('new-task')?.status).toBe('waiting-input')
    })
  })

  it('does not overwrite a persisted workflow that is waiting for input', async () => {
    const db = createDb()
    persistWorkflowRuntimeState(db, state(), 'waiting-input', storedWorkflow)
    const runner = {
      run: async () => ({ sessionId: 'session-1', stdout: '', stderr: '', exitCode: 0 }),
      runHook: async () => ({ hookRunId: 'hook-1', stdout: '', stderr: '', exitCode: 0 }),
      killByTask: () => 0,
      hasLiveSession: () => false
    }
    const service = new WorkflowRuntimeService(db, runner as never, () => null)

    await expect(service.start({
      taskId: 'task-1',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow: storedWorkflow,
      variables: { prompt: 'replacement' }
    })).rejects.toThrow('The workflow for the current task is still running or waiting for input')

    const stored = db.prepare(
      'select status, current_node_id from workflow_runs where task_id = ?'
    ).get('task-1') as { status: string; current_node_id: string }
    expect(stored).toEqual({ status: 'waiting-input', current_node_id: 'ask' })
  })

  it('recovers a stopped snapshot with a waiting input before continuing it', async () => {
    const db = createDb()
    const workflow: WorkflowDefinition = {
      id: 'recover-input-workflow',
      name: 'Recover input workflow',
      nodes: [
        { id: 'terminal', type: 'non-interactive-terminal', name: 'Terminal', config: { command: 'test', cwd: '/repo', successExitCodes: [0] } },
        { id: 'ask', type: 'input', name: 'Ask', config: { variables: [{ key: 'answer', label: 'Answer', type: 'text', required: true }] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'terminal-ask', from: 'terminal', to: 'ask' },
        { id: 'ask-end', from: 'ask', to: 'end' }
      ]
    }
    persistWorkflowRuntimeState(db, {
      taskId: 'recover-input-task',
      projectId: 'project-1',
      projectDir: '/repo',
      workflowId: workflow.id,
      status: 'stopped',
      currentNodeId: 'terminal',
      variables: {},
      nodeRuns: {
        terminal: { nodeId: 'terminal', status: 'stopped', stderr: '用户停止' },
        ask: { nodeId: 'ask', status: 'waiting-input' }
      },
      executionOrder: ['terminal', 'ask'],
      activeBranches: [],
      branchRuns: {},
      parallelResults: {},
      workflowCompleted: false,
      error: 'Terminal: 用户停止'
    }, 'stopped', workflow)
    const runner = {
      run: async () => ({ sessionId: 'session-1', stdout: '', stderr: '', exitCode: 0 }),
      runHook: async () => ({ hookRunId: 'hook-1', stdout: '', stderr: '', exitCode: 0 }),
      killByTask: () => 0,
      hasLiveSession: () => false
    }
    const service = new WorkflowRuntimeService(db, runner as never, () => null)

    await expect(service.updateVariables('recover-input-task', { answer: '继续' })).resolves.not.toBeNull()

    await vi.waitFor(() => {
      const task = db.prepare('select status from tasks where id = ?')
        .get('recover-input-task') as { status: string }
      expect(task.status).toBe('completed')
    })
    const stored = db.prepare(
      'select status, current_node_id from workflow_runs where task_id = ?'
    ).get('recover-input-task') as { status: string; current_node_id: string }
    expect(stored).toEqual({ status: 'completed', current_node_id: 'end' })
  })

  it('releases a completed engine after its final state is persisted', async () => {
    const db = createDb()
    const runner = {
      run: async () => ({ sessionId: 'session-1', stdout: '', stderr: '', exitCode: 0 }),
      runHook: async () => ({ hookRunId: 'hook-1', stdout: '', stderr: '', exitCode: 0 }),
      killByTask: () => 0,
      hasLiveSession: () => false
    }
    const workflow: WorkflowDefinition = {
      id: 'short-workflow',
      name: 'Short workflow',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'start-end', from: 'start', to: 'end' }
      ]
    }
    const onTaskTerminal = vi.fn()
    const service = new WorkflowRuntimeService(
      db,
      runner as never,
      () => null,
      onTaskTerminal
    )

    const workflowInput = {
      ...workflow,
      unknownWorkflowField: 'ignored',
      nodes: workflow.nodes.map((node) => (
        node.id === 'start'
          ? { ...node, config: { ...node.config, unknownConfigField: 'ignored' } }
          : node
      ))
    } as unknown as WorkflowDefinition
    await service.start({
      taskId: 'completed-task',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow: workflowInput,
      variables: {}
    })

    const initialRun = db.prepare(
      'select workflow_version from workflow_runs where task_id = ?'
    ).get('completed-task') as { workflow_version: number }
    const storedVersion = db.prepare(
      'select definition_json from workflow_versions where workflow_id = ? and version = ?'
    ).get(workflow.id, initialRun.workflow_version) as { definition_json: string }
    expect(initialRun.workflow_version).toBe(1)
    expect(JSON.parse(storedVersion.definition_json)).toEqual(workflow)

    await vi.waitFor(() => {
      expect(service.getState('completed-task')).toBeNull()
    })
    const task = db.prepare('select status from tasks where id = ?').get('completed-task') as { status: string }
    expect(task.status).toBe('completed')
    expect(onTaskTerminal).toHaveBeenCalledTimes(1)
  })

  it('updates a failed node and continues the persisted workflow after a successful retry', async () => {
    const db = createDb()
    const workflow: WorkflowDefinition = {
      id: 'retry-workflow',
      name: 'Retry workflow',
      nodes: [
        { id: 'terminal', type: 'non-interactive-terminal', name: 'Terminal', config: { command: 'retry', cwd: '/repo', successExitCodes: [0] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [{ id: 'terminal-end', from: 'terminal', to: 'end' }]
    }
    persistWorkflowRuntimeState(db, {
      taskId: 'retry-task',
      projectId: 'project-1',
      projectDir: '/repo',
      workflowId: workflow.id,
      status: 'failed',
      currentNodeId: 'terminal',
      variables: {},
      nodeRuns: {
        terminal: { nodeId: 'terminal', status: 'failed', sessionId: 'session-retry', stderr: 'failed', exitCode: 1 }
      },
      executionOrder: ['terminal'],
      activeBranches: [],
      branchRuns: {},
      parallelResults: {},
      workflowCompleted: false,
      error: 'Terminal: 退出码 1'
    }, 'failed', workflow)
    const retry = vi.fn(() => ({
      sessionId: 'session-retry',
      taskId: 'retry-task',
      nodeId: 'terminal',
      result: Promise.resolve({
        sessionId: 'session-retry',
        stdout: 'retry ok',
        stderr: '',
        exitCode: 0,
        status: 'closed' as const
      })
    }))
    const runner = {
      getRetryTarget: () => ({
        sessionId: 'session-retry',
        taskId: 'retry-task',
        nodeId: 'terminal'
      }),
      retry,
      run: async () => ({ sessionId: 'session-1', stdout: '', stderr: '', exitCode: 0 }),
      runHook: async () => ({ hookRunId: 'hook-1', stdout: '', stderr: '', exitCode: 0 }),
      killByTask: () => 0,
      hasLiveSession: () => false
    }
    const service = new WorkflowRuntimeService(db, runner as never, () => null)

    await expect(service.retryTerminal('session-retry')).resolves.toBe('session-retry')
    expect(retry).toHaveBeenCalledWith('session-retry')

    await vi.waitFor(() => {
      const task = db.prepare('select status from tasks where id = ?').get('retry-task') as { status: string }
      expect(task.status).toBe('completed')
    })
    const node = db.prepare(
      'select status, output_json from node_runs where run_id = ? and node_id = ?'
    ).get('retry-task', 'terminal') as { status: string; output_json: string }
    expect(node.status).toBe('completed')
    expect(JSON.parse(node.output_json)).toMatchObject({
      sessionId: 'session-retry',
      stdout: 'retry ok',
      exitCode: 0
    })
    await vi.waitFor(() => expect(service.getState('retry-task')).toBeNull())
  })

  it('reruns a historical command without changing its failed workflow', async () => {
    const db = createDb()
    const workflow: WorkflowDefinition = {
      id: 'standalone-rerun-workflow',
      name: 'Standalone rerun workflow',
      nodes: [
        { id: 'terminal', type: 'non-interactive-terminal', name: 'Terminal', config: { command: 'retry', cwd: '/repo', successExitCodes: [0] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [{ id: 'terminal-end', from: 'terminal', to: 'end' }]
    }
    persistWorkflowRuntimeState(db, {
      taskId: 'standalone-rerun-task',
      projectId: 'project-1',
      projectDir: '/repo',
      workflowId: workflow.id,
      status: 'failed',
      currentNodeId: 'terminal',
      variables: { preserved: 'value' },
      nodeRuns: {
        terminal: { nodeId: 'terminal', status: 'failed', sessionId: 'session-old', exitCode: 1 }
      },
      executionOrder: ['terminal'],
      activeBranches: [],
      branchRuns: {},
      parallelResults: {},
      workflowCompleted: false,
      error: 'failed'
    }, 'failed', workflow)
    const retry = vi.fn(() => ({
      sessionId: 'session-old',
      taskId: 'standalone-rerun-task',
      nodeId: 'terminal',
      result: Promise.resolve({
        sessionId: 'session-old',
        stdout: 'standalone output',
        stderr: '',
        exitCode: 0,
        status: 'closed' as const
      })
    }))
    const runner = {
      getRetryTarget: () => ({
        sessionId: 'session-old',
        taskId: 'standalone-rerun-task',
        nodeId: 'terminal'
      }),
      retry,
      run: async () => ({ sessionId: 'unused', stdout: '', stderr: '', exitCode: 0 }),
      runHook: async () => ({ hookRunId: 'hook-1', stdout: '', stderr: '', exitCode: 0 }),
      killByTask: () => 0,
      hasLiveSession: () => false
    }
    const service = new WorkflowRuntimeService(db, runner as never, () => null)

    await expect(service.retryTerminal('session-old', 'standalone')).resolves.toBe('session-old')
    await vi.waitFor(() => expect(retry).toHaveBeenCalledWith('session-old'))

    expect(db.prepare('select status from tasks where id = ?').get('standalone-rerun-task'))
      .toEqual({ status: 'failed' })
    expect(db.prepare('select status from node_runs where run_id = ? and node_id = ?')
      .get('standalone-rerun-task', 'terminal')).toEqual({ status: 'failed' })
    expect(service.getState('standalone-rerun-task')).toBeNull()
  })

  it('rejects an explicit workflow retry when no workflow state can be restored', async () => {
    const db = createDb()
    const retry = vi.fn()
    const runner = {
      getRetryTarget: () => ({
        sessionId: 'orphan-session',
        taskId: 'missing-task',
        nodeId: 'terminal'
      }),
      retry,
      hasLiveSession: () => false
    }
    const service = new WorkflowRuntimeService(db, runner as never, () => null)

    await expect(service.retryTerminal('orphan-session', 'workflow')).rejects.toThrow()

    expect(retry).not.toHaveBeenCalled()
    expect(service.getState('missing-task')).toBeNull()
  })

  it('retries a failed non-terminal node from the persisted workflow context', async () => {
    const db = createDb()
    const workflow: WorkflowDefinition = {
      id: 'retry-gateway-workflow',
      name: 'Retry gateway workflow',
      nodes: [
        { id: 'gateway', type: 'exclusive-gateway', name: 'Gateway', config: {} },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [{ id: 'gateway-end', from: 'gateway', to: 'end', isDefault: true }]
    }
    persistWorkflowRuntimeState(db, {
      taskId: 'retry-gateway-task',
      projectId: 'project-1',
      projectDir: '/repo',
      workflowId: workflow.id,
      status: 'failed',
      currentNodeId: 'gateway',
      variables: { preserved: 'value' },
      nodeRuns: {
        gateway: { nodeId: 'gateway', status: 'failed', stderr: 'old failure' }
      },
      executionOrder: ['gateway'],
      activeBranches: [],
      branchRuns: {},
      parallelResults: {},
      workflowCompleted: false,
      error: 'old failure'
    }, 'failed', workflow)
    const runner = {
      run: async () => ({ sessionId: 'unused', stdout: '', stderr: '', exitCode: 0 }),
      runHook: async () => ({ hookRunId: 'hook-1', stdout: '', stderr: '', exitCode: 0 }),
      killByTask: () => 0,
      hasLiveSession: () => false
    }
    const service = new WorkflowRuntimeService(db, runner as never, () => null)

    await expect(service.retryNode('retry-gateway-task', 'gateway')).resolves.toMatchObject({
      status: 'running',
      variables: { preserved: 'value' },
      nodeRuns: { gateway: { status: 'running' } }
    })

    await vi.waitFor(() => {
      expect(db.prepare('select status from tasks where id = ?').get('retry-gateway-task'))
        .toEqual({ status: 'completed' })
    })
    expect(db.prepare('select node_id, status from node_runs where run_id = ? order by node_id')
      .all('retry-gateway-task')).toEqual([
      { node_id: 'end', status: 'completed' },
      { node_id: 'gateway', status: 'completed' }
    ])
  })

  it('retries a failed non-terminal branch from persisted state and rejoins its sibling', async () => {
    const db = createDb()
    const workflow: WorkflowDefinition = {
      id: 'retry-branch-gateway-workflow',
      name: 'Retry branch gateway workflow',
      nodes: [
        { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split' } },
        { id: 'gate', type: 'exclusive-gateway', name: 'Gate', config: {} },
        { id: 'other', type: 'non-interactive-terminal', name: 'Other', config: { command: 'other', cwd: '/repo', successExitCodes: [0] } },
        { id: 'join', type: 'parallel-gateway', name: 'Join', config: { mode: 'join', joinIncomingEdgeIds: ['gate-join', 'other-join'] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'split-gate', from: 'split', to: 'gate' },
        { id: 'split-other', from: 'split', to: 'other' },
        { id: 'gate-join', from: 'gate', to: 'join', isDefault: true },
        { id: 'other-join', from: 'other', to: 'join' },
        { id: 'join-end', from: 'join', to: 'end' }
      ]
    }
    const gateBranchId = 'split:split-gate'
    const otherBranchId = 'split:split-other'
    persistWorkflowRuntimeState(db, {
      taskId: 'retry-branch-gateway-task',
      projectId: 'project-1',
      projectDir: '/repo',
      workflowId: workflow.id,
      status: 'failed',
      currentNodeId: 'split',
      variables: { preserved: 'value' },
      nodeRuns: {
        split: { nodeId: 'split', status: 'completed' },
        gate: { nodeId: 'gate', status: 'failed', stderr: 'old failure' },
        other: { nodeId: 'other', status: 'completed', sessionId: 'session-other', exitCode: 0 }
      },
      executionOrder: ['split', 'gate', 'other'],
      activeBranches: [],
      branchRuns: {
        [gateBranchId]: {
          branchId: gateBranchId,
          splitNodeId: 'split',
          entryEdgeId: 'split-gate',
          entryNodeId: 'gate',
          currentNodeId: 'gate',
          status: 'failed',
          nodeIds: ['gate'],
          variables: { preserved: 'value' },
          error: 'old failure'
        },
        [otherBranchId]: {
          branchId: otherBranchId,
          splitNodeId: 'split',
          entryEdgeId: 'split-other',
          entryNodeId: 'other',
          currentNodeId: 'join',
          status: 'completed',
          nodeIds: ['other'],
          reachedJoinEdgeId: 'other-join',
          reachedJoinNodeId: 'join',
          variables: { preserved: 'value' }
        }
      },
      parallelResults: {},
      workflowCompleted: false,
      error: 'old failure'
    }, 'failed', workflow)
    const run = vi.fn(async () => ({
      sessionId: 'unused',
      stdout: '',
      stderr: '',
      exitCode: 0
    }))
    const runner = {
      run,
      runHook: async () => ({ hookRunId: 'hook-1', stdout: '', stderr: '', exitCode: 0 }),
      killByTask: () => 0,
      hasLiveSession: () => false
    }
    const service = new WorkflowRuntimeService(db, runner as never, () => null)

    await expect(service.retryNode(
      'retry-branch-gateway-task',
      'gate',
      gateBranchId
    )).resolves.toMatchObject({
      status: 'running',
      activeBranches: [gateBranchId],
      branchRuns: {
        [gateBranchId]: { status: 'running' }
      }
    })

    await vi.waitFor(() => {
      expect(db.prepare('select status from tasks where id = ?')
        .get('retry-branch-gateway-task')).toEqual({ status: 'completed' })
    })
    const stored = db.prepare(
      'select context_json from workflow_runs where task_id = ?'
    ).get('retry-branch-gateway-task') as { context_json: string }
    const context = JSON.parse(stored.context_json) as WorkflowRuntimeState
    expect(context.branchRuns[gateBranchId]).toMatchObject({
      status: 'completed',
      reachedJoinEdgeId: 'gate-join',
      reachedJoinNodeId: 'join'
    })
    expect(context.parallelResults.split.branches).toMatchObject({
      'split-gate': { status: 'completed' },
      'split-other': { status: 'completed' }
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('releases a restored terminal engine when its queued retry is no longer valid', async () => {
    const db = createDb()
    const workflow: WorkflowDefinition = {
      id: 'stale-terminal-retry-workflow',
      name: 'Stale terminal retry workflow',
      nodes: [
        { id: 'terminal', type: 'non-interactive-terminal', name: 'Terminal', config: { command: 'test', cwd: '/repo', successExitCodes: [0] } }
      ],
      edges: []
    }
    persistWorkflowRuntimeState(db, {
      taskId: 'stale-terminal-retry-task',
      projectId: 'project-1',
      projectDir: '/repo',
      workflowId: workflow.id,
      status: 'failed',
      currentNodeId: 'terminal',
      variables: {},
      nodeRuns: {
        terminal: {
          nodeId: 'terminal',
          status: 'failed',
          sessionId: 'stale-session',
          exitCode: 1
        }
      },
      executionOrder: ['terminal'],
      activeBranches: [],
      branchRuns: {},
      parallelResults: {},
      workflowCompleted: false,
      error: 'old failure'
    }, 'failed', workflow)
    const runner = {
      getRetryTarget: () => ({
        sessionId: 'stale-session',
        taskId: 'stale-terminal-retry-task',
        nodeId: 'terminal'
      }),
      retry: vi.fn(),
      hasLiveSession: () => false
    }
    const onTaskTerminal = vi.fn()
    const service = new WorkflowRuntimeService(
      db,
      runner as never,
      () => null,
      onTaskTerminal
    )
    const canRetry = vi.spyOn(
      WorkflowRuntimeEngine.prototype,
      'canRetryTerminalNode'
    ).mockReturnValue(true)
    const beginRetry = vi.spyOn(
      WorkflowRuntimeEngine.prototype,
      'beginTerminalRetry'
    ).mockResolvedValue(false)

    try {
      await expect(service.retryTerminal('stale-session', 'workflow')).rejects.toThrow()

      expect(service.getState('stale-terminal-retry-task')).toBeNull()
      expect(onTaskTerminal).toHaveBeenCalledOnce()
      expect(runner.retry).not.toHaveBeenCalled()
    } finally {
      beginRetry.mockRestore()
      canRetry.mockRestore()
    }
  })

  it('releases a restored node engine when its queued retry is no longer valid', async () => {
    const db = createDb()
    const workflow: WorkflowDefinition = {
      id: 'stale-node-retry-workflow',
      name: 'Stale node retry workflow',
      nodes: [
        { id: 'gate', type: 'exclusive-gateway', name: 'Gate', config: {} }
      ],
      edges: []
    }
    persistWorkflowRuntimeState(db, {
      taskId: 'stale-node-retry-task',
      projectId: 'project-1',
      projectDir: '/repo',
      workflowId: workflow.id,
      status: 'failed',
      currentNodeId: 'gate',
      variables: {},
      nodeRuns: {
        gate: { nodeId: 'gate', status: 'failed', stderr: 'old failure' }
      },
      executionOrder: ['gate'],
      activeBranches: [],
      branchRuns: {},
      parallelResults: {},
      workflowCompleted: false,
      error: 'old failure'
    }, 'failed', workflow)
    const runner = {
      hasLiveSession: () => false
    }
    const onTaskTerminal = vi.fn()
    const service = new WorkflowRuntimeService(
      db,
      runner as never,
      () => null,
      onTaskTerminal
    )
    const canRetry = vi.spyOn(
      WorkflowRuntimeEngine.prototype,
      'canRetryNode'
    ).mockReturnValue(true)
    const beginRetry = vi.spyOn(
      WorkflowRuntimeEngine.prototype,
      'beginNodeRetry'
    ).mockResolvedValue(false)

    try {
      await expect(service.retryNode('stale-node-retry-task', 'gate')).rejects.toThrow()

      expect(service.getState('stale-node-retry-task')).toBeNull()
      expect(onTaskTerminal).toHaveBeenCalledOnce()
    } finally {
      beginRetry.mockRestore()
      canRetry.mockRestore()
    }
  })

  it.each(['concurrently', 'sequentially'] as const)(
    'continues past a parallel join after interrupted branch retries succeed %s',
    async (retryMode) => {
      const db = createDb()
      const workflow: WorkflowDefinition = {
        id: 'interrupted-parallel-retry-workflow',
        name: 'Interrupted parallel retry workflow',
        nodes: [
          { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split' } },
          { id: 'a', type: 'non-interactive-terminal', name: 'A', config: { command: 'a', cwd: '/repo', successExitCodes: [0] } },
          { id: 'b', type: 'non-interactive-terminal', name: 'B', config: { command: 'b', cwd: '/repo', successExitCodes: [0] } },
          { id: 'c', type: 'non-interactive-terminal', name: 'C', config: { command: 'c', cwd: '/repo', successExitCodes: [0] } },
          { id: 'join', type: 'parallel-gateway', name: 'Join', config: { mode: 'join', joinIncomingEdgeIds: ['a-join', 'b-join', 'c-join'] } },
          { id: 'after', type: 'non-interactive-terminal', name: 'After', config: { command: 'after', cwd: '/repo', successExitCodes: [0] } },
          { id: 'end', type: 'end', name: 'End', config: {} }
        ],
        edges: [
          { id: 'split-a', from: 'split', to: 'a' },
          { id: 'split-b', from: 'split', to: 'b' },
          { id: 'split-c', from: 'split', to: 'c' },
          { id: 'a-join', from: 'a', to: 'join' },
          { id: 'b-join', from: 'b', to: 'join' },
          { id: 'c-join', from: 'c', to: 'join' },
          { id: 'join-after', from: 'join', to: 'after' },
          { id: 'after-end', from: 'after', to: 'end' }
        ]
      }
      persistWorkflowRuntimeState(db, {
        taskId: 'interrupted-parallel-retry-task',
        projectId: 'project-1',
        projectDir: '/repo',
        workflowId: workflow.id,
        status: 'interrupted',
        currentNodeId: 'split',
        variables: {},
        nodeRuns: {
          split: { nodeId: 'split', status: 'completed' },
          a: { nodeId: 'a', status: 'completed', sessionId: 'session-a', stdout: 'a ok', exitCode: 0 },
          b: { nodeId: 'b', status: 'interrupted' },
          c: { nodeId: 'c', status: 'interrupted' }
        },
        executionOrder: ['split', 'a', 'b', 'c'],
        activeBranches: ['split:split-a', 'split:split-b', 'split:split-c'],
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
          },
          'split:split-c': {
            branchId: 'split:split-c',
            splitNodeId: 'split',
            entryEdgeId: 'split-c',
            entryNodeId: 'c',
            currentNodeId: 'c',
            status: 'running',
            nodeIds: ['c'],
            variables: {}
          }
        },
        parallelResults: {},
        workflowCompleted: false
      }, 'interrupted', workflow)

      const sessionNodes: Record<string, string> = {
        'session-a': 'a',
        'session-b': 'b',
        'session-c': 'c'
      }
      const run = vi.fn(async (request: { nodeId: string }) => ({
        sessionId: `session-${request.nodeId}`,
        stdout: `${request.nodeId} ok`,
        stderr: '',
        exitCode: 0,
        status: 'closed' as const
      }))
      const runner = {
        getRetryTarget: (sessionId: string) => ({
          sessionId,
          taskId: 'interrupted-parallel-retry-task',
          nodeId: sessionNodes[sessionId]
        }),
        retry: (sessionId: string) => ({
          sessionId,
          taskId: 'interrupted-parallel-retry-task',
          nodeId: sessionNodes[sessionId],
          result: Promise.resolve({
            sessionId,
            stdout: `${sessionNodes[sessionId]} retry ok`,
            stderr: '',
            exitCode: 0,
            status: 'closed' as const
          })
        }),
        run,
        runHook: async () => ({ hookRunId: 'hook-1', stdout: '', stderr: '', exitCode: 0 }),
        killByTask: () => 0,
        hasLiveSession: () => false
      }
      const service = new WorkflowRuntimeService(db, runner as never, () => null)

      const retrySessionIds = ['session-a', 'session-b', 'session-c']
      if (retryMode === 'concurrently') {
        await Promise.all(retrySessionIds.map((sessionId) => service.retryTerminal(sessionId)))
      } else {
        for (const [index, sessionId] of retrySessionIds.entries()) {
          await service.retryTerminal(sessionId)
          await vi.waitFor(() => {
            const node = db.prepare(
              'select status from node_runs where run_id = ? and node_id = ?'
            ).get(
              'interrupted-parallel-retry-task',
              sessionNodes[sessionId]
            ) as { status: string }
            expect(node.status).toBe('completed')
            if (index < retrySessionIds.length - 1) {
              const workflowRun = db.prepare(
                'select status, context_json from workflow_runs where task_id = ?'
              ).get('interrupted-parallel-retry-task') as { status: string; context_json: string }
              const context = JSON.parse(workflowRun.context_json) as {
                error?: string
                parallelResults: Record<string, { branches: Record<string, { status: string }> }>
              }
              expect(workflowRun.status).toBe('interrupted')
              expect(context).not.toHaveProperty('error')
              expect(context.parallelResults.split.branches[index === 0 ? 'split-b' : 'split-c'].status)
                .toBe('interrupted')
            }
          })
        }
      }

      await vi.waitFor(() => {
        const task = db.prepare('select status from tasks where id = ?')
          .get('interrupted-parallel-retry-task') as { status: string }
        expect(task.status).toBe('completed')
      })
      const nodeStatuses = db.prepare(
        'select node_id, status from node_runs where run_id = ?'
      ).all('interrupted-parallel-retry-task') as Array<{ node_id: string; status: string }>
      expect(Object.fromEntries(nodeStatuses.map((node) => [node.node_id, node.status]))).toMatchObject({
        a: 'completed',
        b: 'completed',
        c: 'completed',
        join: 'completed',
        after: 'completed',
        end: 'completed'
      })
      expect(run).toHaveBeenCalledTimes(1)
      expect(run).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'after' }))
    }
  )

  it('starts a parallel terminal retry while a sibling is still running and rejects duplicates', async () => {
    const db = createDb()
    const workflow: WorkflowDefinition = {
      id: 'active-parallel-retry-workflow',
      name: 'Active parallel retry workflow',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split' } },
        { id: 'fail', type: 'non-interactive-terminal', name: 'Fail', config: { command: 'fail', cwd: '/repo', successExitCodes: [0] } },
        { id: 'slow', type: 'non-interactive-terminal', name: 'Slow', config: { command: 'slow', cwd: '/repo', successExitCodes: [0] } },
        { id: 'join', type: 'parallel-gateway', name: 'Join', config: { mode: 'join', joinIncomingEdgeIds: ['fail-join', 'slow-join'] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'start-split', from: 'start', to: 'split' },
        { id: 'split-fail', from: 'split', to: 'fail' },
        { id: 'split-slow', from: 'split', to: 'slow' },
        { id: 'fail-join', from: 'fail', to: 'join' },
        { id: 'slow-join', from: 'slow', to: 'join' },
        { id: 'join-end', from: 'join', to: 'end' }
      ]
    }
    let resolveFail!: (result: WorkflowRuntimeProcessResult) => void
    const failResult = new Promise<WorkflowRuntimeProcessResult>((resolve) => {
      resolveFail = resolve
    })
    let resolveSlow!: (result: WorkflowRuntimeProcessResult) => void
    const slowResult = new Promise<WorkflowRuntimeProcessResult>((resolve) => {
      resolveSlow = resolve
    })
    const getRetryTarget = vi.fn(() => ({
      sessionId: 'session-fail',
      taskId: 'active-parallel-retry-task',
      nodeId: 'fail'
    }))
    let resolveRetry!: (result: WorkflowRuntimeProcessResult) => void
    const retryResult = new Promise<WorkflowRuntimeProcessResult>((resolve) => {
      resolveRetry = resolve
    })
    const retry = vi.fn(() => ({
      sessionId: 'session-fail',
      taskId: 'active-parallel-retry-task',
      nodeId: 'fail',
      result: retryResult
    }))
    const runner = {
      getRetryTarget,
      retry,
      run: vi.fn((request: { nodeId: string }) => {
        if (request.nodeId === 'fail') return failResult
        return slowResult
      }),
      runHook: async () => ({ hookRunId: 'hook-1', stdout: '', stderr: '', exitCode: 0 }),
      resume: async () => ({ sessionId: 'session-1', stdout: '', stderr: '', exitCode: 0 }),
      killByTask: () => 0,
      hasLiveSession: () => false,
      getLiveSessionIdsByTask: () => [],
      listSessions: () => []
    }
    const service = new WorkflowRuntimeService(db, runner as never, () => null)

    await service.start({
      taskId: 'active-parallel-retry-task',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: {}
    })
    await vi.waitFor(() => {
      const current = service.getState('active-parallel-retry-task')
      expect(current?.nodeRuns.fail?.status).toBe('running')
      expect(current?.nodeRuns.slow?.status).toBe('running')
    })

    resolveFail({
      sessionId: 'session-fail',
      stdout: '',
      stderr: 'failed',
      exitCode: 1,
      status: 'closed'
    })
    await vi.waitFor(() => {
      const current = service.getState('active-parallel-retry-task')
      expect(current?.nodeRuns.fail?.status).toBe('failed')
      expect(current?.nodeRuns.slow?.status).toBe('running')
    })

    await expect(service.retryTerminal('session-fail')).resolves.toBe('session-fail')
    expect(retry).toHaveBeenCalledTimes(1)
    await expect(service.retryTerminal('session-fail')).rejects.toThrow('A terminal retry is already queued or running')
    expect(getRetryTarget).toHaveBeenCalledTimes(1)

    resolveSlow({
      sessionId: 'session-slow',
      stdout: 'slow ok',
      stderr: '',
      exitCode: 0,
      status: 'closed'
    })
    await vi.waitFor(() => {
      const current = service.getState('active-parallel-retry-task')
      expect(current?.nodeRuns.fail?.status).toBe('running')
      expect(current?.nodeRuns.slow?.status).toBe('completed')
    })

    resolveRetry({
      sessionId: 'session-fail',
      stdout: 'retry ok',
      stderr: '',
      exitCode: 0,
      status: 'closed'
    })

    await vi.waitFor(() => {
      const task = db.prepare('select status from tasks where id = ?')
        .get('active-parallel-retry-task') as { status: string }
      expect(task.status).toBe('completed')
    })
    const node = db.prepare(
      'select status, output_json from node_runs where run_id = ? and node_id = ?'
    ).get('active-parallel-retry-task', 'fail') as { status: string; output_json: string }
    expect(node.status).toBe('completed')
    expect(JSON.parse(node.output_json)).toMatchObject({
      sessionId: 'session-fail',
      stdout: 'retry ok',
      exitCode: 0
    })
  })

  it('serializes concurrent starts for the same task', async () => {
    const db = createDb()
    let releaseFirstCleanup!: () => void
    const firstCleanup = new Promise<void>((resolve) => {
      releaseFirstCleanup = resolve
    })
    const killByTask = vi.fn()
      .mockImplementationOnce(() => firstCleanup)
      .mockResolvedValue(0)
    const runner = {
      run: async () => ({ sessionId: 'session-1', stdout: '', stderr: '', exitCode: 0 }),
      runHook: async () => ({ hookRunId: 'hook-1', stdout: '', stderr: '', exitCode: 0 }),
      killByTask,
      killAll: vi.fn().mockResolvedValue(0),
      hasLiveSession: () => false
    }
    const service = new WorkflowRuntimeService(db, runner as never, () => null)
    const options = {
      taskId: 'concurrent-start-task',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow: storedWorkflow,
      variables: { prompt: 'hello' }
    }

    const first = service.start(options)
    const second = service.start({ ...options, variables: { prompt: 'replacement' } })
    const rejectedSecond = expect(second).rejects.toThrow(
      'The workflow for the current task is still running or waiting for input'
    )
    await vi.waitFor(() => expect(killByTask).toHaveBeenCalledTimes(1))
    releaseFirstCleanup()

    await expect(first).resolves.toMatchObject({ taskId: 'concurrent-start-task' })
    await rejectedSecond
    expect(db.prepare('select count(*) as count from workflow_runs where task_id = ?')
      .get('concurrent-start-task')).toEqual({ count: 1 })
  })

  it('blocks an in-flight start during shutdown and cleans up before resolving', async () => {
    const db = createDb()
    let releaseFirstCleanup!: () => void
    const firstCleanup = new Promise<void>((resolve) => {
      releaseFirstCleanup = resolve
    })
    const killByTask = vi.fn()
      .mockImplementationOnce(() => firstCleanup)
      .mockResolvedValue(0)
    const killAll = vi.fn().mockResolvedValue(0)
    const runner = {
      run: async () => ({ sessionId: 'session-1', stdout: '', stderr: '', exitCode: 0 }),
      runHook: async () => ({ hookRunId: 'hook-1', stdout: '', stderr: '', exitCode: 0 }),
      killByTask,
      killAll,
      hasLiveSession: () => false
    }
    const service = new WorkflowRuntimeService(db, runner as never, () => null)
    const starting = service.start({
      taskId: 'shutdown-race-task',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow: storedWorkflow,
      variables: { prompt: 'hello' }
    })
    const rejectedStart = expect(starting).rejects.toThrow('The application is exiting')
    await vi.waitFor(() => expect(killByTask).toHaveBeenCalledTimes(1))
    const shutdown = service.shutdown()
    releaseFirstCleanup()

    await rejectedStart
    await expect(shutdown).resolves.toBeUndefined()
    expect(killAll).toHaveBeenCalledOnce()
    expect(db.prepare('select count(*) as count from tasks where id = ?')
      .get('shutdown-race-task')).toEqual({ count: 0 })
    await expect(service.start({
      taskId: 'after-shutdown-task',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow: storedWorkflow,
      variables: { prompt: 'hello' }
    })).rejects.toThrow('The application is exiting')
  })

  it('stops active engines before residual cleanup and never launches the next node', async () => {
    const db = createDb()
    const workflow: WorkflowDefinition = {
      id: 'shutdown-active-workflow',
      name: 'Shutdown active workflow',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        { id: 'first', type: 'non-interactive-terminal', name: 'First', config: { command: 'first', cwd: '/repo', successExitCodes: [0] } },
        { id: 'second', type: 'non-interactive-terminal', name: 'Second', config: { command: 'second', cwd: '/repo', successExitCodes: [0] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'start-first', from: 'start', to: 'first' },
        { id: 'first-second', from: 'first', to: 'second' },
        { id: 'second-end', from: 'second', to: 'end' }
      ]
    }
    let finishFirst!: (result: WorkflowRuntimeProcessResult) => void
    const firstResult = new Promise<WorkflowRuntimeProcessResult>((resolve) => {
      finishFirst = resolve
    })
    const run = vi.fn(() => firstResult)
    const killByTask = vi.fn().mockResolvedValue(1)
    const killAll = vi.fn().mockResolvedValue(0)
    const runner = {
      run,
      runHook: async () => ({ hookRunId: 'hook-1', stdout: '', stderr: '', exitCode: 0 }),
      killByTask,
      killAll,
      hasLiveSession: () => false
    }
    const service = new WorkflowRuntimeService(db, runner as never, () => null)

    await service.start({
      taskId: 'shutdown-active-task',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: {}
    })
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    await service.shutdown()
    finishFirst({
      sessionId: 'first-session',
      stdout: 'late success',
      stderr: '',
      exitCode: 0,
      status: 'closed'
    })

    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(run).toHaveBeenCalledTimes(1)
    expect(killAll).toHaveBeenCalledOnce()
    expect((db.prepare('select status from tasks where id = ?')
      .get('shutdown-active-task') as { status: string }).status).toBe('stopped')
  })
})

describe('WorkflowRuntimeService execution targets', () => {
  it('rejects a stored WSL namespace project before launching or mutating it', async () => {
    const db = createDb()
    db.prepare(
      'insert into projects (id, name, path, sort_order, default_workflow_id, created_at) values (?, ?, ?, ?, ?, ?)'
    ).run(
      'legacy-project',
      'Legacy project',
      '\\\\wsl$\\Ubuntu\\home\\me\\repo',
      0,
      null,
      '2026-08-04T00:00:00.000Z'
    )
    const target: ResolvedExecutionTarget = {
      id: 'posix:%2Fbin%2Fbash',
      displayName: 'bash',
      family: 'posix',
      executablePath: '/bin/bash',
      source: 'system'
    }
    const run = vi.fn()
    const killByTask = vi.fn()
    const runner = {
      run,
      runHook: vi.fn(),
      killByTask,
      hasLiveSession: () => false
    }
    const targets = {
      resolveEffectiveTarget: vi.fn(async () => target),
      resolveTarget: vi.fn(async () => target),
      resolveTargetPath: vi.fn(async (_target: ResolvedExecutionTarget, value: string) => value),
      resolveProjectPath: vi.fn(async (_target: ResolvedExecutionTarget, value: string) => {
        if (isUnsupportedProjectPath(value)) throw new Error('This project path is not supported')
        return value
      })
    }
    const workflow: WorkflowDefinition = {
      id: 'legacy-project-workflow',
      name: 'Legacy project workflow',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [{ id: 'start-end', from: 'start', to: 'end' }]
    }
    const service = new WorkflowRuntimeService(db, runner as never, () => null, undefined, targets)

    await expect(service.start({
      taskId: 'legacy-project-task',
      projectId: 'legacy-project',
      workflow,
      variables: {}
    })).rejects.toThrow('This project path is not supported')

    expect(run).not.toHaveBeenCalled()
    expect(killByTask).not.toHaveBeenCalled()
    expect((db.prepare('select path from projects where id = ?').get('legacy-project') as { path: string }).path)
      .toBe('\\\\wsl$\\Ubuntu\\home\\me\\repo')
  })

  it('re-reads the project path, freezes the native target, and applies it to nodes and hooks', async () => {
    const db = createDb()
    const project = addProject(db, '/work/demo', () => true)
    const target: ResolvedExecutionTarget = {
      id: 'posix:%2Fbin%2Fbash',
      displayName: 'bash',
      family: 'posix',
      executablePath: '/bin/bash',
      source: 'system'
    }
    const run = vi.fn(async () => ({
      sessionId: 'native-session',
      stdout: '',
      stderr: '',
      exitCode: 0,
      status: 'closed' as const
    }))
    const runHook = vi.fn(async () => ({
      hookRunId: 'native-hook',
      stdout: '',
      stderr: '',
      exitCode: 0,
      status: 'completed' as const
    }))
    const runner = {
      run,
      runHook,
      killByTask: vi.fn(async () => 0),
      hasLiveSession: () => false
    }
    const targets = {
      resolveEffectiveTarget: vi.fn(async () => target),
      resolveTarget: vi.fn(async () => target),
      resolveProjectPath: vi.fn(async (_target: ResolvedExecutionTarget, value: string) => value),
      resolveTargetPath: vi.fn(async (_target: ResolvedExecutionTarget, value: string) => value)
    }
    const workflow: WorkflowDefinition = {
      id: 'native-workflow',
      name: 'Native workflow',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        {
          id: 'terminal',
          type: 'non-interactive-terminal',
          name: 'Terminal',
          config: {
            command: 'printf "${sys_project_dir}"',
            cwd: '${sys_project_dir}',
            env: { LITERAL: '${sys_project_dir}' },
            successExitCodes: [0]
          },
          startHook: {
            enabled: true,
            command: 'pwd',
            cwd: '${sys_project_dir}',
            env: { HOOK_LITERAL: '${HOME}' },
            failPolicy: 'fail-node'
          }
        },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'start-terminal', from: 'start', to: 'terminal' },
        { id: 'terminal-end', from: 'terminal', to: 'end' }
      ]
    }
    const service = new WorkflowRuntimeService(
      db,
      runner as never,
      () => null,
      undefined,
      targets
    )

    const started = await service.start({
      taskId: 'native-task',
      projectId: project.id,
      projectDir: '/renderer/forged',
      workflow,
      variables: {}
    })
    expect(started.executionContext).toEqual({
      version: 1,
      target: {
        kind: 'native',
        id: target.id,
        displayName: 'bash',
        family: 'posix',
        executablePath: '/bin/bash'
      },
      hostProjectDir: '/work/demo',
      targetProjectDir: '/work/demo'
    })
    expect(started.projectDir).toBe('/work/demo')
    expect(targets.resolveProjectPath).toHaveBeenCalledWith(target, '/work/demo')

    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
    expect(runHook).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/work/demo',
      sourceCwd: '/work/demo',
      executionTarget: started.executionContext?.target,
      env: { HOOK_LITERAL: '${HOME}' }
    }))
    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/work/demo',
      sourceCwd: '/work/demo',
      executionTarget: started.executionContext?.target,
      displayCommand: 'printf "/work/demo"',
      env: { LITERAL: '${sys_project_dir}' }
    }))
    expect(targets.resolveEffectiveTarget).toHaveBeenCalledOnce()
  })

  it('does not launch after a task is stopped during native target validation', async () => {
    const db = createDb()
    const project = addProject(db, '/work/demo', () => true)
    const target: ResolvedExecutionTarget = {
      id: 'posix:%2Fbin%2Fbash',
      displayName: 'bash',
      family: 'posix',
      executablePath: '/bin/bash',
      source: 'system'
    }
    let finishValidation: (value: ResolvedExecutionTarget) => void = () => undefined
    const validation = new Promise<ResolvedExecutionTarget>((resolve) => {
      finishValidation = resolve
    })
    const run = vi.fn(async () => ({
      sessionId: 'must-not-start',
      stdout: '',
      stderr: '',
      exitCode: 0
    }))
    const runner = {
      run,
      runHook: vi.fn(),
      killByTask: vi.fn(async () => 0),
      hasLiveSession: () => false
    }
    const targets = {
      resolveEffectiveTarget: vi.fn(async () => target),
      resolveTarget: vi.fn(async () => validation),
      resolveProjectPath: vi.fn(async (_target: ResolvedExecutionTarget, value: string) => value),
      resolveTargetPath: vi.fn(async (_target: ResolvedExecutionTarget, value: string) => value)
    }
    const workflow: WorkflowDefinition = {
      id: 'cancel-native-start',
      name: 'Cancel native start',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        {
          id: 'terminal',
          type: 'non-interactive-terminal',
          name: 'Terminal',
          config: { command: 'sleep 60', cwd: '${sys_project_dir}', successExitCodes: [0] }
        },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'start-terminal', from: 'start', to: 'terminal' },
        { id: 'terminal-end', from: 'terminal', to: 'end' }
      ]
    }
    const service = new WorkflowRuntimeService(
      db,
      runner as never,
      () => null,
      undefined,
      targets
    )

    await service.start({
      taskId: 'cancel-native-task',
      projectId: project.id,
      workflow,
      variables: {}
    })
    await vi.waitFor(() => expect(targets.resolveTarget).toHaveBeenCalledOnce())
    await expect(service.stop('cancel-native-task')).resolves.toMatchObject({ status: 'stopped' })
    finishValidation(target)
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(run).not.toHaveBeenCalled()
    expect(targets.resolveTargetPath).not.toHaveBeenCalled()
    expect((db.prepare('select status from tasks where id = ?')
      .get('cancel-native-task') as { status: string }).status).toBe('stopped')
  })

  it('turns a target cwd conversion error into a persisted terminal failure', async () => {
    const db = createDb()
    const project = addProject(db, '/work/demo', () => true)
    const target: ResolvedExecutionTarget = {
      id: 'posix:%2Fbin%2Fbash',
      displayName: 'bash',
      family: 'posix',
      executablePath: '/bin/bash',
      source: 'system'
    }
    const run = vi.fn(async (request: { preparationError?: string }) => ({
      sessionId: 'failed-path-session',
      stdout: '',
      stderr: request.preparationError ?? '',
      exitCode: -1,
      status: 'failed' as const
    }))
    const runner = {
      run,
      runHook: vi.fn(),
      killByTask: vi.fn(async () => 0),
      hasLiveSession: () => false
    }
    const targets = {
      resolveEffectiveTarget: vi.fn(async () => target),
      resolveTarget: vi.fn(async () => target),
      resolveProjectPath: vi.fn(async (_target: ResolvedExecutionTarget, value: string) => value),
      resolveTargetPath: vi.fn(async () => {
        throw new Error('Target directory does not exist')
      })
    }
    const workflow: WorkflowDefinition = {
      id: 'native-path-failure',
      name: 'Native path failure',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        {
          id: 'terminal',
          type: 'non-interactive-terminal',
          name: 'Terminal',
          config: { command: 'pwd', cwd: '/missing', successExitCodes: [0] }
        },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'start-terminal', from: 'start', to: 'terminal' },
        { id: 'terminal-end', from: 'terminal', to: 'end' }
      ]
    }
    const service = new WorkflowRuntimeService(db, runner as never, () => null, undefined, targets)

    await service.start({
      taskId: 'native-path-failure-task',
      projectId: project.id,
      workflow,
      variables: {}
    })
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/missing',
      sourceCwd: '/missing',
      preparationError: 'Target directory does not exist'
    }))
    await vi.waitFor(() => {
      expect((db.prepare('select status from tasks where id = ?')
        .get('native-path-failure-task') as { status: string }).status).toBe('failed')
    })
  })
})
