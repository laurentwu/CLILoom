import {
  ensureWorkflowVersion,
  listTerminalSessionMetadataByTask,
  loadWorkflowVersion,
  type AppDatabase,
  type TaskSummaryRecord,
  type TerminalSessionRecord
} from './database'
import { t } from './i18n'
import type {
  WorkflowRuntimeBranchRun,
  WorkflowRuntimeNodeRun,
  WorkflowRuntimeState,
  WorkflowRuntimeStatus,
  WorkflowRuntimeTaskSnapshot
} from '../shared/workflowRuntime'
import type { NodeRunStatus, WorkflowDefinition } from '../shared/workflow'
import type { TerminalTranscriptSnapshot } from '../shared/terminalBuffer'
import { getAutomaticTaskTitle } from '../shared/taskTitle'
import {
  isUnsupportedWslExecutionTarget,
  parseExecutionTargetDescriptor,
  type WorkflowExecutionContext
} from '../shared/shell'
import {
  compactNodeRun,
  compactRuntimeState,
  toStoredTaskContext,
  toStoredWorkflowContext
} from './runtimeStateStorage'

export type RestoreRuntimeOptions = {
  isTerminalSessionLive?: (session: TerminalSessionRecord) => boolean
  getLiveTerminalTranscript?: (
    session: TerminalSessionRecord
  ) => TerminalTranscriptSnapshot | null
}

export type RuntimeRestoreResult = {
  state: WorkflowRuntimeState | null
  workflow: WorkflowDefinition | null
  workflowVersion: number | null
  terminalSessions: TerminalSessionRecord[]
}

type WorkflowRunRow = {
  id: string
  workflow_id: string
  workflow_version: number | null
  task_id: string
  status: string
  current_node_id: string | null
  context_json: string
  created_at: string
  updated_at: string
}

type NodeRunRow = {
  id: string
  run_id: string
  node_id: string
  status: string
  started_at: string | null
  ended_at: string | null
  output_json: string | null
}

export function persistWorkflowRuntimeState(
  db: AppDatabase,
  state: WorkflowRuntimeState,
  taskStatus: WorkflowRuntimeStatus,
  workflow: WorkflowDefinition,
  workflowVersion?: number
): WorkflowRuntimeTaskSnapshot {
  const compactedState = compactRuntimeState(state)
  if (workflow.id !== compactedState.workflowId) {
    throw new Error(t('errors:runtime.workflowVersionMismatch', { actual: workflow.id, expected: compactedState.workflowId }))
  }
  const resolvedWorkflowVersion = workflowVersion ?? ensureWorkflowVersion(db, workflow)
  const now = new Date().toISOString()
  const createdAt = compactedState.task?.created_at ?? now
  const title = getAutomaticTaskTitle(
    workflow,
    compactedState.variables,
    t('task:defaultTitle')
  )
  const taskContextJson = JSON.stringify(toStoredTaskContext(compactedState))
  const workflowContextJson = JSON.stringify(toStoredWorkflowContext(compactedState))

  const tx = db.transaction(() => {
    db.prepare(
      'insert or replace into tasks (id, project_id, title, status, context_json, created_at, updated_at) values (?, ?, coalesce((select title from tasks where id = ?), ?), ?, ?, coalesce((select created_at from tasks where id = ?), ?), ?)'
    ).run(
      compactedState.taskId,
      compactedState.projectId,
      compactedState.taskId,
      title,
      taskStatus,
      taskContextJson,
      compactedState.taskId,
      createdAt,
      now
    )

    db.prepare(
      'insert or replace into workflow_runs (id, workflow_id, workflow_version, task_id, status, current_node_id, context_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, coalesce((select created_at from workflow_runs where id = ?), ?), ?)'
    ).run(
      compactedState.taskId,
      compactedState.workflowId,
      resolvedWorkflowVersion,
      compactedState.taskId,
      taskStatus,
      compactedState.currentNodeId,
      workflowContextJson,
      compactedState.taskId,
      now,
      now
    )

    const existingRows = db.prepare(
      'select node_id, status, started_at, ended_at, output_json from node_runs where run_id = ?'
    ).all(compactedState.taskId) as Array<{
      node_id: string
      status: string
      started_at: string | null
      ended_at: string | null
      output_json: string | null
    }>
    const existing = new Map(existingRows.map((row) => [row.node_id, row]))
    const insertNodeRun = db.prepare(
      'insert into node_runs (id, run_id, node_id, status, started_at, ended_at, output_json) values (?, ?, ?, ?, ?, ?, ?)'
    )
    const updateNodeRun = db.prepare(
      'update node_runs set status = ?, started_at = ?, ended_at = ?, output_json = ? where run_id = ? and node_id = ?'
    )
    for (const run of Object.values(compactedState.nodeRuns)) {
      const prior = existing.get(run.nodeId)
      const priorWasTerminal = prior?.ended_at !== null && prior?.ended_at !== undefined
      const startedAt = prior?.started_at ?? null
      const endedAt = isTerminalStatus(run.status) ? (priorWasTerminal ? prior!.ended_at : now) : null
      const outputJson = JSON.stringify(serializeNodeRunOutput(run))
      if (!prior) {
        insertNodeRun.run(
          `${compactedState.taskId}:${run.nodeId}`,
          compactedState.taskId,
          run.nodeId,
          run.status,
          startedAt,
          endedAt,
          outputJson
        )
      } else if (
        prior.status !== run.status ||
        prior.started_at !== startedAt ||
        prior.ended_at !== endedAt ||
        prior.output_json !== outputJson
      ) {
        updateNodeRun.run(
          run.status,
          startedAt,
          endedAt,
          outputJson,
          compactedState.taskId,
          run.nodeId
        )
      }
      existing.delete(run.nodeId)
    }
    const deleteNodeRun = db.prepare('delete from node_runs where run_id = ? and node_id = ?')
    for (const nodeId of existing.keys()) {
      deleteNodeRun.run(compactedState.taskId, nodeId)
    }
  })
  tx()

  const task = db.prepare(
    'select id, project_id, title, status, created_at, updated_at from tasks where id = ?'
  ).get(compactedState.taskId) as WorkflowRuntimeTaskSnapshot
  return task
}

