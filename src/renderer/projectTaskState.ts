import type {
  WorkflowRuntimeState,
  WorkflowRuntimeStatus,
  WorkflowRuntimeTaskSnapshot
} from '../shared/workflowRuntime'
import type { ProjectRecord, TaskRecord } from './appTypes'
import { mergeTaskRecord } from './utils'

export type RuntimeStateSource = 'event' | 'command' | 'restore'
export type ProjectTaskLoadPhase = 'idle' | 'loading' | 'ready' | 'error'

type TaskObservation = {
  status: WorkflowRuntimeStatus
  updatedAt?: string
  version: number
}

type LoadingTaskPatch = {
  snapshot?: WorkflowRuntimeTaskSnapshot
  status?: WorkflowRuntimeStatus
  title?: string
  moveToFrontOrder?: number
}

export type ProjectTaskState = {
  knownProjectIds: ReadonlySet<string>
  projectId: string | null
  activationId: number
  requestId: number | null
  phase: ProjectTaskLoadPhase
  tasks: TaskRecord[]
  observations: ReadonlyMap<string, TaskObservation>
  unreadProjectIds: ReadonlySet<string>
  loadingPatches: ReadonlyMap<string, LoadingTaskPatch>
  deletedTaskKeys: ReadonlySet<string>
  observationVersion: number
  receiveOrder: number
}

type RuntimeReceivedAction = {
  type: 'runtimeReceived'
  state: WorkflowRuntimeState
  source: RuntimeStateSource
  moveTaskToFront: boolean
  observationVersion?: number
}

export type ProjectTaskAction =
  | { type: 'syncProjects'; projects: ProjectRecord[] }
  | { type: 'activateProject'; projectId: string | null; activationId: number }
  | { type: 'listStarted'; projectId: string; activationId: number; requestId: number }
  | {
      type: 'listSucceeded'
      projectId: string
      activationId: number
      requestId: number
      tasks: TaskRecord[]
    }
  | { type: 'listFailed'; projectId: string; activationId: number; requestId: number }
  | RuntimeReceivedAction
  | { type: 'taskRenamed'; projectId: string; taskId: string; title: string }
  | { type: 'taskDeleted'; projectId: string; taskId: string }

function taskKey(projectId: string, taskId: string): string {
  return `${projectId}\u0000${taskId}`
}

function keyBelongsToProject(key: string, projectId: string): boolean {
  return key.startsWith(`${projectId}\u0000`)
}

function isOlderTimestamp(incoming: string | undefined, existing: string | undefined): boolean {
  if (!incoming || !existing) return false
  return incoming < existing
}

function snapshotUpdatedAt(state: WorkflowRuntimeState): string | undefined {
  return state.task?.updated_at
}

function snapshotsEqual(
  left: WorkflowRuntimeTaskSnapshot | undefined,
  right: WorkflowRuntimeTaskSnapshot | undefined
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return left.id === right.id &&
    left.project_id === right.project_id &&
    left.title === right.title &&
    left.status === right.status &&
    left.created_at === right.created_at &&
    left.updated_at === right.updated_at
}

function mergeSnapshotIntoTask(
  task: TaskRecord,
  snapshot: WorkflowRuntimeTaskSnapshot | undefined,
  status: WorkflowRuntimeStatus
): TaskRecord {
  return {
    ...task,
    ...(snapshot ? {
      title: snapshot.title,
      ...(snapshot.created_at ? { created_at: snapshot.created_at } : {}),
      ...(snapshot.updated_at ? { updated_at: snapshot.updated_at } : {})
    } : {}),
    status
  }
}

function taskFromSnapshot(
  snapshot: WorkflowRuntimeTaskSnapshot | undefined,
  status: WorkflowRuntimeStatus
): TaskRecord | null {
  if (!snapshot?.created_at || !snapshot.updated_at) return null
  return {
    id: snapshot.id,
    project_id: snapshot.project_id,
    title: snapshot.title,
    status,
    created_at: snapshot.created_at,
    updated_at: snapshot.updated_at
  }
}

