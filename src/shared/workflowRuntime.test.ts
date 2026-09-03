import { describe, expect, it, vi } from 'vitest'
import {
  WorkflowRuntimeEngine,
  type WorkflowRuntimeAdapter,
  type WorkflowRuntimeState
} from './workflowRuntime'
import type { WorkflowDefinition } from './workflow'
import { MAX_PROCESS_RESULT_CHARS } from './terminalBuffer'

function cloneState(state: WorkflowRuntimeState): WorkflowRuntimeState {
  return JSON.parse(JSON.stringify(state)) as WorkflowRuntimeState
}

function createAdapter(overrides: Partial<WorkflowRuntimeAdapter> = {}) {
  const states: WorkflowRuntimeState[] = []
  const processRequests: Parameters<WorkflowRuntimeAdapter['runProcess']>[0][] = []
  const hookRequests: Parameters<WorkflowRuntimeAdapter['runHook']>[0][] = []
  const adapter: WorkflowRuntimeAdapter = {
    emitState: (state) => {
      states.push(cloneState(state))
    },
    persistTask: async () => undefined,
    runProcess: async (request) => {
      processRequests.push(request)
      return { sessionId: `session-${request.nodeId}`, stdout: `ok:${request.nodeId}`, stderr: '', exitCode: 0 }
    },
    runHook: async (request) => {
      hookRequests.push(request)
      return { hookRunId: 'hook-1', stdout: '', stderr: '', exitCode: 0 }
    },
    killTask: async () => 0,
    ...overrides
  }
  return { adapter, states, processRequests, hookRequests }
}