export function restoreWorkflowRuntimeState(
  db: AppDatabase,
  taskId: string,
  options: RestoreRuntimeOptions = {}
): RuntimeRestoreResult {
  const terminalSessions = listTerminalSessionMetadataByTask(db, taskId)
  const normalizedSessions = normalizeTerminalSessions(db, terminalSessions, options)
  reconcileTaskRuntimeState(db, taskId)
  const run = db
    .prepare('select * from workflow_runs where task_id = ? order by updated_at desc limit 1')
    .get(taskId) as WorkflowRunRow | undefined
  if (!run) {
    return {
      state: null,
      workflow: null,
      workflowVersion: null,
      terminalSessions: normalizedSessions
    }
  }

  const state = restoreStateFromRun(db, run)
  const workflow = run.workflow_version === null
    ? null
    : loadWorkflowVersion(db, run.workflow_id, run.workflow_version)
  return {
    state,
    workflow,
    workflowVersion: run.workflow_version,
    terminalSessions: normalizedSessions
  }
}

export function reconcileRecoverableRuntimeState(
  db: AppDatabase,
  options: RestoreRuntimeOptions = {}
): void {
  const runningSessions = db
    .prepare(
      `select id, task_id, node_id, kind, command, cwd, status, '' as transcript,
        created_at, updated_at
      from terminal_sessions where status = ?`
    )
    .all('running') as TerminalSessionRecord[]
  normalizeTerminalSessions(db, runningSessions, options)

  const runningNodeRuns = db.prepare('select * from node_runs where status = ?').all('running') as NodeRunRow[]
  const updateNodeRun = db.prepare('update node_runs set status = ?, ended_at = ? where id = ?')
  const now = new Date().toISOString()
  for (const nodeRun of runningNodeRuns) {
    const output = parseJson<Record<string, unknown>>(nodeRun.output_json, {})
    const sessionId = typeof output.sessionId === 'string' ? output.sessionId : undefined
    if (!sessionId) {
      updateNodeRun.run('interrupted', now, nodeRun.id)
      continue
    }
    const session = db.prepare('select id, status from terminal_sessions where id = ?').get(sessionId) as
      Pick<TerminalSessionRecord, 'id' | 'status'> | undefined
    if (!session || session.status !== 'running') updateNodeRun.run('interrupted', now, nodeRun.id)
  }

  const runs = db
    .prepare(
      `select * from workflow_runs
      where status in ('running', 'waiting-input')
        or exists (
          select 1 from node_runs
          where node_runs.run_id = workflow_runs.id and node_runs.status = 'waiting-input'
        )`
    )
    .all() as WorkflowRunRow[]
  updateWorkflowStatuses(db, runs, now)
}