function updateCurrentTasks(
  tasks: TaskRecord[],
  runtimeState: WorkflowRuntimeState,
  moveTaskToFront: boolean
): TaskRecord[] {
  const existing = tasks.find((task) => task.id === runtimeState.taskId)
  const task = existing
    ? mergeSnapshotIntoTask(existing, runtimeState.task, runtimeState.status)
    : taskFromSnapshot(runtimeState.task, runtimeState.status)
  if (!task) return tasks

  const alreadyEqual = existing &&
    existing.project_id === task.project_id &&
    existing.title === task.title &&
    existing.status === task.status &&
    existing.created_at === task.created_at &&
    existing.updated_at === task.updated_at
  if (alreadyEqual && (!moveTaskToFront || tasks[0]?.id === task.id)) return tasks
  return mergeTaskRecord(tasks, task, moveTaskToFront)
}

function isCurrentRequest(
  state: ProjectTaskState,
  action: { projectId: string; activationId: number; requestId: number }
): boolean {
  return state.projectId === action.projectId &&
    state.activationId === action.activationId &&
    state.requestId === action.requestId
}

export function createProjectTaskState(): ProjectTaskState {
  return {
    knownProjectIds: new Set(),
    projectId: null,
    activationId: 0,
    requestId: null,
    phase: 'idle',
    tasks: [],
    observations: new Map(),
    unreadProjectIds: new Set(),
    loadingPatches: new Map(),
    deletedTaskKeys: new Set(),
    observationVersion: 0,
    receiveOrder: 0
  }
}

export function isRuntimeStateIdentityValid(
  state: ProjectTaskState,
  runtimeState: WorkflowRuntimeState
): boolean {
  if (!state.knownProjectIds.has(runtimeState.projectId)) return false
  if (!runtimeState.task) return true
  return runtimeState.task.id === runtimeState.taskId &&
    runtimeState.task.project_id === runtimeState.projectId
}

export function canApplyRuntimeState(
  state: ProjectTaskState,
  runtimeState: WorkflowRuntimeState,
  source: RuntimeStateSource,
  observationVersion?: number
): boolean {
  if (!isRuntimeStateIdentityValid(state, runtimeState)) return false
  const key = taskKey(runtimeState.projectId, runtimeState.taskId)
  if (state.deletedTaskKeys.has(key)) return false
  const observed = state.observations.get(key)
  if (isOlderTimestamp(snapshotUpdatedAt(runtimeState), observed?.updatedAt)) return false
  if (source === 'restore' && observationVersion !== undefined) {
    return (observed?.version ?? 0) === observationVersion
  }
  return true
}

export function getTaskObservationVersion(
  state: ProjectTaskState,
  projectId: string,
  taskId: string
): number {
  return state.observations.get(taskKey(projectId, taskId))?.version ?? 0
}

export function selectCurrentProjectTasks(
  state: ProjectTaskState,
  activeProjectId: string | null
): TaskRecord[] {
  if (!activeProjectId || state.projectId !== activeProjectId) return []
  return state.tasks.filter((task) => task.project_id === activeProjectId)
}

