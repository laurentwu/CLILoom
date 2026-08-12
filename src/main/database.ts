import Database from 'better-sqlite3'
import {
  chmodSync,
  closeSync,
  existsSync,
  linkSync,
  mkdirSync,
  openSync,
  readSync,
  rmSync,
  statSync
} from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { AppError } from '../shared/appError'
import {
  LAST_OPENED_WORKSPACE_SETTING_KEY,
  parseLastOpenedWorkspace,
  type LastOpenedWorkspace
} from '../shared/appState'
import { APP_SLUG } from '../shared/branding'
import {
  parseWorkflowDefinition,
  parseWorkflowDefinitionStructure,
  type WorkflowDefinition
} from '../shared/workflow'
import {
  MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS,
  tailText
} from '../shared/terminalBuffer'
import { parseShellNeutralCommand } from '../shared/shell'
import { isUnsupportedProjectPath } from '../shared/projectPath'
import { normalizeTaskTitle } from '../shared/taskTitle'
import { NotFoundError } from './errors'
import { t } from './i18n'

export type AppDatabase = Database.Database
export type ProjectRecord = {
  id: string
  name: string
  path: string
  sort_order: number
  default_workflow_id?: string | null
  created_at: string
}

export type TaskRecord = {
  id: string
  project_id: string
  title: string
  status: string
  context_json: string
  created_at: string
  updated_at: string
}

export type TaskSummaryRecord = Omit<TaskRecord, 'context_json'>

export const DATABASE_FILENAME = `${APP_SLUG}.db`
const DATABASE_APPLICATION_ID = 0x434c4c4d
const CURRENT_SCHEMA_VERSION = 1
const SQLITE_HEADER_LENGTH = 72
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0')
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600

export function openDatabase(userDataPath: string): AppDatabase {
  ensurePrivateDataDirectory(userDataPath)
  const databasePath = path.join(userDataPath, DATABASE_FILENAME)
  const databaseExists = existsSync(databasePath)
  if (databaseExists) {
    ensurePrivateDataFile(databasePath)
    assertCurrentDatabaseLineage(databasePath)
  } else {
    createCurrentDatabase(databasePath)
    ensurePrivateDataFile(databasePath)
  }

  const db = new Database(databasePath, { fileMustExist: true })
  try {
    db.pragma('journal_mode = WAL')
    ensurePrivateSqliteFiles(databasePath)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

function createCurrentDatabase(databasePath: string): void {
  const initializationPath = `${databasePath}.initializing-${process.pid}-${randomUUID()}`
  let initializationDatabase: AppDatabase | null = null
  try {
    initializationDatabase = new Database(initializationPath)
    ensurePrivateDataFile(initializationPath)
    initializeCurrentSchema(initializationDatabase)
    initializationDatabase.close()
    initializationDatabase = null

    // A same-directory hard link publishes the complete, closed database in
    // one step and fails rather than replacing a target created concurrently.
    linkSync(initializationPath, databasePath)
  } finally {
    if (initializationDatabase) {
      try {
        initializationDatabase.close()
      } catch {
        // Cleanup below still removes only this attempt's private files.
      }
    }
    removeInitializationFiles(initializationPath)
  }
}

function ensurePrivateDataDirectory(directoryPath: string): void {
  mkdirSync(directoryPath, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  if (process.platform !== 'win32') chmodSync(directoryPath, PRIVATE_DIRECTORY_MODE)
}

function ensurePrivateDataFile(filePath: string): void {
  if (process.platform !== 'win32') chmodSync(filePath, PRIVATE_FILE_MODE)
}

function ensurePrivateSqliteFiles(databasePath: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const filePath = `${databasePath}${suffix}`
    if (existsSync(filePath)) ensurePrivateDataFile(filePath)
  }
}

function removeInitializationFiles(initializationPath: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try {
      rmSync(`${initializationPath}${suffix}`, { force: true })
    } catch {
      // A failed best-effort cleanup must not remove or invalidate a published database.
    }
  }
}

function assertCurrentDatabaseLineage(databasePath: string): void {
  const file = openSync(databasePath, 'r')
  try {
    const header = Buffer.alloc(SQLITE_HEADER_LENGTH)
    const bytesRead = readSync(file, header, 0, header.length, 0)
    const isSqlite = bytesRead === header.length &&
      header.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC)
    const applicationId = isSqlite ? header.readUInt32BE(68) : 0
    const schemaVersion = isSqlite ? header.readUInt32BE(60) : 0

    if (applicationId !== DATABASE_APPLICATION_ID) {
      throw new Error(
        t('errors:database.unsupportedSchemaDetected', { path: databasePath })
      )
    }
    if (schemaVersion !== CURRENT_SCHEMA_VERSION) {
      throw new Error(t('errors:database.unsupportedSchema', { version: schemaVersion }))
    }
  } finally {
    closeSync(file)
  }
}