function reconcileTaskRuntimeState(db: AppDatabase, taskId: string): void {
  const runningNodeRuns = db
    .prepare('select * from node_runs where status = ? and run_id in (select id from workflow_runs where task_id = ?)')
    .all('running', taskId) as NodeRunRow[]
  const updateNodeRun = db.prepare('update node_runs set status = ?, ended_at = ? where id = ?')
  const now = new Date().toISOString()
  for (const nodeRun of runningNodeRuns) {
    const output = parseJson<Record<string, unknown>>(nodeRun.output_json, {})
    const sessionId = typeof output.sessionId === 'string' ? output.sessionId : undefined
    if (!sessionId) {
      updateNodeRun.run('interrupted', now, nodeRun.id)
      continue
    }
    const session = db.prepare('select id, status from terminal_sessions where id = ?').get(sessionId) as
      Pick<TerminalSessionRecord, 'id' | 'status'> | undefined
    if (!session || session.status !== 'running') updateNodeRun.run('interrupted', now, nodeRun.id)
  }

  const runs = db
    .prepare(
      `select * from workflow_runs
      where task_id = ? and (
        status in ('running', 'waiting-input')
        or exists (
          select 1 from node_runs
          where node_runs.run_id = workflow_runs.id and node_runs.status = 'waiting-input'
        )
      )`
    )
    .all(taskId) as WorkflowRunRow[]
  updateWorkflowStatuses(db, runs, now)
}

function updateWorkflowStatuses(db: AppDatabase, runs: WorkflowRunRow[], now: string): void {
  const updateWorkflow = db.prepare(
    'update workflow_runs set status = ?, current_node_id = ?, updated_at = ? where id = ?'
  )
  const updateTask = db.prepare('update tasks set status = ?, updated_at = ? where id = ?')
  for (const run of runs) {
    const nodeRuns = db.prepare('select * from node_runs where run_id = ?').all(run.id) as NodeRunRow[]
    const nextStatus = nextWorkflowStatus(run.status as WorkflowRuntimeStatus, nodeRuns)
    const waitingNodeId = nodeRuns.find((nodeRun) => nodeRun.status === 'waiting-input')?.node_id
    const nextCurrentNodeId = waitingNodeId ?? run.current_node_id
    if (nextStatus === run.status && nextCurrentNodeId === run.current_node_id) continue
    updateWorkflow.run(nextStatus, nextCurrentNodeId, now, run.id)
    updateTask.run(nextStatus, now, run.task_id)
  }
}

function restoreStateFromRun(db: AppDatabase, run: WorkflowRunRow): WorkflowRuntimeState {
  const context = parseJson<Partial<WorkflowRuntimeState>>(run.context_json, {})
  const executionContext = parseWorkflowExecutionContext(context.executionContext)
  const nodeRows = db.prepare('select * from node_runs where run_id = ?').all(run.id) as NodeRunRow[]
  const nodeRuns = restoreNodeRuns(nodeRows, context.nodeRuns)
  const status = run.status as WorkflowRuntimeStatus
  const currentNodeId = run.current_node_id ?? context.currentNodeId ?? ''
  const storedBranchRuns = context.branchRuns ?? {}
  const recoveredWaitingInput = status === 'waiting-input' && context.status !== 'waiting-input'
  const branchRuns: Record<string, WorkflowRuntimeBranchRun> = Object.fromEntries(
    Object.entries(storedBranchRuns).map(([branchId, branch]) => {
      if (branch.status !== 'running' && branch.status !== 'waiting-input') {
        return [branchId, branch]
      }

      const currentRun = nodeRuns[branch.currentNodeId]
      const recoveredStatus = recoveredBranchStatus(currentRun)
      if (currentRun?.status === 'completed' && currentRun.sessionId) {
        nodeRuns[branch.currentNodeId] = { ...currentRun, status: 'interrupted' }
      }
      return [branchId, { ...branch, status: recoveredStatus }]
    })
  )
  const activeBranches = Object.values(branchRuns)
    .filter((branch) => branch.status === 'running' || branch.status === 'waiting-input')
    .map((branch) => branch.branchId)
  const task = db.prepare(
    'select id, project_id, title, status, created_at, updated_at from tasks where id = ?'
  ).get(run.task_id) as TaskSummaryRecord | undefined

  return compactRuntimeState({
    taskId: run.task_id,
    projectId: context.projectId ?? task?.project_id ?? '',
    projectDir: context.projectDir ?? '',
    ...(executionContext ? { executionContext } : {}),
    workflowId: run.workflow_id,
    status,
    currentNodeId,
    variables: context.variables ?? {},
    nodeRuns,
    executionOrder: context.executionOrder ?? Object.keys(nodeRuns),
    activeBranches,
    branchRuns,
    parallelResults: context.parallelResults ?? {},
    lastJoinResultSplitNodeId: context.lastJoinResultSplitNodeId,
    workflowCompleted: recoveredWaitingInput ? false : context.workflowCompleted ?? status === 'completed',
    error: recoveredWaitingInput ? undefined : context.error,
    task
  })
}

