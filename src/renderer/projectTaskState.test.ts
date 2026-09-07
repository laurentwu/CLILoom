import { describe, expect, it } from 'vitest'
import type { WorkflowRuntimeStatus, WorkflowRuntimeState } from '../shared/workflowRuntime'
import type { ProjectRecord, TaskRecord } from './appTypes'
import {
  createProjectTaskState,
  getTaskObservationVersion,
  projectTaskReducer,
  selectCurrentProjectTasks,
  type ProjectTaskAction,
  type ProjectTaskState
} from './projectTaskState'

const projectA = project('a')
const projectB = project('b')
const projectC = project('c')

function project(id: string): ProjectRecord {
  return {
    id,
    name: `Project ${id}`,
    path: `/repo/${id}`,
    sort_order: 0,
    created_at: '2026-01-01T00:00:00.000Z'
  }
}

function task(
  projectId: string,
  id: string,
  status: WorkflowRuntimeStatus = 'running',
  updatedAt = '2026-01-01T00:00:00.000Z'
): TaskRecord {
  return {
    id,
    project_id: projectId,
    title: `Task ${id}`,
    status,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: updatedAt
  }
}

function runtime(
  record: TaskRecord,
  options: {
    status?: WorkflowRuntimeStatus
    includeTask?: boolean
    updatedAt?: string
  } = {}
): WorkflowRuntimeState {
  const status = options.status ?? record.status
  return {
    taskId: record.id,
    projectId: record.project_id,
    projectDir: `/repo/${record.project_id}`,
    workflowId: 'workflow',
    status,
    currentNodeId: 'start',
    variables: {},
    nodeRuns: {},
    executionOrder: [],
    activeBranches: [],
    branchRuns: {},
    parallelResults: {},
    workflowCompleted: status === 'completed',
    ...(options.includeTask === false ? {} : {
      task: {
        ...record,
        status,
        updated_at: options.updatedAt ?? record.updated_at
      }
    })
  }
}

function reduce(state: ProjectTaskState, ...actions: ProjectTaskAction[]): ProjectTaskState {
  return actions.reduce(projectTaskReducer, state)
}

function readyState(tasks: TaskRecord[] = [task('a', 'a-1')]): ProjectTaskState {
  return reduce(
    createProjectTaskState(),
    { type: 'syncProjects', projects: [projectA, projectB, projectC] },
    { type: 'activateProject', projectId: 'a', activationId: 1 },
    { type: 'listStarted', projectId: 'a', activationId: 1, requestId: 1 },
    { type: 'listSucceeded', projectId: 'a', activationId: 1, requestId: 1, tasks }
  )
}