describe('WorkflowRuntimeEngine', () => {
  it('waits at input nodes and resumes when variables are provided', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-input',
      name: 'Input workflow',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [{ key: 'prompt', label: 'Prompt', type: 'text', required: true }] } },
        { id: 'ask', type: 'input', name: 'Ask', config: { variables: [{ key: 'answer', label: 'Answer', type: 'text', required: true }] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'e-start-ask', from: 'start', to: 'ask' },
        { id: 'e-ask-end', from: 'ask', to: 'end' }
      ]
    }
    const { adapter, states } = createAdapter()
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-1',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: { prompt: 'build feature' },
      startNodeId: 'start'
    }, adapter)

    await engine.start()

    expect(engine.getState().status).toBe('waiting-input')
    expect(engine.getState().currentNodeId).toBe('ask')
    expect(engine.getState().nodeRuns.start.status).toBe('completed')
    expect(engine.getState().nodeRuns.ask.status).toBe('waiting-input')

    await engine.updateVariables({ answer: 'continue' })

    expect(engine.getState().status).toBe('completed')
    expect(engine.getState().workflowCompleted).toBe(true)
    expect(engine.getState().nodeRuns.ask.status).toBe('completed')
    expect(engine.getState().nodeRuns.end.status).toBe('completed')
    expect(states.at(-1)?.variables.answer).toBe('continue')
  })

  it('waits for an explicit submission even when an input default satisfies validation', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-input-default',
      name: 'Defaulted input workflow',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        {
          id: 'review',
          type: 'input',
          name: 'Review',
          config: {
            variables: [
              { key: 'review_result', label: 'Review result', type: 'text', required: true, defaultValue: '继续' }
            ]
          }
        },
        { id: 'implement', type: 'non-interactive-terminal', name: 'Implement', config: { command: 'echo implement', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'e-start-review', from: 'start', to: 'review' },
        { id: 'e-review-implement', from: 'review', to: 'implement' },
        { id: 'e-implement-end', from: 'implement', to: 'end' }
      ]
    }
    const { adapter, processRequests } = createAdapter()
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-input-default',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: {},
      startNodeId: 'start'
    }, adapter)

    await engine.start()

    expect(engine.getState()).toMatchObject({
      status: 'waiting-input',
      currentNodeId: 'review',
      variables: { review_result: '继续' }
    })
    expect(engine.getState().nodeRuns.review.status).toBe('waiting-input')
    expect(processRequests).toHaveLength(0)

    await engine.updateVariables({ review_result: '继续' })

    expect(engine.getState().status).toBe('completed')
    expect(processRequests.map((request) => request.nodeId)).toEqual(['implement'])
  })

  it('waits again whenever a workflow loops back to an input node', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-repeated-review',
      name: 'Repeated review workflow',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        {
          id: 'review',
          type: 'input',
          name: 'Review',
          config: {
            variables: [
              { key: 'review_result', label: 'Review result', type: 'text', required: true, defaultValue: '继续' }
            ]
          }
        },
        { id: 'gate', type: 'exclusive-gateway', name: 'Review decision', config: {} },
        { id: 'revise', type: 'non-interactive-terminal', name: 'Revise', config: { command: 'echo revise', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'implement', type: 'non-interactive-terminal', name: 'Implement', config: { command: 'echo implement', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'e-start-review', from: 'start', to: 'review' },
        { id: 'e-review-gate', from: 'review', to: 'gate' },
        { id: 'e-gate-implement', from: 'gate', to: 'implement', condition: 'review_result == "继续"' },
        { id: 'e-gate-revise', from: 'gate', to: 'revise', isDefault: true },
        { id: 'e-revise-review', from: 'revise', to: 'review' },
        { id: 'e-implement-end', from: 'implement', to: 'end' }
      ]
    }
    const { adapter, processRequests } = createAdapter()
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-repeated-review',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: {},
      startNodeId: 'start'
    }, adapter)

    await engine.start()
    await engine.updateVariables({ review_result: '需要修改' })

    expect(engine.getState()).toMatchObject({
      status: 'waiting-input',
      currentNodeId: 'review',
      variables: { review_result: '需要修改' }
    })
    expect(processRequests.map((request) => request.nodeId)).toEqual(['revise'])

    await engine.updateVariables({ review_result: '继续' })

    expect(engine.getState().status).toBe('completed')
    expect(processRequests.map((request) => request.nodeId)).toEqual(['revise', 'implement'])
  })

  it('runs terminal nodes with shell values isolated in the environment', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-terminal',
      name: 'Terminal workflow',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [{ key: 'prompt', label: 'Prompt', type: 'text', required: true }] } },
        { id: 'cmd', type: 'non-interactive-terminal', name: 'Command', config: { command: 'echo ${prompt} in ${sys_project_dir}', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'e-start-cmd', from: 'start', to: 'cmd' },
        { id: 'e-cmd-end', from: 'cmd', to: 'end' }
      ]
    }
    const { adapter, processRequests } = createAdapter()
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-2',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: { prompt: 'hello' },
      startNodeId: 'start'
    }, adapter)

    await engine.start()

    expect(processRequests).toHaveLength(1)
    expect(processRequests[0]).toMatchObject({
      taskId: 'task-2',
      nodeId: 'cmd',
      kind: 'non-interactive',
      command: {
        version: 1,
        bindings: {
          CLILOOM_INTERNAL_VALUE_0: 'hello',
          CLILOOM_INTERNAL_VALUE_1: '/repo'
        }
      },
      displayCommand: 'echo hello in /repo',
      cwd: '/repo',
      env: undefined
    })
    expect(engine.getState().status).toBe('completed')
    expect(engine.getState().nodeRuns.cmd).toMatchObject({
      status: 'completed',
      sessionId: 'session-cmd',
      stdout: 'ok:cmd',
      exitCode: 0
    })
  })

  it('keeps shell metacharacters out of terminal commands and protects internal bindings', async () => {
    const prompt = '`codex` $(printf injected) "$HOME" \'quoted\'\nnext line'
    const workflow: WorkflowDefinition = {
      id: 'wf-safe-terminal-values',
      name: 'Safe terminal values',
      nodes: [
        {
          id: 'cmd',
          type: 'interactive-terminal',
          name: 'Command',
          config: {
            command: 'codex --yolo "${prompt}"',
            cwd: '${sys_project_dir}',
            env: {
              STATIC_VALUE: 'configured',
              CLILOOM_INTERNAL_VALUE_0: 'must-not-win'
            },
            autoStart: true
          }
        },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [{ id: 'e-cmd-end', from: 'cmd', to: 'end' }]
    }
    const { adapter, processRequests } = createAdapter()
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-safe-terminal-values',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: { prompt },
      startNodeId: 'cmd'
    }, adapter)

    await engine.start()

    expect(processRequests).toHaveLength(1)
    expect(processRequests[0].command).toMatchObject({
      version: 1,
      bindings: { CLILOOM_INTERNAL_VALUE_1: prompt }
    })
    expect(JSON.stringify(processRequests[0].command)).not.toContain('must-not-win')
    expect(processRequests[0].displayCommand).toBe(`codex --yolo "${prompt}"`)
    expect(processRequests[0].env).toEqual({
      STATIC_VALUE: 'configured',
      CLILOOM_INTERNAL_VALUE_0: 'must-not-win'
    })
  })

  it('isolates shell values used by hooks', async () => {
    const prompt = '`codex` $(printf injected)'
    const workflow: WorkflowDefinition = {
      id: 'wf-safe-hook-values',
      name: 'Safe hook values',
      nodes: [
        {
          id: 'start',
          type: 'start',
          name: 'Start',
          config: { variables: [{ key: 'prompt', label: 'Prompt', type: 'text', required: true }] },
          startHook: {
            enabled: true,
            command: 'printf "%s" "${prompt}"',
            env: { STATIC_VALUE: 'configured' },
            failPolicy: 'fail-node'
          }
        },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [{ id: 'e-start-end', from: 'start', to: 'end' }]
    }
    const { adapter, hookRequests } = createAdapter()
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-safe-hook-values',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: { prompt },
      startNodeId: 'start'
    }, adapter)

    await engine.start()

    expect(hookRequests).toEqual([
      expect.objectContaining({
        command: expect.objectContaining({
          version: 1,
          bindings: { CLILOOM_INTERNAL_VALUE_0: prompt }
        }),
        env: {
          STATIC_VALUE: 'configured'
        }
      })
    ])
  })

  it('fails the workflow when a main-line end hook uses fail-node', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-end-hook-failure',
      name: 'End hook failure',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        {
          id: 'end',
          type: 'end',
          name: 'End',
          config: {},
          endHook: {
            enabled: true,
            command: 'exit 9',
            failPolicy: 'fail-node'
          }
        }
      ],
      edges: [{ id: 'e-start-end', from: 'start', to: 'end' }]
    }
    const runHook = vi.fn(async () => ({
        hookRunId: 'hook-end',
        stdout: '',
        stderr: 'end hook exploded',
        exitCode: 9,
        status: 'failed'
      } as const))
    const { adapter } = createAdapter({
      runHook
    })
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-end-hook-failure',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: {},
      startNodeId: 'start'
    }, adapter)

    await engine.start()

    expect(runHook).toHaveBeenCalledWith(expect.objectContaining({
      nodeId: 'end',
      hookType: 'end'
    }))
    expect(engine.getState()).toMatchObject({
      status: 'failed',
      workflowCompleted: false,
      error: expect.stringContaining('end hook exploded'),
      nodeRuns: {
        end: {
          status: 'failed',
          stderr: expect.stringContaining('end hook exploded')
        }
      }
    })
  })

  it('records an end hook failure but completes when its policy is continue', async () => {
    const hookRequests: Parameters<WorkflowRuntimeAdapter['runHook']>[0][] = []
    const workflow: WorkflowDefinition = {
      id: 'wf-end-hook-continue',
      name: 'End hook continue',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        {
          id: 'end',
          type: 'end',
          name: 'End',
          config: {},
          endHook: {
            enabled: true,
            command: 'exit 3',
            failPolicy: 'continue'
          }
        }
      ],
      edges: [{ id: 'e-start-end', from: 'start', to: 'end' }]
    }
    const { adapter } = createAdapter({
      runHook: async (request) => {
        hookRequests.push(request)
        return {
          hookRunId: 'hook-end',
          stdout: '',
          stderr: 'ignored failure',
          exitCode: 3,
          status: 'failed'
        }
      }
    })
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-end-hook-continue',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: {},
      startNodeId: 'start'
    }, adapter)

    await engine.start()

    expect(hookRequests).toHaveLength(1)
    expect(hookRequests[0]).toMatchObject({ nodeId: 'end', hookType: 'end' })
    expect(engine.getState()).toMatchObject({
      status: 'completed',
      workflowCompleted: true,
      nodeRuns: { end: { status: 'completed' } }
    })
  })

  it('runs end hooks inside terminal parallel branches and propagates fail-node', async () => {
    const hookRequests: Parameters<WorkflowRuntimeAdapter['runHook']>[0][] = []
    const workflow: WorkflowDefinition = {
      id: 'wf-branch-end-hook',
      name: 'Branch end hook',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split' } },
        {
          id: 'end-a',
          type: 'end',
          name: 'End A',
          config: {},
          endHook: {
            enabled: true,
            command: 'exit 4',
            failPolicy: 'fail-node'
          }
        },
        { id: 'end-b', type: 'end', name: 'End B', config: {} }
      ],
      edges: [
        { id: 'e-start-split', from: 'start', to: 'split' },
        { id: 'e-split-a', from: 'split', to: 'end-a' },
        { id: 'e-split-b', from: 'split', to: 'end-b' }
      ]
    }
    const { adapter } = createAdapter({
      runHook: async (request) => {
        hookRequests.push(request)
        return {
          hookRunId: 'hook-branch-end',
          stdout: '',
          stderr: 'branch cleanup failed',
          exitCode: 4,
          status: 'failed'
        }
      }
    })
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-branch-end-hook',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: {},
      startNodeId: 'start'
    }, adapter)

    await engine.start()

    expect(hookRequests).toHaveLength(1)
    expect(hookRequests[0]).toMatchObject({ nodeId: 'end-a', hookType: 'end' })
    expect(engine.getState()).toMatchObject({
      status: 'failed',
      workflowCompleted: false,
      error: expect.stringContaining('branch cleanup failed'),
      nodeRuns: {
        'end-a': { status: 'failed' },
        'end-b': { status: 'completed' }
      }
    })
  })

  it('bounds adapter output before adding it to runtime state', async () => {
    const output = `old-${'x'.repeat(MAX_PROCESS_RESULT_CHARS)}-tail`
    const workflow: WorkflowDefinition = {
      id: 'wf-bounded-output',
      name: 'Bounded output',
      nodes: [
        {
          id: 'cmd',
          type: 'non-interactive-terminal',
          name: 'Command',
          config: { command: 'echo output', cwd: '${sys_project_dir}', successExitCodes: [0] }
        },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [{ id: 'e-cmd-end', from: 'cmd', to: 'end' }]
    }
    const { adapter } = createAdapter({
      runProcess: async () => ({
        sessionId: 'session-cmd',
        stdout: output,
        stderr: output,
        exitCode: 0
      })
    })
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-bounded-output',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: {},
      startNodeId: 'cmd'
    }, adapter)

    await engine.start()

    expect(engine.getState().nodeRuns.cmd.stdout).toBe(output.slice(-MAX_PROCESS_RESULT_CHARS))
    expect(engine.getState().nodeRuns.cmd.stderr).toBe(output.slice(-MAX_PROCESS_RESULT_CHARS))
  })

  it('treats stopping a non-interactive terminal node as success and continues the workflow', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-killed-terminal',
      name: 'Killed terminal workflow',
      nodes: [
        { id: 'cmd', type: 'non-interactive-terminal', name: '实现 Plan', config: { command: 'sleep 60', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'e-cmd-end', from: 'cmd', to: 'end' }
      ]
    }
    const { adapter } = createAdapter({
      runProcess: async () => ({
        sessionId: 'session-cmd',
        stdout: '',
        stderr: '',
        exitCode: null,
        status: 'killed'
      })
    })
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-killed-terminal',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: {},
      startNodeId: 'cmd'
    }, adapter)

    await engine.start()

    expect(engine.getState().status).toBe('completed')
    expect(engine.getState().workflowCompleted).toBe(true)
    expect(engine.getState().nodeRuns.cmd).toMatchObject({
      status: 'completed',
      sessionId: 'session-cmd',
      exitCode: null
    })
    expect(engine.getState().nodeRuns.end.status).toBe('completed')
    expect(engine.getState().error).toBeUndefined()
  })

  it('still stops the whole workflow through the workflow stop action', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-stop-action',
      name: 'Stopped workflow',
      nodes: [
        { id: 'input', type: 'input', name: 'Input', config: { variables: [] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [{ id: 'e-input-end', from: 'input', to: 'end' }]
    }
    const { adapter } = createAdapter()
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-stop-action',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: {},
      startNodeId: 'input'
    }, adapter)

    await engine.start()
    await engine.stop()

    expect(engine.getState().status).toBe('stopped')
    expect(engine.getState().workflowCompleted).toBe(false)
    expect(engine.getState().nodeRuns.input).toMatchObject({
      status: 'stopped',
      stderr: 'User stopped'
    })
    expect(engine.getState().nodeRuns.end).toBeUndefined()
  })

  it('keeps the workflow stopped when an active hook is killed during stop', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-stop-hook',
      name: 'Stop active hook',
      nodes: [
        {
          id: 'start',
          type: 'start',
          name: 'Start',
          config: { variables: [] },
          startHook: {
            enabled: true,
            command: 'sleep 60',
            failPolicy: 'fail-node'
          }
        },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [{ id: 'e-start-end', from: 'start', to: 'end' }]
    }
    let notifyHookStarted: () => void = () => undefined
    let finishHook: (result: Awaited<ReturnType<WorkflowRuntimeAdapter['runHook']>>) => void = () => undefined
    const hookStarted = new Promise<void>((resolve) => {
      notifyHookStarted = resolve
    })
    const hookResult = new Promise<Awaited<ReturnType<WorkflowRuntimeAdapter['runHook']>>>((resolve) => {
      finishHook = resolve
    })
    const killTask = vi.fn(async () => {
      finishHook({
        hookRunId: 'hook-stopped',
        stdout: '',
        stderr: '用户停止',
        exitCode: null,
        status: 'killed'
      })
      return 1
    })
    const { adapter } = createAdapter({
      runHook: async () => {
        notifyHookStarted()
        return hookResult
      },
      killTask
    })
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-stop-hook',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: {},
      startNodeId: 'start'
    }, adapter)

    const started = engine.start()
    await hookStarted
    await engine.stop()
    await started

    expect(killTask).toHaveBeenCalledWith('task-stop-hook')
    expect(engine.getState()).toMatchObject({
      status: 'stopped',
      workflowCompleted: false
    })
    expect(engine.getState().nodeRuns.end).toBeUndefined()
    expect(engine.getState().error).toBeUndefined()
  })

  it('adds parallel branch nodes to execution order while running split branches', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-parallel',
      name: 'Parallel workflow',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [{ key: 'prompt', label: 'Prompt', type: 'text', required: true }] } },
        { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split' } },
        { id: 'a', type: 'non-interactive-terminal', name: 'A', config: { command: 'echo a', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'b', type: 'non-interactive-terminal', name: 'B', config: { command: 'echo b', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'join', type: 'parallel-gateway', name: 'Join', config: { mode: 'join', joinIncomingEdgeIds: ['e-a-join', 'e-b-join'] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'e-start-split', from: 'start', to: 'split' },
        { id: 'e-split-a', from: 'split', to: 'a' },
        { id: 'e-split-b', from: 'split', to: 'b' },
        { id: 'e-a-join', from: 'a', to: 'join' },
        { id: 'e-b-join', from: 'b', to: 'join' },
        { id: 'e-join-end', from: 'join', to: 'end' }
      ]
    }
    const { adapter } = createAdapter()
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-3',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: { prompt: 'parallel' },
      startNodeId: 'start'
    }, adapter)

    await engine.start()

    expect(engine.getState().status).toBe('completed')
    expect(engine.getState().activeBranches).toEqual([])
    expect(engine.getState().executionOrder).toEqual(['start', 'split', 'a', 'b', 'join', 'end'])
    expect(engine.getState().nodeRuns.a.status).toBe('completed')
    expect(engine.getState().nodeRuns.b.status).toBe('completed')
  })

  it('re-enters the same parallel split after a completed join', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-parallel-loop',
      name: 'Parallel loop',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split' } },
        { id: 'a', type: 'non-interactive-terminal', name: 'A', config: { command: 'a', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'b', type: 'non-interactive-terminal', name: 'B', config: { command: 'b', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'join', type: 'parallel-gateway', name: 'Join', config: { mode: 'join', joinIncomingEdgeIds: ['e-a-join', 'e-b-join'] } },
        { id: 'gate', type: 'exclusive-gateway', name: 'Repeat?', config: {} },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'e-start-split', from: 'start', to: 'split' },
        { id: 'e-split-a', from: 'split', to: 'a' },
        { id: 'e-split-b', from: 'split', to: 'b' },
        { id: 'e-a-join', from: 'a', to: 'join' },
        { id: 'e-b-join', from: 'b', to: 'join' },
        { id: 'e-join-gate', from: 'join', to: 'gate' },
        {
          id: 'e-gate-split',
          from: 'gate',
          to: 'split',
          condition: 'contains(sys_join_results_json, "again")'
        },
        { id: 'e-gate-end', from: 'gate', to: 'end', isDefault: true }
      ]
    }
    let aRuns = 0
    const runProcess = vi.fn(async (request: Parameters<WorkflowRuntimeAdapter['runProcess']>[0]) => {
      if (request.nodeId === 'a') aRuns += 1
      return {
        sessionId: `session-${request.nodeId}-${request.nodeId === 'a' ? aRuns : 'run'}`,
        stdout: request.nodeId === 'a' && aRuns === 1 ? 'again' : 'done',
        stderr: '',
        exitCode: 0
      }
    })
    const { adapter } = createAdapter({ runProcess })
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-parallel-loop',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: {},
      startNodeId: 'start'
    }, adapter)

    await engine.start()

    expect(engine.getState()).toMatchObject({
      status: 'completed',
      workflowCompleted: true,
      nodeRuns: { end: { status: 'completed' } }
    })
    expect(runProcess.mock.calls.filter(([request]) => request.nodeId === 'a')).toHaveLength(2)
    expect(runProcess.mock.calls.filter(([request]) => request.nodeId === 'b')).toHaveLength(2)
    expect(engine.getState().parallelResults.split.branches['e-split-a'].nodeRuns.a.stdout)
      .toBe('done')
  })

  it('converges a branch that enters a join directly without running the join Hook twice', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-direct-join',
      name: 'Direct join',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split' } },
        { id: 'work', type: 'non-interactive-terminal', name: 'Work', config: { command: 'echo work', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        {
          id: 'join',
          type: 'parallel-gateway',
          name: 'Join',
          config: { mode: 'join', joinIncomingEdgeIds: ['e-split-join', 'e-work-join'] },
          startHook: { enabled: true, command: 'echo join-hook', failPolicy: 'fail-node' }
        },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'e-start-split', from: 'start', to: 'split' },
        { id: 'e-split-join', from: 'split', to: 'join' },
        { id: 'e-split-work', from: 'split', to: 'work' },
        { id: 'e-work-join', from: 'work', to: 'join' },
        { id: 'e-join-end', from: 'join', to: 'end' }
      ]
    }
    const { adapter, hookRequests } = createAdapter()
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-direct-join',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: {},
      startNodeId: 'start'
    }, adapter)

    await engine.start()

    const state = engine.getState()
    expect(state.status).toBe('completed')
    expect(state.executionOrder.filter((nodeId) => nodeId === 'join')).toHaveLength(1)
    expect(hookRequests.filter((request) => request.nodeId === 'join')).toHaveLength(1)
    expect(state.parallelResults.split.branches['e-split-join']).toMatchObject({
      reachedJoinEdgeId: 'e-split-join',
      reachedJoinNodeId: 'join',
      nodeIds: []
    })
  })

  it('applies a direct join start-Hook failure once after every branch converges', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-direct-join-hook-failure',
      name: 'Direct join Hook failure',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split' } },
        { id: 'work', type: 'non-interactive-terminal', name: 'Work', config: { command: 'echo work', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        {
          id: 'join',
          type: 'parallel-gateway',
          name: 'Join',
          config: { mode: 'join', joinIncomingEdgeIds: ['e-split-join', 'e-work-join'] },
          startHook: { enabled: true, command: 'exit 7', failPolicy: 'fail-node' }
        },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'e-start-split', from: 'start', to: 'split' },
        { id: 'e-split-join', from: 'split', to: 'join' },
        { id: 'e-split-work', from: 'split', to: 'work' },
        { id: 'e-work-join', from: 'work', to: 'join' },
        { id: 'e-join-end', from: 'join', to: 'end' }
      ]
    }
    const runHook = vi.fn(async () => ({
      hookRunId: 'join-hook',
      stdout: '',
      stderr: 'join hook failed',
      exitCode: 7,
      status: 'failed' as const
    }))
    const { adapter } = createAdapter({ runHook })
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-direct-join-hook-failure',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: {},
      startNodeId: 'start'
    }, adapter)

    await engine.start()

    expect(runHook).toHaveBeenCalledTimes(1)
    expect(runHook).toHaveBeenCalledWith(expect.objectContaining({
      nodeId: 'join',
      hookType: 'start'
    }))
    expect(engine.getState()).toMatchObject({
      status: 'failed',
      workflowCompleted: false,
      error: expect.stringContaining('join hook failed'),
      nodeRuns: { join: { status: 'failed' } }
    })
    expect(Object.values(engine.getState().branchRuns).every((branch) => (
      branch.status === 'completed'
    ))).toBe(true)
  })

  it('completes a split whose branches terminate without a join', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-split-without-join',
      name: 'Split without join',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split' } },
        { id: 'end-a', type: 'end', name: 'End A', config: {} },
        { id: 'end-b', type: 'end', name: 'End B', config: {} }
      ],
      edges: [
        { id: 'e-start-split', from: 'start', to: 'split' },
        { id: 'e-split-a', from: 'split', to: 'end-a' },
        { id: 'e-split-b', from: 'split', to: 'end-b' }
      ]
    }
    const { adapter } = createAdapter()
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-split-without-join',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: {},
      startNodeId: 'start'
    }, adapter)

    await engine.start()

    expect(engine.getState()).toMatchObject({
      status: 'completed',
      workflowCompleted: true,
      activeBranches: [],
      nodeRuns: {
        'end-a': { status: 'completed' },
        'end-b': { status: 'completed' }
      }
    })
  })

  it('runs arbitrary subgraphs in parallel branches until joinIncomingEdgeIds arrive', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-parallel-subgraph',
      name: 'Parallel subgraph',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [{ key: 'prompt', label: 'Prompt', type: 'text', required: true }] } },
        { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split' } },
        { id: 'a1', type: 'non-interactive-terminal', name: 'A1', config: { command: 'echo a1', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'a2', type: 'non-interactive-terminal', name: 'A2', config: { command: 'echo a2 ${sys_branch_id}', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'b1', type: 'non-interactive-terminal', name: 'B1', config: { command: 'echo b1', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'join', type: 'parallel-gateway', name: 'Join', config: { mode: 'join', joinIncomingEdgeIds: ['e-a2-join', 'e-b1-join'] } },
        { id: 'after', type: 'non-interactive-terminal', name: 'After', config: { command: 'printf ${sys_join_results_json}', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'e-start-split', from: 'start', to: 'split' },
        { id: 'e-split-a1', from: 'split', to: 'a1' },
        { id: 'e-a1-a2', from: 'a1', to: 'a2' },
        { id: 'e-a2-join', from: 'a2', to: 'join' },
        { id: 'e-split-b1', from: 'split', to: 'b1' },
        { id: 'e-b1-join', from: 'b1', to: 'join' },
        { id: 'e-join-after', from: 'join', to: 'after' },
        { id: 'e-after-end', from: 'after', to: 'end' }
      ]
    }
    const { adapter, processRequests } = createAdapter()
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-subgraph',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: { prompt: 'parallel' },
      startNodeId: 'start'
    }, adapter)

    await engine.start()

    const state = engine.getState()
    expect(state.status).toBe('completed')
    expect(state.executionOrder).toEqual(expect.arrayContaining(['a1', 'a2', 'b1', 'join', 'after', 'end']))
    expect(state.parallelResults.split.branches).toEqual(expect.objectContaining({
      'e-split-a1': expect.objectContaining({ reachedJoinEdgeId: 'e-a2-join', nodeIds: ['a1', 'a2'] }),
      'e-split-b1': expect.objectContaining({ reachedJoinEdgeId: 'e-b1-join', nodeIds: ['b1'] })
    }))
    expect(Object.values(processRequests.find((request) => request.nodeId === 'a2')?.command.bindings ?? {})).toContain(
      'split:e-split-a1'
    )
    expect(Object.values(processRequests.find((request) => request.nodeId === 'after')?.command.bindings ?? {})).toContainEqual(
      expect.stringContaining('"splitNodeId":"split"')
    )
  })

  it('resumes only the waiting branch when branch input variables are provided', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-branch-input',
      name: 'Branch input',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [{ key: 'prompt', label: 'Prompt', type: 'text', required: true }] } },
        { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split' } },
        { id: 'ask', type: 'input', name: 'Ask', config: { variables: [{ key: 'branch_answer', label: 'Branch Answer', type: 'text', required: true }] } },
        { id: 'a-done', type: 'non-interactive-terminal', name: 'A Done', config: { command: 'echo ${branch_answer}', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'b-done', type: 'non-interactive-terminal', name: 'B Done', config: { command: 'echo b', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'join', type: 'parallel-gateway', name: 'Join', config: { mode: 'join', joinIncomingEdgeIds: ['e-a-done-join', 'e-b-done-join'] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'e-start-split', from: 'start', to: 'split' },
        { id: 'e-split-ask', from: 'split', to: 'ask' },
        { id: 'e-ask-a-done', from: 'ask', to: 'a-done' },
        { id: 'e-a-done-join', from: 'a-done', to: 'join' },
        { id: 'e-split-b-done', from: 'split', to: 'b-done' },
        { id: 'e-b-done-join', from: 'b-done', to: 'join' },
        { id: 'e-join-end', from: 'join', to: 'end' }
      ]
    }
    const { adapter, processRequests } = createAdapter()
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-branch-input',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: { prompt: 'go' },
      startNodeId: 'start'
    }, adapter)

    await engine.start()

    const waitingBranch = Object.values(engine.getState().branchRuns).find((branch) => branch.status === 'waiting-input')
    expect(waitingBranch?.currentNodeId).toBe('ask')
    expect(engine.getState().status).toBe('waiting-input')
    expect(processRequests.map((request) => request.nodeId)).toContain('b-done')

    await engine.updateVariables({ branch_answer: 'ok' }, waitingBranch!.branchId)

    expect(engine.getState().status).toBe('completed')
    expect(Object.values(processRequests.find((request) => request.nodeId === 'a-done')?.command.bindings ?? {})).toContain('ok')
  })

  it('does not start a running sibling as main flow when branch input resumes', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-branch-input-running-sibling',
      name: 'Branch input with running sibling',
      nodes: [
        { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split' } },
        { id: 'ask', type: 'input', name: 'Ask', config: { variables: [{ key: 'answer', label: 'Answer', type: 'text', required: true }] } },
        { id: 'a-done', type: 'non-interactive-terminal', name: 'A Done', config: { command: 'a', cwd: '/repo', successExitCodes: [0] } },
        { id: 'slow', type: 'non-interactive-terminal', name: 'Slow', config: { command: 'slow', cwd: '/repo', successExitCodes: [0] } },
        { id: 'join', type: 'parallel-gateway', name: 'Join', config: { mode: 'join', joinIncomingEdgeIds: ['a-join', 'slow-join'] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'split-ask', from: 'split', to: 'ask' },
        { id: 'ask-a', from: 'ask', to: 'a-done' },
        { id: 'a-join', from: 'a-done', to: 'join' },
        { id: 'split-slow', from: 'split', to: 'slow' },
        { id: 'slow-join', from: 'slow', to: 'join' },
        { id: 'join-end', from: 'join', to: 'end' }
      ]
    }
    const { adapter, processRequests } = createAdapter()
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-branch-input-running-sibling',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: {},
      initialState: {
        taskId: 'task-branch-input-running-sibling',
        projectId: 'project-1',
        projectDir: '/repo',
        workflowId: workflow.id,
        status: 'waiting-input',
        currentNodeId: 'ask',
        variables: {},
        nodeRuns: {
          split: { nodeId: 'split', status: 'completed' },
          ask: { nodeId: 'ask', status: 'waiting-input' },
          slow: { nodeId: 'slow', status: 'running', sessionId: 'session-slow' }
        },
        executionOrder: ['split', 'ask', 'slow'],
        activeBranches: ['split:split-ask', 'split:split-slow'],
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
          'split:split-slow': {
            branchId: 'split:split-slow',
            splitNodeId: 'split',
            entryEdgeId: 'split-slow',
            entryNodeId: 'slow',
            currentNodeId: 'slow',
            status: 'running',
            nodeIds: ['slow'],
            variables: {}
          }
        },
        parallelResults: {},
        workflowCompleted: false
      }
    }, adapter)

    await engine.updateVariables({ answer: 'ok' }, 'split:split-ask')

    expect(processRequests.map((request) => request.nodeId)).toEqual(['a-done'])
    expect(engine.getState()).toMatchObject({
      status: 'running',
      currentNodeId: 'slow',
      activeBranches: ['split:split-slow'],
      branchRuns: {
        'split:split-ask': { status: 'completed', reachedJoinEdgeId: 'a-join' },
        'split:split-slow': { status: 'running' }
      }
    })
    expect(engine.getState().nodeRuns.end).toBeUndefined()
  })

  it('restores a waiting-input snapshot and continues when variables are provided', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-restore-input',
      name: 'Restore input',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [{ key: 'prompt', label: 'Prompt', type: 'text', required: true }] } },
        { id: 'ask', type: 'input', name: 'Ask', config: { variables: [{ key: 'answer', label: 'Answer', type: 'text', required: true }] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'e-start-ask', from: 'start', to: 'ask' },
        { id: 'e-ask-end', from: 'ask', to: 'end' }
      ]
    }
    const { adapter } = createAdapter()
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-restore-input',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: { prompt: 'hello' },
      startNodeId: 'start'
    }, adapter)
    await engine.start()

    const restored = new WorkflowRuntimeEngine({
      taskId: 'task-restore-input',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: {},
      initialState: engine.getState()
    }, adapter)
    await restored.updateVariables({ answer: 'done' })

    expect(restored.getState().status).toBe('completed')
    expect(restored.getState().nodeRuns.end.status).toBe('completed')
  })

  it('continues a failed workflow after its terminal retry succeeds', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-retry-terminal',
      name: 'Retry terminal',
      nodes: [
        { id: 'terminal', type: 'non-interactive-terminal', name: 'Terminal', config: { command: 'test', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [{ id: 'e-terminal-end', from: 'terminal', to: 'end' }]
    }
    const { adapter } = createAdapter()
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-retry-terminal',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: {},
      initialState: {
        taskId: 'task-retry-terminal',
        projectId: 'project-1',
        projectDir: '/repo',
        workflowId: workflow.id,
        status: 'failed',
        currentNodeId: 'terminal',
        variables: {},
        nodeRuns: {
          terminal: { nodeId: 'terminal', status: 'failed', sessionId: 'session-terminal', stderr: 'failed', exitCode: 1 }
        },
        executionOrder: ['terminal'],
        activeBranches: [],
        branchRuns: {},
        parallelResults: {},
        workflowCompleted: false,
        error: 'Terminal: exit code 1'
      }
    }, adapter)

    expect(engine.canRetryTerminalNode('terminal')).toBe(true)
    await expect(engine.beginTerminalRetry('terminal', 'session-terminal')).resolves.toBe(true)
    expect(engine.getState()).toMatchObject({
      status: 'running',
      nodeRuns: { terminal: { status: 'running', sessionId: 'session-terminal' } }
    })

    await engine.completeTerminalRetry('terminal', 'session-terminal', {
      sessionId: 'session-terminal',
      stdout: 'retry succeeded',
      stderr: '',
      exitCode: 0,
      status: 'closed'
    })

    expect(engine.getState().status).toBe('completed')
    expect(engine.getState().nodeRuns.terminal).toMatchObject({
      status: 'completed',
      stdout: 'retry succeeded',
      exitCode: 0
    })
    expect(engine.getState().nodeRuns.end.status).toBe('completed')
  })

  it('retries a failed non-terminal node without replacing the workflow state', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-retry-gateway',
      name: 'Retry gateway',
      nodes: [
        { id: 'gateway', type: 'exclusive-gateway', name: 'Gateway', config: {} },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [{ id: 'gateway-end', from: 'gateway', to: 'end', isDefault: true }]
    }
    const { adapter } = createAdapter()
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-retry-gateway',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: { preserved: 'value' },
      initialState: {
        taskId: 'task-retry-gateway',
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
      }
    }, adapter)

    await expect(engine.beginNodeRetry('gateway')).resolves.toBe(true)
    expect(engine.getState()).toMatchObject({
      status: 'running',
      variables: { preserved: 'value' },
      nodeRuns: { gateway: { status: 'running' } }
    })

    await engine.continueNodeRetry('gateway')

    expect(engine.getState()).toMatchObject({
      status: 'completed',
      workflowCompleted: true,
      variables: { preserved: 'value' },
      nodeRuns: {
        gateway: { status: 'completed' },
        end: { status: 'completed' }
      }
    })
    expect(engine.getState().error).toBeUndefined()
  })

  it('retries a failed non-terminal branch and rejoins the completed sibling', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-retry-parallel-gateway',
      name: 'Retry parallel gateway',
      nodes: [
        { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split' } },
        { id: 'gate', type: 'exclusive-gateway', name: 'Gate', config: {} },
        { id: 'other', type: 'non-interactive-terminal', name: 'Other', config: { command: 'other', cwd: '${sys_project_dir}', successExitCodes: [0] } },
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
    const { adapter, processRequests } = createAdapter()
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-retry-parallel-gateway',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: { route: 'default' },
      initialState: {
        taskId: 'task-retry-parallel-gateway',
        projectId: 'project-1',
        projectDir: '/repo',
        workflowId: workflow.id,
        status: 'failed',
        currentNodeId: 'split',
        variables: { route: 'default' },
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
            reachedJoinEdgeId: 'gate-join',
            reachedJoinNodeId: 'join',
            variables: { route: 'default' },
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
            variables: { route: 'default' }
          }
        },
        parallelResults: {
          split: {
            splitNodeId: 'split',
            joinNodeId: 'join',
            requiredIncomingEdgeIds: ['gate-join', 'other-join'],
            branches: {}
          }
        },
        lastJoinResultSplitNodeId: 'split',
        workflowCompleted: false,
        error: 'old failure'
      }
    }, adapter)

    expect(engine.canRetryNode('gate', 'missing-branch')).toBe(false)
    await expect(engine.beginNodeRetry('gate', 'missing-branch')).resolves.toBe(false)
    expect(engine.canRetryNode('other', gateBranchId)).toBe(false)

    await expect(engine.beginNodeRetry('gate', gateBranchId)).resolves.toBe(true)
    const started = engine.getState()
    expect(started).toMatchObject({
      status: 'running',
      activeBranches: [gateBranchId],
      branchRuns: {
        [gateBranchId]: {
          status: 'running',
          currentNodeId: 'gate'
        }
      },
      parallelResults: {}
    })
    expect(started.branchRuns[gateBranchId]).not.toHaveProperty('reachedJoinEdgeId')
    expect(started.branchRuns[gateBranchId]).not.toHaveProperty('reachedJoinNodeId')
    expect(started.lastJoinResultSplitNodeId).toBeUndefined()

    await engine.continueNodeRetry('gate', gateBranchId)

    const retried = engine.getState()
    expect(retried).toMatchObject({
      status: 'completed',
      workflowCompleted: true,
      branchRuns: {
        [gateBranchId]: {
          status: 'completed',
          reachedJoinEdgeId: 'gate-join',
          reachedJoinNodeId: 'join'
        },
        [otherBranchId]: {
          status: 'completed',
          reachedJoinEdgeId: 'other-join'
        }
      },
      nodeRuns: {
        gate: { status: 'completed' },
        other: { status: 'completed' },
        join: { status: 'completed' },
        end: { status: 'completed' }
      }
    })
    expect(retried.parallelResults.split.branches).toMatchObject({
      'split-gate': { status: 'completed', reachedJoinEdgeId: 'gate-join' },
      'split-other': { status: 'completed', reachedJoinEdgeId: 'other-join' }
    })
    expect(processRequests).toHaveLength(0)
  })

  it('rejoins parallel branches after every failed terminal retry succeeds', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-retry-parallel',
      name: 'Retry parallel',
      nodes: [
        { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split' } },
        { id: 'a', type: 'non-interactive-terminal', name: 'A', config: { command: 'a', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'b', type: 'non-interactive-terminal', name: 'B', config: { command: 'b', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'join', type: 'parallel-gateway', name: 'Join', config: { mode: 'join', joinIncomingEdgeIds: ['e-a-join', 'e-b-join'] } },
        { id: 'review', type: 'input', name: 'Review', config: { variables: [] } }
      ],
      edges: [
        { id: 'e-split-a', from: 'split', to: 'a' },
        { id: 'e-split-b', from: 'split', to: 'b' },
        { id: 'e-a-join', from: 'a', to: 'join' },
        { id: 'e-b-join', from: 'b', to: 'join' },
        { id: 'e-join-review', from: 'join', to: 'review' }
      ]
    }
    const { adapter } = createAdapter()
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-retry-parallel',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: {},
      initialState: {
        taskId: 'task-retry-parallel',
        projectId: 'project-1',
        projectDir: '/repo',
        workflowId: workflow.id,
        status: 'failed',
        currentNodeId: 'split',
        variables: {},
        nodeRuns: {
          split: { nodeId: 'split', status: 'completed' },
          a: { nodeId: 'a', status: 'failed', exitCode: 1 },
          b: { nodeId: 'b', status: 'stopped', stderr: '其他并行分支失败' }
        },
        executionOrder: ['split', 'a', 'b'],
        activeBranches: [],
        branchRuns: {
          'split:e-split-a': {
            branchId: 'split:e-split-a',
            splitNodeId: 'split',
            entryEdgeId: 'e-split-a',
            entryNodeId: 'a',
            currentNodeId: 'a',
            status: 'failed',
            nodeIds: ['a'],
            variables: {},
            error: 'A: exit code 1'
          },
          'split:e-split-b': {
            branchId: 'split:e-split-b',
            splitNodeId: 'split',
            entryEdgeId: 'e-split-b',
            entryNodeId: 'b',
            currentNodeId: 'b',
            status: 'stopped',
            nodeIds: ['b'],
            variables: {},
            error: '其他并行分支失败'
          }
        },
        parallelResults: {},
        workflowCompleted: false,
        error: 'Parallel branch failed'
      }
    }, adapter)

    await engine.beginTerminalRetry('a', 'session-a')
    await engine.completeTerminalRetry('a', 'session-a', {
      sessionId: 'session-a', stdout: 'a ok', stderr: '', exitCode: 0, status: 'closed'
    })

    expect(engine.getState().status).toBe('failed')
    expect(engine.getState().branchRuns['split:e-split-a']).toMatchObject({
      status: 'completed',
      reachedJoinEdgeId: 'e-a-join'
    })

    await engine.beginTerminalRetry('b', 'session-b')
    await engine.completeTerminalRetry('b', 'session-b', {
      sessionId: 'session-b', stdout: 'b ok', stderr: '', exitCode: 0, status: 'closed'
    })

    const retried = engine.getState()
    expect(retried.status).toBe('waiting-input')
    expect(retried.currentNodeId).toBe('review')
    expect(retried.nodeRuns.a.status).toBe('completed')
    expect(retried.nodeRuns.b.status).toBe('completed')
    expect(retried.nodeRuns.join.status).toBe('completed')
    expect(retried.parallelResults.split.branches).toMatchObject({
      'e-split-a': { status: 'completed' },
      'e-split-b': { status: 'completed' }
    })
  })

  it('uses the default exclusive gateway edge only when no condition matches', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-gateway-default',
      name: 'Gateway default',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [{ key: 'go', label: 'Go', type: 'text', required: true }] } },
        { id: 'gate', type: 'exclusive-gateway', name: 'Gate', config: {} },
        { id: 'fallback', type: 'end', name: 'Fallback', config: {} },
        { id: 'target', type: 'end', name: 'Target', config: {} }
      ],
      edges: [
        { id: 'e-start-gate', from: 'start', to: 'gate' },
        { id: 'e-default', from: 'gate', to: 'fallback', isDefault: true },
        { id: 'e-target', from: 'gate', to: 'target', condition: 'go == "yes"' }
      ]
    }
    const { adapter } = createAdapter()
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-gateway-default',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: { go: 'yes' },
      startNodeId: 'start'
    }, adapter)

    await engine.start()

    expect(engine.getState().nodeRuns.gate.stdout).toBe('Selected branch: e-target')
    expect(engine.getState().currentNodeId).toBe('target')
  })

  it('retries a failed terminal branch immediately while its sibling is still running', async () => {
    const workflow = {
      id: 'wf-isolated-branch-failure',
      name: 'Isolated branch failure',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [{ key: 'prompt', label: 'Prompt', type: 'text', required: true }] } },
        { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split', failPolicy: 'fail-fast' } },
        { id: 'fail', type: 'non-interactive-terminal', name: 'Fail', config: { command: 'exit 1', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'slow', type: 'non-interactive-terminal', name: 'Slow', config: { command: 'sleep 10', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'join', type: 'parallel-gateway', name: 'Join', config: { mode: 'join', joinIncomingEdgeIds: ['e-fail-join', 'e-slow-join'] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'e-start-split', from: 'start', to: 'split' },
        { id: 'e-split-fail', from: 'split', to: 'fail' },
        { id: 'e-split-slow', from: 'split', to: 'slow' },
        { id: 'e-fail-join', from: 'fail', to: 'join' },
        { id: 'e-slow-join', from: 'slow', to: 'join' },
        { id: 'e-join-end', from: 'join', to: 'end' }
      ]
    } as unknown as WorkflowDefinition
    let releaseSlow: () => void = () => {
      throw new Error('Slow branch has not started')
    }
    const killCalls: string[] = []
    const processCounts = new Map<string, number>()
    const adapter: WorkflowRuntimeAdapter = {
      ...createAdapter().adapter,
      runProcess: async (request) => {
        processCounts.set(request.nodeId, (processCounts.get(request.nodeId) ?? 0) + 1)
        if (request.nodeId === 'fail') return { sessionId: 'session-fail', stdout: '', stderr: 'failed', exitCode: 1 }
        return new Promise((resolve) => {
          releaseSlow = () => resolve({ sessionId: 'session-slow', stdout: 'finished', stderr: '', exitCode: 0 })
        })
      },
      killTask: async (taskId) => {
        killCalls.push(taskId)
        return 1
      }
    }
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-isolated-branch-failure',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: { prompt: 'go' },
      startNodeId: 'start'
    }, adapter)

    const startPromise = engine.start()
    await vi.waitFor(() => {
      expect(engine.getState().nodeRuns.fail?.status).toBe('failed')
      expect(engine.getState().nodeRuns.slow?.status).toBe('running')
    })

    expect(killCalls).toEqual([])
    expect(engine.getState().branchRuns['split:e-split-slow'].status).toBe('running')

    await expect(engine.beginTerminalRetry('fail', 'session-fail-retry-1')).resolves.toBe(true)
    await engine.completeTerminalRetry('fail', 'session-fail-retry-1', {
      sessionId: 'session-fail-retry-1',
      stdout: '',
      stderr: 'failed again',
      exitCode: 2,
      status: 'closed'
    })

    expect(engine.getState().branchRuns['split:e-split-fail'].status).toBe('failed')
    expect(engine.getState().nodeRuns.slow.status).toBe('running')
    expect(processCounts.get('slow')).toBe(1)

    await expect(engine.beginTerminalRetry('fail', 'session-fail-retry-2')).resolves.toBe(true)
    await engine.completeTerminalRetry('fail', 'session-fail-retry-2', {
      sessionId: 'session-fail-retry-2',
      stdout: 'retry succeeded',
      stderr: '',
      exitCode: 0,
      status: 'closed'
    })

    expect(engine.getState().branchRuns['split:e-split-fail']).toMatchObject({
      status: 'completed',
      reachedJoinEdgeId: 'e-fail-join'
    })
    expect(engine.getState().nodeRuns.slow.status).toBe('running')
    expect(engine.getState().nodeRuns.join).toBeUndefined()
    expect(engine.getState().nodeRuns.end).toBeUndefined()

    releaseSlow()
    await startPromise

    const retried = engine.getState()
    expect(retried.status).toBe('completed')
    expect(retried.workflowCompleted).toBe(true)
    expect(retried.nodeRuns.fail.status).toBe('completed')
    expect(retried.nodeRuns.slow.status).toBe('completed')
    expect(retried.nodeRuns.join.status).toBe('completed')
    expect(retried.nodeRuns.end.status).toBe('completed')
    expect(retried.parallelResults.split.branches).toMatchObject({
      'e-split-fail': { status: 'completed' },
      'e-split-slow': { status: 'completed' }
    })
    expect(processCounts.get('slow')).toBe(1)
    expect(killCalls).toEqual([])
  })

  it('preserves undefined-valued fields when cloning state for getState', () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-clone',
      name: 'Clone',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [{ id: 'e-start-end', from: 'start', to: 'end' }]
    }
    const { adapter } = createAdapter()
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-clone',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: {},
      initialState: {
        taskId: 'task-clone',
        projectId: 'project-1',
        projectDir: '/repo',
        workflowId: workflow.id,
        status: 'running',
        currentNodeId: 'start',
        variables: {},
        nodeRuns: {},
        executionOrder: [],
        activeBranches: [],
        branchRuns: {},
        parallelResults: {
          split: {
            splitNodeId: 'split',
            joinNodeId: 'join',
            requiredIncomingEdgeIds: [],
            branches: {
              'e-1': {
                branchId: 'b1',
                entryEdgeId: 'e-1',
                entryNodeId: 'a',
                status: 'completed',
                nodeIds: [],
                variables: {},
                nodeRuns: {},
                error: undefined,
                reachedJoinEdgeId: undefined
              }
            }
          }
        },
        workflowCompleted: false
      }
    }, adapter)

    const branch = engine.getState().parallelResults.split.branches['e-1']

    expect('error' in branch).toBe(true)
    expect(branch.error).toBeUndefined()
    expect('reachedJoinEdgeId' in branch).toBe(true)
  })

  it('stops infinite loops via an execution cap', async () => {
    const workflow: WorkflowDefinition = {
      id: 'wf-cycle',
      name: 'Cycle',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [{ key: 'prompt', label: 'Prompt', type: 'text', required: true }] } },
        { id: 'cmd', type: 'non-interactive-terminal', name: 'Cmd', config: { command: 'echo loop', cwd: '${sys_project_dir}', successExitCodes: [0] } },
        { id: 'gate', type: 'exclusive-gateway', name: 'Gate', config: {} },
        { id: 'end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'e-start-cmd', from: 'start', to: 'cmd' },
        { id: 'e-cmd-gate', from: 'cmd', to: 'gate' },
        { id: 'e-gate-cmd', from: 'gate', to: 'cmd', isDefault: true },
        { id: 'e-gate-end', from: 'gate', to: 'end', condition: 'false == true' }
      ]
    }
    const { adapter } = createAdapter()
    const engine = new WorkflowRuntimeEngine({
      taskId: 'task-cycle',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: { prompt: 'go' },
      startNodeId: 'start'
    }, adapter)

    await engine.start()

    expect(engine.getState().status).toBe('failed')
    expect(engine.getState().error).toMatch(/execution count exceeded the limit|infinite loop/)
  })
})