function parseWorkflowExecutionContext(value: unknown): WorkflowExecutionContext | undefined {
  if (!isRecord(value) || value.version !== 1) return undefined
  if (isUnsupportedWslExecutionTarget(value.target)) {
    throw new Error(t('errors:runtime.executionTargetUnsupported'))
  }
  const target = parseExecutionTargetDescriptor(value.target)
  if (
    !target ||
    !isStoredPath(value.hostProjectDir) ||
    !isStoredPath(value.targetProjectDir)
  ) return undefined
  return {
    version: 1,
    target,
    hostProjectDir: value.hostProjectDir,
    targetProjectDir: value.targetProjectDir
  }
}

function isStoredPath(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value) &&
    value.length <= 16_384 && !value.includes('\0')
}

function restoreNodeRuns(
  rows: NodeRunRow[],
  fallback: Record<string, WorkflowRuntimeNodeRun> | undefined
): Record<string, WorkflowRuntimeNodeRun> {
  if (rows.length === 0) return fallback ?? {}

  return Object.fromEntries(rows.map((row) => {
    const output = parseJson<Omit<WorkflowRuntimeNodeRun, 'nodeId' | 'status'>>(row.output_json, {})
    return [
      row.node_id,
      compactNodeRun({
        nodeId: row.node_id,
        status: row.status as NodeRunStatus,
        ...output
      })
    ]
  }))
}

function normalizeTerminalSessions(
  db: AppDatabase,
  sessions: TerminalSessionRecord[],
  options: RestoreRuntimeOptions
): TerminalSessionRecord[] {
  const updateSession = db.prepare('update terminal_sessions set status = ?, updated_at = ? where id = ?')
  const now = new Date().toISOString()

  return sessions.map((session) => {
    if (session.status !== 'running') return session
    if (options.isTerminalSessionLive?.(session)) {
      const snapshot = options.getLiveTerminalTranscript?.(session)
      return snapshot === null || snapshot === undefined
        ? session
        : {
            ...session,
            transcript: snapshot.transcript,
            transcript_cursor: snapshot.cursor
          }
    }
    updateSession.run('interrupted', now, session.id)
    return { ...session, status: 'interrupted', updated_at: now }
  })
}

function serializeNodeRunOutput(run: WorkflowRuntimeNodeRun): Omit<WorkflowRuntimeNodeRun, 'nodeId' | 'status'> {
  const { nodeId: _nodeId, status: _status, ...output } = run
  return output
}

function nextWorkflowStatus(current: WorkflowRuntimeStatus, nodeRuns: NodeRunRow[]): WorkflowRuntimeStatus {
  if (nodeRuns.some((run) => run.status === 'waiting-input')) return 'waiting-input'
  if (nodeRuns.some((run) => run.status === 'running')) return 'running'
  if (nodeRuns.some((run) => run.status === 'failed')) return 'failed'
  if (nodeRuns.length > 0 && nodeRuns.every((run) => run.status === 'completed')) return 'completed'
  if (current === 'running') return 'interrupted'
  return current
}

function recoveredBranchStatus(run: WorkflowRuntimeNodeRun | undefined): WorkflowRuntimeStatus {
  if (run?.status === 'completed') return run.sessionId ? 'interrupted' : 'completed'
  if (
    run?.status === 'running' ||
    run?.status === 'waiting-input' ||
    run?.status === 'failed' ||
    run?.status === 'stopped' ||
    run?.status === 'interrupted'
  ) {
    return run.status
  }
  return 'stopped'
}

function isTerminalStatus(status: NodeRunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'stopped' || status === 'interrupted'
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