describe('projectTaskReducer', () => {
  it('isolates every background status and marks only its owning project unread', () => {
    let state = readyState()
    const statuses: WorkflowRuntimeStatus[] = [
      'running',
      'waiting-input',
      'completed',
      'failed',
      'stopped',
      'interrupted'
    ]
    for (const status of statuses) {
      const backgroundTask = task('b', 'b-1', status, `2026-01-01T00:00:0${statuses.indexOf(status)}.000Z`)
      state = projectTaskReducer(state, {
        type: 'runtimeReceived',
        state: runtime(backgroundTask),
        source: 'event',
        moveTaskToFront: true
      })
      expect(selectCurrentProjectTasks(state, 'a').map((item) => item.id)).toEqual(['a-1'])
      expect(state.unreadProjectIds).toEqual(new Set(['b']))
    }
  })

  it('deduplicates the same background status while accepting a real transition after clearing', () => {
    const backgroundTask = task('b', 'b-1')
    let state = readyState()
    state = projectTaskReducer(state, {
      type: 'runtimeReceived',
      state: runtime(backgroundTask),
      source: 'event',
      moveTaskToFront: true
    })
    state = reduce(
      state,
      { type: 'activateProject', projectId: 'b', activationId: 2 },
      { type: 'listStarted', projectId: 'b', activationId: 2, requestId: 2 },
      { type: 'listSucceeded', projectId: 'b', activationId: 2, requestId: 2, tasks: [backgroundTask] },
      { type: 'activateProject', projectId: 'a', activationId: 3 },
      { type: 'listStarted', projectId: 'a', activationId: 3, requestId: 3 },
      { type: 'listSucceeded', projectId: 'a', activationId: 3, requestId: 3, tasks: [task('a', 'a-1')] }
    )
    state = projectTaskReducer(state, {
      type: 'runtimeReceived',
      state: runtime(backgroundTask, { updatedAt: '2026-01-02T00:00:00.000Z' }),
      source: 'command',
      moveTaskToFront: true
    })
    expect(state.unreadProjectIds.has('b')).toBe(false)

    state = projectTaskReducer(state, {
      type: 'runtimeReceived',
      state: runtime(backgroundTask, { status: 'completed', updatedAt: '2026-01-03T00:00:00.000Z' }),
      source: 'event',
      moveTaskToFront: true
    })
    expect(state.unreadProjectIds).toEqual(new Set(['b']))
  })

  it('updates another task in the current project without unread or changing selection concerns', () => {
    const first = task('a', 'a-1')
    const second = task('a', 'a-2')
    const state = projectTaskReducer(readyState([first, second]), {
      type: 'runtimeReceived',
      state: runtime(second, { status: 'completed', updatedAt: '2026-01-02T00:00:00.000Z' }),
      source: 'event',
      moveTaskToFront: true
    })
    expect(state.tasks.map((item) => [item.id, item.status])).toEqual([
      ['a-2', 'completed'],
      ['a-1', 'running']
    ])
    expect(state.unreadProjectIds.size).toBe(0)
  })

  it('keeps unread through loading and failure, then clears it atomically on success', () => {
    const backgroundTask = task('b', 'b-1')
    let state = projectTaskReducer(readyState(), {
      type: 'runtimeReceived',
      state: runtime(backgroundTask),
      source: 'event',
      moveTaskToFront: true
    })
    state = reduce(
      state,
      { type: 'activateProject', projectId: 'b', activationId: 2 },
      { type: 'listStarted', projectId: 'b', activationId: 2, requestId: 2 }
    )
    expect(state.unreadProjectIds.has('b')).toBe(true)
    state = projectTaskReducer(state, {
      type: 'listFailed', projectId: 'b', activationId: 2, requestId: 2
    })
    expect(state.unreadProjectIds.has('b')).toBe(true)
    state = projectTaskReducer(state, {
      type: 'runtimeReceived',
      state: runtime(backgroundTask, {
        status: 'completed',
        updatedAt: '2026-01-02T00:00:00.000Z'
      }),
      source: 'event',
      moveTaskToFront: true
    })
    state = reduce(
      state,
      { type: 'listStarted', projectId: 'b', activationId: 2, requestId: 3 },
      { type: 'listSucceeded', projectId: 'b', activationId: 2, requestId: 3, tasks: [backgroundTask] }
    )
    expect(state.phase).toBe('ready')
    expect(state.tasks[0].status).toBe('completed')
    expect(state.unreadProjectIds.has('b')).toBe(false)
  })

  it('rejects stale A responses across A to B to A navigation', () => {
    let state = readyState()
    state = reduce(
      state,
      { type: 'activateProject', projectId: 'b', activationId: 2 },
      { type: 'listStarted', projectId: 'b', activationId: 2, requestId: 2 },
      { type: 'activateProject', projectId: 'a', activationId: 3 },
      { type: 'listStarted', projectId: 'a', activationId: 3, requestId: 3 }
    )
    const stale = projectTaskReducer(state, {
      type: 'listSucceeded',
      projectId: 'a',
      activationId: 1,
      requestId: 1,
      tasks: [task('a', 'stale')]
    })
    expect(stale).toBe(state)
    const current = projectTaskReducer(state, {
      type: 'listSucceeded',
      projectId: 'a',
      activationId: 3,
      requestId: 3,
      tasks: [task('a', 'current')]
    })
    expect(current.tasks.map((item) => item.id)).toEqual(['current'])
  })

  it('merges runtime, rename, deletion and foreign filtering into a pending list snapshot', () => {
    let state = reduce(
      createProjectTaskState(),
      { type: 'syncProjects', projects: [projectA, projectB] },
      { type: 'activateProject', projectId: 'a', activationId: 1 },
      { type: 'listStarted', projectId: 'a', activationId: 1, requestId: 1 }
    )
    const updated = task('a', 'updated', 'completed', '2026-01-03T00:00:00.000Z')
    const created = task('a', 'created', 'running', '2026-01-04T00:00:00.000Z')
    state = reduce(
      state,
      {
        type: 'runtimeReceived',
        state: runtime(updated),
        source: 'event',
        moveTaskToFront: true
      },
      {
        type: 'runtimeReceived',
        state: runtime(created),
        source: 'event',
        moveTaskToFront: true
      },
      { type: 'taskRenamed', projectId: 'a', taskId: 'updated', title: 'Renamed' },
      { type: 'taskDeleted', projectId: 'a', taskId: 'deleted' }
    )
    state = projectTaskReducer(state, {
      type: 'listSucceeded',
      projectId: 'a',
      activationId: 1,
      requestId: 1,
      tasks: [
        task('a', 'updated', 'waiting-input'),
        task('a', 'deleted'),
        task('b', 'foreign')
      ]
    })
    expect(state.tasks.map((item) => [item.id, item.title, item.status])).toEqual([
      ['created', 'Task created', 'running'],
      ['updated', 'Renamed', 'completed']
    ])
  })

  it('tracks missing summaries without creating blank tasks and ignores invalid identities', () => {
    const unknown = task('b', 'b-1')
    let state = readyState()
    state = projectTaskReducer(state, {
      type: 'runtimeReceived',
      state: runtime(unknown, { includeTask: false }),
      source: 'event',
      moveTaskToFront: true
    })
    expect(state.unreadProjectIds.has('b')).toBe(true)
    expect(state.tasks.map((item) => item.id)).toEqual(['a-1'])

    const invalid = { ...runtime(unknown), projectId: 'unknown' }
    expect(projectTaskReducer(state, {
      type: 'runtimeReceived', state: invalid, source: 'event', moveTaskToFront: true
    })).toBe(state)
    const mismatched = {
      ...runtime(unknown),
      task: { ...runtime(unknown).task!, project_id: 'a' }
    }
    expect(projectTaskReducer(state, {
      type: 'runtimeReceived', state: mismatched, source: 'event', moveTaskToFront: true
    })).toBe(state)
  })

  it('does not resurrect a deleted task from runtime or a late list', () => {
    let state = projectTaskReducer(readyState(), {
      type: 'taskDeleted', projectId: 'a', taskId: 'a-1'
    })
    state = projectTaskReducer(state, {
      type: 'runtimeReceived',
      state: runtime(task('a', 'a-1', 'completed')),
      source: 'event',
      moveTaskToFront: true
    })
    expect(state.tasks).toEqual([])
    state = reduce(
      state,
      { type: 'listStarted', projectId: 'a', activationId: 1, requestId: 2 },
      {
        type: 'listSucceeded',
        projectId: 'a',
        activationId: 1,
        requestId: 2,
        tasks: [task('a', 'a-1')]
      }
    )
    expect(state.tasks).toEqual([])
  })

  it('does not let an old snapshot or restore overwrite a newer event', () => {
    const initial = task('a', 'a-1', 'running', '2026-01-02T00:00:00.000Z')
    let state = readyState([initial])
    const restoreVersion = getTaskObservationVersion(state, 'a', 'a-1')
    state = projectTaskReducer(state, {
      type: 'runtimeReceived',
      state: runtime(initial, { status: 'completed', updatedAt: '2026-01-04T00:00:00.000Z' }),
      source: 'event',
      moveTaskToFront: true
    })
    const afterEvent = state
    state = projectTaskReducer(state, {
      type: 'runtimeReceived',
      state: runtime(initial, { status: 'waiting-input', updatedAt: '2026-01-03T00:00:00.000Z' }),
      source: 'event',
      moveTaskToFront: true
    })
    expect(state).toBe(afterEvent)
    state = projectTaskReducer(state, {
      type: 'runtimeReceived',
      state: runtime(initial, { status: 'running', updatedAt: '2026-01-05T00:00:00.000Z' }),
      source: 'restore',
      moveTaskToFront: false,
      observationVersion: restoreVersion
    })
    expect(state).toBe(afterEvent)
    expect(state.tasks[0].status).toBe('completed')
  })

  it('cleans observations and unread state only when a project is removed', () => {
    const backgroundTask = task('b', 'b-1')
    let state = projectTaskReducer(readyState(), {
      type: 'runtimeReceived',
      state: runtime(backgroundTask),
      source: 'event',
      moveTaskToFront: true
    })
    const version = getTaskObservationVersion(state, 'b', 'b-1')
    state = projectTaskReducer(state, {
      type: 'syncProjects', projects: [projectC, projectA, projectB]
    })
    expect(state.unreadProjectIds.has('b')).toBe(true)
    expect(getTaskObservationVersion(state, 'b', 'b-1')).toBe(version)

    state = projectTaskReducer(state, { type: 'syncProjects', projects: [projectA, projectC] })
    expect(state.unreadProjectIds.has('b')).toBe(false)
    expect(getTaskObservationVersion(state, 'b', 'b-1')).toBe(0)

    state = projectTaskReducer(state, { type: 'syncProjects', projects: [projectC] })
    expect(state.projectId).toBeNull()
    expect(state.tasks).toEqual([])
    expect(state.phase).toBe('idle')
  })
})