export function projectTaskReducer(
  state: ProjectTaskState,
  action: ProjectTaskAction
): ProjectTaskState {
  switch (action.type) {
    case 'syncProjects': {
      const knownProjectIds = new Set(action.projects.map((project) => project.id))
      const observations = new Map(
        [...state.observations].filter(([key]) => (
          [...knownProjectIds].some((projectId) => keyBelongsToProject(key, projectId))
        ))
      )
      const unreadProjectIds = new Set(
        [...state.unreadProjectIds].filter((projectId) => knownProjectIds.has(projectId))
      )
      const deletedTaskKeys = new Set(
        [...state.deletedTaskKeys].filter((key) => (
          [...knownProjectIds].some((projectId) => keyBelongsToProject(key, projectId))
        ))
      )
      const currentProjectRemoved = state.projectId !== null && !knownProjectIds.has(state.projectId)
      const loadingPatches = !currentProjectRemoved
        ? state.loadingPatches
        : new Map<string, LoadingTaskPatch>()
      return {
        ...state,
        knownProjectIds,
        projectId: currentProjectRemoved ? null : state.projectId,
        requestId: currentProjectRemoved ? null : state.requestId,
        phase: currentProjectRemoved ? 'idle' : state.phase,
        tasks: currentProjectRemoved ? [] : state.tasks,
        observations,
        unreadProjectIds,
        loadingPatches,
        deletedTaskKeys
      }
    }

    case 'activateProject':
      return {
        ...state,
        projectId: action.projectId,
        activationId: action.activationId,
        requestId: null,
        phase: action.projectId ? 'loading' : 'idle',
        tasks: [],
        loadingPatches: new Map()
      }

    case 'listStarted':
      if (
        state.projectId !== action.projectId ||
        state.activationId !== action.activationId ||
        !state.knownProjectIds.has(action.projectId)
      ) return state
      return {
        ...state,
        requestId: action.requestId,
        phase: 'loading'
      }

    case 'listSucceeded': {
      if (!isCurrentRequest(state, action)) return state
      const deletedTaskKeys = state.deletedTaskKeys
      let tasks = action.tasks.filter((task) => (
        task.project_id === action.projectId &&
        !deletedTaskKeys.has(taskKey(action.projectId, task.id))
      ))
      const orderedPatches = [...state.loadingPatches.entries()].sort((left, right) => (
        (left[1].moveToFrontOrder ?? -1) - (right[1].moveToFrontOrder ?? -1)
      ))
      for (const [taskId, patch] of orderedPatches) {
        const key = taskKey(action.projectId, taskId)
        if (deletedTaskKeys.has(key)) continue
        const existing = tasks.find((task) => task.id === taskId)
        let task = existing
        if (patch.status) {
          task = existing
            ? mergeSnapshotIntoTask(existing, patch.snapshot, patch.status)
            : taskFromSnapshot(patch.snapshot, patch.status) ?? undefined
        }
        if (task && patch.title !== undefined) task = { ...task, title: patch.title }
        if (task) tasks = mergeTaskRecord(tasks, task, patch.moveToFrontOrder !== undefined)
      }

      const observations = new Map(state.observations)
      let observationVersion = state.observationVersion
      for (const task of tasks) {
        const key = taskKey(action.projectId, task.id)
        if (state.loadingPatches.has(task.id) && observations.has(key)) continue
        observationVersion += 1
        observations.set(key, {
          status: task.status,
          updatedAt: task.updated_at,
          version: observationVersion
        })
      }
      const unreadProjectIds = new Set(state.unreadProjectIds)
      unreadProjectIds.delete(action.projectId)
      return {
        ...state,
        tasks,
        observations,
        observationVersion,
        unreadProjectIds,
        loadingPatches: new Map(),
        phase: 'ready'
      }
    }

    case 'listFailed':
      if (!isCurrentRequest(state, action)) return state
      return {
        ...state,
        tasks: [...state.loadingPatches.entries()]
          .sort((left, right) => (
            (left[1].moveToFrontOrder ?? -1) - (right[1].moveToFrontOrder ?? -1)
          ))
          .reduce((tasks, [taskId, patch]) => {
            if (!patch.status || state.deletedTaskKeys.has(taskKey(action.projectId, taskId))) {
              return tasks
            }
            const existing = tasks.find((task) => task.id === taskId)
            let task = existing
              ? mergeSnapshotIntoTask(existing, patch.snapshot, patch.status)
              : taskFromSnapshot(patch.snapshot, patch.status) ?? undefined
            if (!task) return tasks
            if (patch.title !== undefined) task = { ...task, title: patch.title }
            return mergeTaskRecord(tasks, task, patch.moveToFrontOrder !== undefined)
          }, state.tasks),
        phase: 'error'
      }

    case 'runtimeReceived': {
      if (!canApplyRuntimeState(
        state,
        action.state,
        action.source,
        action.observationVersion
      )) return state

      const runtimeState = action.state
      const key = taskKey(runtimeState.projectId, runtimeState.taskId)
      const previousObservation = state.observations.get(key)
      const incomingUpdatedAt = snapshotUpdatedAt(runtimeState)
      const observationChanged = action.source !== 'restore' ||
        !previousObservation ||
        previousObservation.status !== runtimeState.status ||
        previousObservation.updatedAt !== (incomingUpdatedAt ?? previousObservation.updatedAt)
      const observationVersion = observationChanged
        ? state.observationVersion + 1
        : state.observationVersion
      const observations = observationChanged
        ? new Map(state.observations).set(key, {
            status: runtimeState.status,
            updatedAt: incomingUpdatedAt ?? previousObservation?.updatedAt,
            version: observationVersion
          })
        : state.observations
      const isCurrentProject = state.projectId === runtimeState.projectId
      let unreadProjectIds = state.unreadProjectIds
      if (
        action.source !== 'restore' &&
        !isCurrentProject &&
        (!previousObservation || previousObservation.status !== runtimeState.status) &&
        !state.unreadProjectIds.has(runtimeState.projectId)
      ) {
        unreadProjectIds = new Set(state.unreadProjectIds).add(runtimeState.projectId)
      }

      let tasks = state.tasks
      let loadingPatches = state.loadingPatches
      let receiveOrder = state.receiveOrder
      if (isCurrentProject) {
        if (state.phase === 'loading' || state.phase === 'error') {
          const previousPatch = state.loadingPatches.get(runtimeState.taskId)
          receiveOrder = action.moveTaskToFront ? state.receiveOrder + 1 : state.receiveOrder
          const nextPatch: LoadingTaskPatch = {
            ...previousPatch,
            snapshot: runtimeState.task ?? previousPatch?.snapshot,
            status: runtimeState.status,
            ...(action.moveTaskToFront ? { moveToFrontOrder: receiveOrder } : {})
          }
          if (
            previousPatch?.status !== nextPatch.status ||
            previousPatch?.moveToFrontOrder !== nextPatch.moveToFrontOrder ||
            !snapshotsEqual(previousPatch?.snapshot, nextPatch.snapshot)
          ) {
            loadingPatches = new Map(state.loadingPatches).set(runtimeState.taskId, nextPatch)
          }
        }
        if (state.phase !== 'loading') {
          tasks = updateCurrentTasks(state.tasks, runtimeState, action.moveTaskToFront)
        }
      }

      if (
        observations === state.observations &&
        unreadProjectIds === state.unreadProjectIds &&
        tasks === state.tasks &&
        loadingPatches === state.loadingPatches
      ) return state
      return {
        ...state,
        tasks,
        observations,
        observationVersion,
        unreadProjectIds,
        loadingPatches,
        receiveOrder
      }
    }

    case 'taskRenamed': {
      if (!state.knownProjectIds.has(action.projectId)) return state
      let tasks = state.tasks
      let loadingPatches = state.loadingPatches
      if (state.projectId === action.projectId) {
        tasks = state.tasks.map((task) => (
          task.id === action.taskId ? { ...task, title: action.title } : task
        ))
        if (state.phase === 'loading' || state.phase === 'error') {
          const previousPatch = state.loadingPatches.get(action.taskId) ?? {}
          loadingPatches = new Map(state.loadingPatches).set(action.taskId, {
            ...previousPatch,
            title: action.title
          })
        }
      }
      if (tasks === state.tasks && loadingPatches === state.loadingPatches) return state
      return { ...state, tasks, loadingPatches }
    }

    case 'taskDeleted': {
      if (!state.knownProjectIds.has(action.projectId)) return state
      const key = taskKey(action.projectId, action.taskId)
      const deletedTaskKeys = new Set(state.deletedTaskKeys).add(key)
      const observations = new Map(state.observations)
      observations.delete(key)
      let tasks = state.tasks
      let loadingPatches = state.loadingPatches
      if (state.projectId === action.projectId) {
        tasks = state.tasks.filter((task) => task.id !== action.taskId)
        const nextLoadingPatches = new Map(state.loadingPatches)
        nextLoadingPatches.delete(action.taskId)
        loadingPatches = nextLoadingPatches
      }
      return { ...state, deletedTaskKeys, observations, tasks, loadingPatches }
    }
  }
}