function initializeCurrentSchema(db: AppDatabase): void {
  const initialize = db.transaction(() => {
    db.exec(`
      create table projects (
        id text primary key,
        name text not null,
        path text not null,
        sort_order integer not null default 0,
        default_workflow_id text,
        created_at text not null
      );

      create table tasks (
        id text primary key,
        project_id text,
        title text not null,
        status text not null,
        context_json text not null,
        created_at text not null,
        updated_at text not null
      );

      create table workflows (
        id text primary key,
        name text not null,
        definition_json text not null,
        created_at text not null,
        updated_at text not null,
        revision integer not null default 1
      );

      create table workflow_runs (
        id text primary key,
        workflow_id text not null,
        workflow_version integer,
        task_id text not null,
        status text not null,
        current_node_id text,
        context_json text not null,
        created_at text not null,
        updated_at text not null
      );

      create table node_runs (
        id text primary key,
        run_id text not null,
        node_id text not null,
        status text not null,
        started_at text,
        ended_at text,
        output_json text
      );

      create table edges (
        workflow_id text not null,
        id text not null,
        from_node_id text not null,
        to_node_id text not null,
        condition_expr text,
        is_default integer not null default 0,
        primary key (workflow_id, id)
      );

      create table terminal_sessions (
        id text primary key,
        task_id text not null,
        node_id text not null,
        kind text not null,
        command text not null,
        cwd text not null,
        status text not null,
        transcript text not null,
        created_at text not null,
        updated_at text not null,
        request_json text
      );

      create table process_logs (
        id text primary key,
        task_id text not null,
        node_id text,
        stream text not null,
        content text not null,
        created_at text not null
      );

      create table hook_runs (
        id text primary key,
        task_id text not null,
        node_id text not null,
        hook_type text not null,
        status text not null,
        stdout text not null,
        stderr text not null,
        exit_code integer,
        created_at text not null
      );

      create table workflow_versions (
        workflow_id text not null,
        version integer not null,
        definition_json text not null,
        created_at text not null,
        primary key (workflow_id, version)
      );

      create table settings (
        key text primary key,
        value_json text not null,
        updated_at text not null
      );

      create index idx_tasks_project_id on tasks(project_id);
      create index idx_terminal_sessions_task_id on terminal_sessions(task_id);
      create index idx_terminal_sessions_node_id on terminal_sessions(node_id);
      create index idx_process_logs_task_id on process_logs(task_id);
      create index idx_process_logs_task_node_created
        on process_logs(task_id, node_id, created_at desc);
      create index idx_hook_runs_task_id on hook_runs(task_id);
      create index idx_workflow_runs_task_id on workflow_runs(task_id);
      create index idx_workflow_runs_workflow_version
        on workflow_runs(workflow_id, workflow_version);
      create index idx_workflow_versions_workflow_id on workflow_versions(workflow_id);
      create index idx_edges_workflow_id on edges(workflow_id);
    `)
    db.pragma(`application_id = ${DATABASE_APPLICATION_ID}`)
    db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`)
  })
  initialize()
}

export type WorkflowRecord = {
  workflow: WorkflowDefinition
  revision: number
  createdAt: string
  updatedAt: string
}

export function listWorkflowRecords(db: AppDatabase): WorkflowRecord[] {
  const rows = db.prepare(
    'select id, definition_json, revision, created_at, updated_at from workflows order by updated_at desc'
  ).all() as Array<{
    id: string
    definition_json: string
    revision: number
    created_at: string
    updated_at: string
  }>
  return rows.flatMap((row) => {
    try {
      return [{
        workflow: parseStoredWorkflow(row.definition_json),
        revision: row.revision,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }]
    } catch (error) {
      console.warn(`[CLILoom workflow] skipped unreadable workflow ${row.id}:`, error)
      return []
    }
  })
}

export function getWorkflowRecord(db: AppDatabase, workflowId: string): WorkflowRecord | null {
  const row = db.prepare(
    'select definition_json, revision, created_at, updated_at from workflows where id = ?'
  ).get(workflowId) as {
    definition_json: string
    revision: number
    created_at: string
    updated_at: string
  } | undefined
  if (!row) return null
  try {
    return {
      workflow: parseStoredWorkflow(row.definition_json),
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  } catch {
    return null
  }
}

function parseStoredWorkflow(value: string): WorkflowDefinition {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new Error(t('errors:database.invalidWorkflowJson'))
  }
  return parseWorkflowDefinitionStructure(parsed)
}

export function ensureWorkflowVersion(db: AppDatabase, workflow: WorkflowDefinition): number {
  const canonicalWorkflow = parseWorkflowDefinitionStructure(workflow)
  const definitionJson = JSON.stringify(canonicalWorkflow)
  const existing = db.prepare(
    'select version from workflow_versions where workflow_id = ? and definition_json = ?'
  ).get(canonicalWorkflow.id, definitionJson) as { version: number } | undefined
  if (existing) return existing.version

  const latest = db.prepare(
    'select coalesce(max(version), 0) as version from workflow_versions where workflow_id = ?'
  ).get(canonicalWorkflow.id) as { version: number }
  const version = latest.version + 1
  db.prepare(
    'insert into workflow_versions (workflow_id, version, definition_json, created_at) values (?, ?, ?, ?)'
  ).run(canonicalWorkflow.id, version, definitionJson, new Date().toISOString())
  return version
}

export function loadWorkflowVersion(
  db: AppDatabase,
  workflowId: string,
  version: number
): WorkflowDefinition | null {
  const row = db.prepare(
    'select definition_json from workflow_versions where workflow_id = ? and version = ?'
  ).get(workflowId, version) as { definition_json: string } | undefined
  if (!row) return null

  try {
    return parseWorkflowDefinitionStructure(JSON.parse(row.definition_json) as unknown)
  } catch {
    return null
  }
}

export type SaveWorkflowResult = {
  workflow: WorkflowDefinition
  revision: number
  created: boolean
}

export class WorkflowRevisionConflictError extends AppError {
  constructor(message = t('errors:database.revisionConflict')) {
    super({ code: 'WORKFLOW_REVISION_CONFLICT', message })
    this.name = 'WorkflowRevisionConflictError'
  }
}

export function saveWorkflowWithRevision(
  db: AppDatabase,
  workflowInput: unknown,
  expectedRevision?: number
): SaveWorkflowResult {
  const normalizedWorkflow = parseWorkflowDefinition(workflowInput)
  return persistWorkflowWithRevision(db, normalizedWorkflow, expectedRevision)
}

function persistWorkflowWithRevision(
  db: AppDatabase,
  normalizedWorkflow: WorkflowDefinition,
  expectedRevision?: number
): SaveWorkflowResult {
  const now = new Date().toISOString()
  const deleteEdges = db.prepare('delete from edges where workflow_id = ?')
  const insertEdge = db.prepare(
    'insert into edges (workflow_id, id, from_node_id, to_node_id, condition_expr, is_default) values (?, ?, ?, ?, ?, ?)'
  )
  const tx = db.transaction((): SaveWorkflowResult => {
    const existing = db.prepare('select revision from workflows where id = ?').get(
      normalizedWorkflow.id
    ) as { revision: number } | undefined
    let revision: number
    let created = false

    if (!existing) {
      if (expectedRevision !== undefined) {
        throw new WorkflowRevisionConflictError(t('errors:database.workflowNotFoundForUpdate'))
      }
      db.prepare(
        'insert into workflows (id, name, definition_json, created_at, updated_at, revision) values (?, ?, ?, ?, ?, 1)'
      ).run(
        normalizedWorkflow.id,
        normalizedWorkflow.name,
        JSON.stringify(normalizedWorkflow),
        now,
        now
      )
      revision = 1
      created = true
    } else {
      if (expectedRevision === undefined) {
        throw new WorkflowRevisionConflictError(t('errors:database.workflowExistsNoRevision'))
      }
      if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
        throw new Error(t('errors:database.revisionPositive'))
      }
      const result = db.prepare(`
        update workflows
        set name = ?, definition_json = ?, updated_at = ?, revision = revision + 1
        where id = ? and revision = ?
      `).run(
        normalizedWorkflow.name,
        JSON.stringify(normalizedWorkflow),
        now,
        normalizedWorkflow.id,
        expectedRevision
      )
      if (result.changes !== 1) throw new WorkflowRevisionConflictError()
      revision = expectedRevision + 1
    }

    deleteEdges.run(normalizedWorkflow.id)
    for (const edge of normalizedWorkflow.edges) {
      insertEdge.run(
        normalizedWorkflow.id,
        edge.id,
        edge.from,
        edge.to,
        edge.condition ?? null,
        edge.isDefault ? 1 : 0
      )
    }
    return { workflow: normalizedWorkflow, revision, created }
  })
  return tx()
}

export type WorkflowDeleteImpact = {
  workflowId: string
  workflowName: string
  revision: number
  defaultProjectCount: number
  historicalTaskCount: number
  activeTaskCount: number
  missingVersionTaskCount: number
}

export function getWorkflowDeleteImpact(
  db: AppDatabase,
  workflowId: string
): WorkflowDeleteImpact {
  const existing = db.prepare(
    'select id, name, revision from workflows where id = ?'
  ).get(workflowId) as { id: string; name: string; revision: number } | undefined
  if (!existing) throw new NotFoundError(t('errors:database.workflowNotFound'))
  const missingVersions = db.prepare(
    'select count(distinct task_id) as count from workflow_runs where workflow_id = ? and workflow_version is null'
  ).get(workflowId) as { count: number }
  const activeUsage = db.prepare(`
    select count(distinct task_id) as count
    from workflow_runs
    where workflow_id = ? and status in ('running', 'waiting-input')
  `).get(workflowId) as { count: number }
  const historicalUsage = db.prepare(
    'select count(distinct task_id) as count from workflow_runs where workflow_id = ?'
  ).get(workflowId) as { count: number }
  const defaults = db.prepare(
    'select count(*) as count from projects where default_workflow_id = ?'
  ).get(workflowId) as { count: number }
  return {
    workflowId,
    workflowName: existing.name,
    revision: existing.revision,
    defaultProjectCount: defaults.count,
    historicalTaskCount: historicalUsage.count,
    activeTaskCount: activeUsage.count,
    missingVersionTaskCount: missingVersions.count
  }
}

export function deleteWorkflowWithRevision(
  db: AppDatabase,
  workflowId: string,
  expectedRevision: number
): void {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw new Error(t('errors:database.revisionPositive'))
  }
  const removeWorkflow = db.transaction(() => {
    const impact = getWorkflowDeleteImpact(db, workflowId)
    if (impact.revision !== expectedRevision) throw new WorkflowRevisionConflictError()
    if (impact.missingVersionTaskCount > 0) {
      throw new Error(t('errors:database.missingVersionTasks', { count: impact.missingVersionTaskCount }))
    }
    if (impact.activeTaskCount > 0) {
      throw new Error(t('errors:database.activeTasksInUse', { count: impact.activeTaskCount }))
    }
    db.prepare('update projects set default_workflow_id = null where default_workflow_id = ?').run(workflowId)
    db.prepare('delete from edges where workflow_id = ?').run(workflowId)
    const result = db.prepare('delete from workflows where id = ? and revision = ?').run(
      workflowId,
      expectedRevision
    )
    if (result.changes !== 1) throw new WorkflowRevisionConflictError()
  })
  removeWorkflow()
}

export function listProjects(db: AppDatabase): ProjectRecord[] {
  return db.prepare('select * from projects order by sort_order asc, created_at asc').all() as ProjectRecord[]
}

export type ProjectDirectoryInspector = (folderPath: string) => boolean

export function addProject(
  db: AppDatabase,
  folderPath: string,
  inspectDirectory: ProjectDirectoryInspector = defaultProjectDirectoryInspector
): ProjectRecord {
  assertProjectPathForStorage(folderPath)
  try {
    if (!inspectDirectory(folderPath)) throw new Error()
  } catch {
    throw new Error(t('errors:database.projectPathNotDirectory'))
  }
  const identity = projectPathIdentity(folderPath)
  const existing = (db.prepare('select * from projects').all() as ProjectRecord[])
    .find((project) => projectPathIdentity(project.path) === identity)
  if (existing) return existing

  const now = new Date().toISOString()
  const maxSort = db.prepare('select coalesce(max(sort_order), -1) as value from projects').get() as { value: number }
  const project: ProjectRecord = {
    id: randomUUID(),
    name: (path.win32.isAbsolute(folderPath) ? path.win32.basename(folderPath) : path.basename(folderPath)) || folderPath,
    path: folderPath,
    sort_order: maxSort.value + 1,
    default_workflow_id: null,
    created_at: now
  }
  db.prepare('insert into projects (id, name, path, sort_order, default_workflow_id, created_at) values (?, ?, ?, ?, ?, ?)').run(
    project.id,
    project.name,
    project.path,
    project.sort_order,
    project.default_workflow_id,
    project.created_at
  )
  return project
}

function assertProjectPathForStorage(folderPath: string): void {
  if (isUnsupportedProjectPath(folderPath)) {
    throw new Error(t('errors:database.projectPathUnsupported'))
  }
  if (
    typeof folderPath !== 'string' || !folderPath || folderPath.length > 16_384 ||
    folderPath.includes('\0') || folderPath.trim() !== folderPath ||
    (!path.isAbsolute(folderPath) && !path.win32.isAbsolute(folderPath))
  ) {
    throw new Error(t('errors:database.projectPathInvalid'))
  }
}

function defaultProjectDirectoryInspector(folderPath: string): boolean {
  return statSync(folderPath).isDirectory()
}

function projectPathIdentity(folderPath: string): string {
  if (path.win32.isAbsolute(folderPath)) {
    return `win:${path.win32.normalize(folderPath).toLocaleLowerCase('en-US')}`
  }
  return `native:${path.normalize(folderPath)}`
}

export function deleteProject(db: AppDatabase, projectId: string): void {
  const taskIds = db.prepare('select id from tasks where project_id = ?').all(projectId).map((row) => (row as { id: string }).id)
  const deleteByTask = db.transaction(() => {
    for (const taskId of taskIds) {
      db.prepare('delete from process_logs where task_id = ?').run(taskId)
      db.prepare('delete from terminal_sessions where task_id = ?').run(taskId)
      db.prepare('delete from hook_runs where task_id = ?').run(taskId)
      db.prepare('delete from node_runs where run_id in (select id from workflow_runs where task_id = ?)').run(taskId)
      db.prepare('delete from workflow_runs where task_id = ?').run(taskId)
    }
    db.prepare('delete from tasks where project_id = ?').run(projectId)
    db.prepare('delete from projects where id = ?').run(projectId)
  })
  deleteByTask()
}

export function reorderProjects(db: AppDatabase, projectIds: string[]): void {
  const update = db.prepare('update projects set sort_order = ? where id = ?')
  const tx = db.transaction(() => {
    projectIds.forEach((id, index) => update.run(index, id))
  })
  tx()
}

export function setProjectDefaultWorkflow(db: AppDatabase, projectId: string, workflowId: string): void {
  const project = db.prepare('select id from projects where id = ?').get(projectId)
  if (!project) throw new NotFoundError(t('errors:database.projectNotFound'))
  const workflow = db.prepare('select id from workflows where id = ?').get(workflowId)
  if (!workflow) throw new NotFoundError(t('errors:database.workflowNotFound'))
  db.prepare('update projects set default_workflow_id = ? where id = ?').run(workflowId, projectId)
}

export function deleteTask(db: AppDatabase, taskId: string): void {
  const cleanTask = db.transaction(() => {
    db.prepare('delete from process_logs where task_id = ?').run(taskId)
    db.prepare('delete from terminal_sessions where task_id = ?').run(taskId)
    db.prepare('delete from hook_runs where task_id = ?').run(taskId)
    db.prepare('delete from node_runs where run_id in (select id from workflow_runs where task_id = ?)').run(taskId)
    db.prepare('delete from workflow_runs where task_id = ?').run(taskId)
    db.prepare('delete from tasks where id = ?').run(taskId)
  })
  cleanTask()
}

export function updateTaskTitle(db: AppDatabase, taskId: string, title: string): void {
  if (typeof title !== 'string') throw new Error(t('errors:database.taskTitleInvalid'))
  const normalizedTitle = normalizeTaskTitle(title)
  if (!normalizedTitle) throw new Error(t('errors:database.taskTitleEmpty'))
  const now = new Date().toISOString()
  db.prepare('update tasks set title = ?, updated_at = ? where id = ?').run(normalizedTitle, now, taskId)
}

export function listTasks(db: AppDatabase, projectId: string): TaskSummaryRecord[] {
  return db.prepare(
    'select id, project_id, title, status, created_at, updated_at from tasks where project_id = ? order by created_at desc'
  ).all(projectId) as TaskSummaryRecord[]
}

export function getTaskContext(db: AppDatabase, taskId: string): string | null {
  const row = db.prepare('select context_json from tasks where id = ?').get(taskId) as
    { context_json: string } | undefined
  return row?.context_json ?? null
}

export type TerminalSessionRecord = {
  id: string
  task_id: string
  node_id: string
  kind: string
  command: string
  cwd: string
  status: string
  transcript: string | null
  transcript_cursor?: number | null
  execution_target?: TerminalExecutionTargetMetadata
  created_at: string
  updated_at: string
}

export type TerminalExecutionTargetMetadata = {
  kind: 'native'
  displayName: string
}

export function getTerminalSessionDisplayCommand(
  command: string,
  requestJson: string | null | undefined
): string {
  if (!requestJson) return command
  try {
    const request = JSON.parse(requestJson) as unknown
    if (!request || typeof request !== 'object' || Array.isArray(request)) return command
    const storedRequest = request as Record<string, unknown>
    if ((storedRequest.version === 2 || storedRequest.version === 3) && storedRequest.retry && typeof storedRequest.retry === 'object') {
      const retry = storedRequest.retry as Record<string, unknown>
      if (typeof retry.displayCommand === 'string') return retry.displayCommand
      const neutral = parseShellNeutralCommand(retry.command)
      if (!neutral) return command
      return neutral.segments.map((segment) => (
        segment.type === 'literal' ? segment.value : neutral.bindings[segment.name]
      )).join('')
    }
    const displayCommand = storedRequest.displayCommand
    if (typeof displayCommand === 'string') return displayCommand

    const env = storedRequest.env
    if (!env || typeof env !== 'object' || Array.isArray(env)) return command
    let restoredCommand = command
    for (const [key, value] of Object.entries(env)) {
      if (!/^CLILOOM_INTERNAL_VALUE_\d+$/.test(key) || typeof value !== 'string') continue
      restoredCommand = restoredCommand.replaceAll(`\${${key}}`, value)
    }
    return restoredCommand
  } catch {
    return command
  }
}

export function getTerminalSessionExecutionTarget(
  requestJson: string | null | undefined
): TerminalExecutionTargetMetadata | undefined {
  if (!requestJson) return undefined
  try {
    const parsed = JSON.parse(requestJson) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const envelope = parsed as Record<string, unknown>
    if (envelope.version !== 3) return undefined
    const diagnostic = envelope.diagnostic
    if (diagnostic && typeof diagnostic === 'object' && !Array.isArray(diagnostic)) {
      const value = diagnostic as Record<string, unknown>
      if (
        value.kind === 'native' &&
        typeof value.displayName === 'string' && value.displayName.length > 0 && value.displayName.length <= 512
      ) {
        return {
          kind: 'native',
          displayName: value.displayName
        }
      }
    }
    const retry = envelope.retry
    if (!retry || typeof retry !== 'object' || Array.isArray(retry)) return undefined
    const target = (retry as Record<string, unknown>).target
    if (!target || typeof target !== 'object' || Array.isArray(target)) return undefined
    const value = target as Record<string, unknown>
    if (typeof value.displayName !== 'string' || !value.displayName || value.displayName.length > 512) {
      return undefined
    }
    return value.kind === 'native'
      ? { kind: 'native', displayName: value.displayName }
      : undefined
  } catch {
    return undefined
  }
}

export function listTerminalSessionMetadataByTask(
  db: AppDatabase,
  taskId: string
): TerminalSessionRecord[] {
  const rows = db.prepare(
    `select id, task_id, node_id, kind, command, cwd, status,
      null as transcript, created_at, updated_at, request_json
    from terminal_sessions where task_id = ? order by created_at asc`
  ).all(taskId) as Array<
    TerminalSessionRecord & { request_json?: string | null }
  >

  return rows.map(({ request_json: requestJson, ...session }) => {
    const displayCommand = getTerminalSessionDisplayCommand(session.command, requestJson)
    const executionTarget = getTerminalSessionExecutionTarget(requestJson)
    return {
      ...session,
      command: displayCommand,
      ...(executionTarget ? { execution_target: executionTarget } : {})
    }
  })
}

export function getTerminalSessionTranscript(
  db: AppDatabase,
  taskId: string,
  sessionId: string
): string {
  const row = db.prepare(
    `select command, substr(transcript, -?) as transcript, request_json
    from terminal_sessions where task_id = ? and id = ?`
  ).get(MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS, taskId, sessionId) as {
    command: string
    transcript: string
    request_json?: string | null
  } | undefined
  if (!row) throw new NotFoundError(t('errors:session.notFound'))

  const displayCommand = getTerminalSessionDisplayCommand(row.command, row.request_json)
  return tailText(
    row.command ? row.transcript.replaceAll(row.command, displayCommand) : row.transcript,
    MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS
  )
}

export function getLastOpenedWorkspace(db: AppDatabase): LastOpenedWorkspace | null {
  const workspace = parseLastOpenedWorkspace(
    getSetting<unknown>(db, LAST_OPENED_WORKSPACE_SETTING_KEY, null)
  )
  if (!workspace) return null

  const project = db.prepare('select id from projects where id = ?').get(workspace.projectId)
  if (!project) return null
  if (!workspace.taskId) return workspace

  const task = db.prepare(
    'select id from tasks where id = ? and project_id = ?'
  ).get(workspace.taskId, workspace.projectId)
  return task ? workspace : { projectId: workspace.projectId, taskId: null }
}

export function setLastOpenedWorkspace(
  db: AppDatabase,
  value: unknown
): LastOpenedWorkspace | null {
  if (value === null) {
    setSetting(db, LAST_OPENED_WORKSPACE_SETTING_KEY, null)
    return null
  }

  const workspace = parseLastOpenedWorkspace(value)
  if (!workspace) throw new Error(t('errors:database.invalidWorkspace'))

  const project = db.prepare('select id from projects where id = ?').get(workspace.projectId)
  if (!project) throw new NotFoundError(t('errors:database.projectNotFound'))
  if (workspace.taskId) {
    const task = db.prepare(
      'select id from tasks where id = ? and project_id = ?'
    ).get(workspace.taskId, workspace.projectId)
    if (!task) throw new NotFoundError(t('errors:database.taskNotFound'))
  }

  setSetting(db, LAST_OPENED_WORKSPACE_SETTING_KEY, workspace)
  return workspace
}

export function getSetting<T>(db: AppDatabase, key: string, fallback: T): T {
  const row = db.prepare('select value_json from settings where key = ?').get(key) as { value_json: string } | undefined
  if (!row) return fallback
  try {
    return JSON.parse(row.value_json) as T
  } catch {
    return fallback
  }
}

export function setSetting(db: AppDatabase, key: string, value: unknown): void {
  db.prepare('insert or replace into settings (key, value_json, updated_at) values (?, ?, ?)').run(
    key,
    JSON.stringify(value),
    new Date().toISOString()
  )
}
