import Database from 'better-sqlite3'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS,
  MAX_TERMINAL_TRANSCRIPT_CHARS
} from '../shared/terminalBuffer'
import type { WorkflowDefinition } from '../shared/workflow'
import {
  addProject,
  DATABASE_FILENAME,
  deleteProject,
  deleteTask,
  deleteWorkflowWithRevision,
  ensureWorkflowVersion,
  getLastOpenedWorkspace,
  getTaskDraft,
  getTerminalSessionTranscript,
  listProjects,
  listTerminalSessionMetadataByTask,
  listWorkflowRecords,
  loadWorkflowVersion,
  openDatabase,
  saveWorkflowWithRevision,
  saveTaskDraft,
  setLastOpenedWorkspace,
  setProjectDefaultWorkflow,
  updateProjectName,
  type AppDatabase
} from './database'
import { TASK_DRAFT_VERSION, type TaskDraftPayload } from '../shared/taskDraft'

const databases: Array<{ db: AppDatabase; dir: string }> = []
const assumeProjectDirectory = () => true

const databaseWorkflow: WorkflowDefinition = {
  id: 'database-workflow',
  name: 'Database workflow',
  nodes: [
    { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
    { id: 'end', type: 'end', name: 'End', config: {} }
  ],
  edges: [
    { id: 'start-end', from: 'start', to: 'end' }
  ]
}

afterEach(() => {
  while (databases.length > 0) {
    const item = databases.pop()!
    item.db.close()
    rmSync(item.dir, { recursive: true, force: true })
  }
})

function createTrackedDatabase(prefix = 'cliloom-database-'): {
  db: AppDatabase
  dir: string
} {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  const tracked = { db: openDatabase(dir), dir }
  databases.push(tracked)
  return tracked
}

function insertTask(
  db: AppDatabase,
  projectId: string,
  id: string,
  status = 'completed'
): string {
  const now = new Date().toISOString()
  db.prepare(
    'insert into tasks (id, project_id, title, status, context_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, projectId, id, status, '{}', now, now)
  return id
}

function listStoredWorkflows(db: AppDatabase): WorkflowDefinition[] {
  return listWorkflowRecords(db).map((record) => record.workflow)
}

describe('database schema v2', () => {
  it('creates and repairs private local data permissions on POSIX systems', () => {
    if (process.platform === 'win32') return

    const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-private-data-'))
    chmodSync(dir, 0o777)
    const tracked = { db: openDatabase(dir), dir }
    databases.push(tracked)
    const databasePath = path.join(dir, DATABASE_FILENAME)

    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(statSync(databasePath).mode & 0o777).toBe(0o600)

    tracked.db.close()
    chmodSync(dir, 0o777)
    chmodSync(databasePath, 0o000)
    tracked.db = openDatabase(dir)

    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(statSync(databasePath).mode & 0o777).toBe(0o600)
  })

  it('keeps WAL and shared-memory sidecars private after writes on POSIX systems', () => {
    if (process.platform === 'win32') return

    const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-private-sidecars-'))
    const tracked = (() => {
      const previousUmask = process.umask(0)
      try {
        return { db: openDatabase(dir), dir }
      } finally {
        process.umask(previousUmask)
      }
    })()
    databases.push(tracked)
    addProject(tracked.db, '/repo/private-sidecars', assumeProjectDirectory)

    for (const suffix of ['-wal', '-shm']) {
      const sidecarPath = path.join(dir, `${DATABASE_FILENAME}${suffix}`)
      expect(existsSync(sidecarPath)).toBe(true)
      expect(statSync(sidecarPath).mode & 0o777).toBe(0o600)
    }
  })

  it('repairs an existing permissive WAL sidecar when reopening on POSIX systems', () => {
    if (process.platform === 'win32') return

    const tracked = createTrackedDatabase('cliloom-repair-sidecar-')
    addProject(tracked.db, '/repo/repair-sidecar', assumeProjectDirectory)
    const walPath = path.join(tracked.dir, `${DATABASE_FILENAME}-wal`)
    expect(existsSync(walPath)).toBe(true)
    chmodSync(walPath, 0o644)

    const reopened = openDatabase(tracked.dir)
    tracked.db.close()
    tracked.db = reopened

    expect(statSync(walPath).mode & 0o777).toBe(0o600)
  })

  it('creates the complete current schema, lineage, version, and indexes', () => {
    const { db } = createTrackedDatabase()
    const tables = (db.prepare(
      "select name from sqlite_master where type = 'table' order by name"
    ).all() as Array<{ name: string }>).map((row) => row.name)

    expect(tables).toEqual([
      'edges',
      'hook_runs',
      'node_runs',
      'process_logs',
      'projects',
      'settings',
      'task_drafts',
      'tasks',
      'terminal_sessions',
      'workflow_runs',
      'workflow_versions',
      'workflows'
    ])
    expect(db.pragma('application_id', { simple: true })).toBe(0x434c4c4d)
    expect(db.pragma('user_version', { simple: true })).toBe(2)

    const expectedColumns: Record<string, string[]> = {
      projects: ['id', 'name', 'path', 'sort_order', 'default_workflow_id', 'created_at'],
      tasks: ['id', 'project_id', 'title', 'status', 'context_json', 'created_at', 'updated_at'],
      workflows: ['id', 'name', 'definition_json', 'created_at', 'updated_at', 'revision'],
      workflow_runs: [
        'id',
        'workflow_id',
        'workflow_version',
        'task_id',
        'status',
        'current_node_id',
        'context_json',
        'created_at',
        'updated_at'
      ],
      node_runs: ['id', 'run_id', 'node_id', 'status', 'started_at', 'ended_at', 'output_json'],
      edges: ['workflow_id', 'id', 'from_node_id', 'to_node_id', 'condition_expr', 'is_default'],
      terminal_sessions: [
        'id',
        'task_id',
        'node_id',
        'kind',
        'command',
        'cwd',
        'status',
        'transcript',
        'created_at',
        'updated_at',
        'request_json'
      ],
      process_logs: ['id', 'task_id', 'node_id', 'stream', 'content', 'created_at'],
      hook_runs: [
        'id',
        'task_id',
        'node_id',
        'hook_type',
        'status',
        'stdout',
        'stderr',
        'exit_code',
        'created_at'
      ],
      workflow_versions: ['workflow_id', 'version', 'definition_json', 'created_at'],
      settings: ['key', 'value_json', 'updated_at'],
      task_drafts: [
        'project_id',
        'workflow_id',
        'workflow_json',
        'variables_json',
        'revision',
        'created_at',
        'updated_at'
      ]
    }
    for (const [table, columns] of Object.entries(expectedColumns)) {
      const actual = (db.prepare(`pragma table_info(${table})`).all() as Array<{ name: string }>)
        .map((column) => column.name)
      expect(actual).toEqual(columns)
    }

    const edgePrimaryKey = (db.prepare('pragma table_info(edges)').all() as Array<{
      name: string
      pk: number
    }>)
      .filter((column) => column.pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map((column) => column.name)
    expect(edgePrimaryKey).toEqual(['workflow_id', 'id'])

    const indexes = (db.prepare(
      "select name from sqlite_master where type = 'index' and name not like 'sqlite_autoindex_%' order by name"
    ).all() as Array<{ name: string }>).map((row) => row.name)
    expect(indexes).toEqual([
      'idx_edges_workflow_id',
      'idx_hook_runs_task_id',
      'idx_process_logs_task_id',
      'idx_process_logs_task_node_created',
      'idx_task_drafts_updated_at',
      'idx_tasks_project_id',
      'idx_terminal_sessions_node_id',
      'idx_terminal_sessions_task_id',
      'idx_workflow_runs_task_id',
      'idx_workflow_runs_workflow_version',
      'idx_workflow_versions_workflow_id'
    ])
    const processLogIndex = db.prepare(
      "select sql from sqlite_master where type = 'index' and name = ?"
    ).get('idx_process_logs_task_node_created') as { sql: string }
    expect(processLogIndex.sql.replaceAll(/\s+/g, ' ').toLowerCase())
      .toContain('on process_logs(task_id, node_id, created_at desc)')
  })

  it('reopens a database carrying the current lineage without recreating it', () => {
    const tracked = createTrackedDatabase()
    const project = addProject(tracked.db, '/repo/current-lineage', assumeProjectDirectory)
    tracked.db.close()

    tracked.db = openDatabase(tracked.dir)

    expect(listProjects(tracked.db)).toEqual([project])
    expect(tracked.db.pragma('application_id', { simple: true })).toBe(0x434c4c4d)
    expect(tracked.db.pragma('user_version', { simple: true })).toBe(2)
  })

  it('can retry after schema initialization fails without publishing a partial database', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-failed-initialization-'))
    const databasePath = path.join(dir, DATABASE_FILENAME)
    const originalExec = Database.prototype.exec
    const execSpy = vi.spyOn(Database.prototype, 'exec').mockImplementationOnce(function (
      this: AppDatabase,
      sql: string
    ) {
      if (sql.includes('create table projects')) throw new Error('forced schema initialization failure')
      return originalExec.call(this, sql)
    })

    try {
      expect(() => openDatabase(dir)).toThrow('forced schema initialization failure')
    } finally {
      execSpy.mockRestore()
    }

    expect(existsSync(databasePath)).toBe(false)
    expect(readdirSync(dir)).toEqual([])

    const db = openDatabase(dir)
    databases.push({ db, dir })
    expect(db.pragma('application_id', { simple: true })).toBe(0x434c4c4d)
    expect(db.pragma('user_version', { simple: true })).toBe(2)
  })

  it.each([1, 16])(
    'rejects an unmarked development schema v%s without changing bytes or side files',
    (version) => {
      const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-unmarked-database-'))
      const databasePath = path.join(dir, 'cliloom.db')
      try {
        const developmentDb = new Database(databasePath)
        developmentDb.exec(`
          create table settings (
            key text primary key,
            value_json text not null,
            updated_at text not null
          )
        `)
        developmentDb.prepare(
          'insert into settings (key, value_json, updated_at) values (?, ?, ?)'
        ).run('schema_version', JSON.stringify(version), '2026-08-05T00:00:00.000Z')
        developmentDb.close()
        const bytesBefore = readFileSync(databasePath)
        const filesBefore = readdirSync(dir).sort()

        expect(() => openDatabase(dir)).toThrow('does not have the expected CLILoom database identity')
        expect(readFileSync(databasePath).equals(bytesBefore)).toBe(true)
        expect(readdirSync(dir).sort()).toEqual(filesBefore)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  )

  it('rejects a mismatched lineage before checking the schema version', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-mismatched-database-'))
    const databasePath = path.join(dir, 'cliloom.db')
    try {
      const developmentDb = new Database(databasePath)
      developmentDb.exec('create table development_data (value text not null)')
      developmentDb.pragma('application_id = 1234')
      developmentDb.pragma('user_version = 1')
      developmentDb.close()
      const bytesBefore = readFileSync(databasePath)
      const filesBefore = readdirSync(dir).sort()

      expect(() => openDatabase(dir)).toThrow('does not have the expected CLILoom database identity')
      expect(readFileSync(databasePath).equals(bytesBefore)).toBe(true)
      expect(readdirSync(dir).sort()).toEqual(filesBefore)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('rejects an unsupported version with matching lineage without writing', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-future-database-'))
    const databasePath = path.join(dir, 'cliloom.db')
    try {
      const futureDb = new Database(databasePath)
      futureDb.exec('create table future_data (value text not null)')
      futureDb.pragma('application_id = 1129073741')
      futureDb.pragma('user_version = 3')
      futureDb.close()
      const bytesBefore = readFileSync(databasePath)
      const filesBefore = readdirSync(dir).sort()

      expect(() => openDatabase(dir)).toThrow('Unsupported database schema version: 3')
      expect(readFileSync(databasePath).equals(bytesBefore)).toBe(true)
      expect(readdirSync(dir).sort()).toEqual(filesBefore)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('migrates an existing schema v1 database to the draft schema', () => {
    const tracked = createTrackedDatabase('cliloom-schema-migration-')
    const project = addProject(tracked.db, '/repo/schema-migration', assumeProjectDirectory)
    tracked.db.exec('drop index idx_task_drafts_updated_at; drop table task_drafts;')
    tracked.db.pragma('user_version = 1')
    tracked.db.close()

    tracked.db = openDatabase(tracked.dir)

    expect(tracked.db.pragma('user_version', { simple: true })).toBe(2)
    expect(listProjects(tracked.db)).toEqual([project])
    expect(
      tracked.db.prepare(
        "select name from sqlite_master where type = 'table' and name = 'task_drafts'"
      ).get()
    ).toEqual({ name: 'task_drafts' })
  })
})

describe('project path identity', () => {
  it('rejects WSL namespace paths without affecting ordinary UNC paths', () => {
    const { db } = createTrackedDatabase()

    expect(() => addProject(db, '\\\\wsl$\\Ubuntu\\home\\me\\repo', assumeProjectDirectory)).toThrow()
    expect(() => addProject(db, '\\\\wsl.localhost\\ubuntu\\home\\me\\repo', assumeProjectDirectory)).toThrow()
    expect(() => addProject(db, '//wsl$/Ubuntu/home/me/repo', assumeProjectDirectory)).toThrow()
    expect(() => addProject(db, '\\\\?\\UNC\\wsl.localhost\\Ubuntu\\home\\me\\repo', assumeProjectDirectory)).toThrow()
    expect(() => addProject(db, 'relative/path')).toThrow()
    expect(addProject(db, '\\\\server\\share\\repo', assumeProjectDirectory).path)
      .toBe('\\\\server\\share\\repo')
    expect(listProjects(db)).toHaveLength(1)
  })

  it('keeps legacy WSL namespace project records readable', () => {
    const { db } = createTrackedDatabase()
    db.prepare(
      'insert into projects (id, name, path, sort_order, default_workflow_id, created_at) values (?, ?, ?, ?, ?, ?)'
    ).run(
      'legacy-wsl-project',
      'Legacy project',
      '\\\\wsl$\\Ubuntu\\home\\me\\repo',
      0,
      null,
      '2026-08-04T00:00:00.000Z'
    )

    expect(listProjects(db)).toEqual([
      expect.objectContaining({
        id: 'legacy-wsl-project',
        path: '\\\\wsl$\\Ubuntu\\home\\me\\repo'
      })
    ])
  })

  it('checks directory existence at the database write boundary', () => {
    const tracked = createTrackedDatabase()
    expect(addProject(tracked.db, tracked.dir).path).toBe(tracked.dir)
    expect(() => addProject(tracked.db, path.join(tracked.dir, 'missing-project'))).toThrow()
  })
})

describe('project renaming', () => {
  it('trims and persists a display name without changing the project path or requiring uniqueness', () => {
    const { db } = createTrackedDatabase()
    const first = addProject(db, '/repo/first-project', assumeProjectDirectory)
    const second = addProject(db, '/repo/second-project', assumeProjectDirectory)

    const renamed = updateProjectName(db, second.id, `  ${first.name}  `)

    expect(renamed).toEqual({
      ...second,
      name: first.name
    })
    expect(listProjects(db)).toEqual([
      first,
      { ...second, name: first.name }
    ])
  })

  it('rejects invalid, empty, and missing project names at the database boundary', () => {
    const { db } = createTrackedDatabase()
    const project = addProject(db, '/repo/rename-validation', assumeProjectDirectory)

    expect(() => updateProjectName(db, project.id, 42)).toThrow()
    expect(() => updateProjectName(db, project.id, '   ')).toThrow()
    expect(() => updateProjectName(db, 'missing-project', 'Renamed')).toThrow()
    expect(listProjects(db)).toEqual([project])
  })
})

describe('last opened workspace', () => {
  it('stores a project and one of its tasks as a single selection', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-database-'))
    const trackedDatabase = { db: openDatabase(dir), dir }
    databases.push(trackedDatabase)
    const db = trackedDatabase.db
    const project = addProject(db, '/repo/remembered-project', assumeProjectDirectory)
    const otherProject = addProject(db, '/repo/other-project', assumeProjectDirectory)
    const taskId = insertTask(db, project.id, 'remembered-task', 'waiting-input')

    expect(setLastOpenedWorkspace(db, {
      projectId: project.id,
      taskId
    })).toEqual({ projectId: project.id, taskId })
    expect(() => setLastOpenedWorkspace(db, {
      projectId: otherProject.id,
      taskId
    })).toThrow('Task not found or does not belong to this project')

    trackedDatabase.db.close()
    trackedDatabase.db = openDatabase(dir)
    expect(getLastOpenedWorkspace(trackedDatabase.db)).toEqual({
      projectId: project.id,
      taskId
    })
  })

  it('falls back safely when a remembered task or project was deleted', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-database-'))
    const db = openDatabase(dir)
    databases.push({ db, dir })
    const project = addProject(db, '/repo/deleted-selection', assumeProjectDirectory)
    const taskId = insertTask(db, project.id, 'deleted-task')

    setLastOpenedWorkspace(db, { projectId: project.id, taskId })
    deleteTask(db, taskId)
    expect(getLastOpenedWorkspace(db)).toEqual({
      projectId: project.id,
      taskId: null
    })

    deleteProject(db, project.id)
    expect(getLastOpenedWorkspace(db)).toBeNull()
  })
})

describe('task draft persistence', () => {
  function draftPayload(revision: number, prompt = 'saved prompt'): TaskDraftPayload {
    return {
      version: TASK_DRAFT_VERSION,
      workflow: {
        ...databaseWorkflow,
        nodes: [
          {
            id: 'start',
            type: 'start',
            name: 'Start',
            config: {
              variables: [{
                key: 'prompt',
                label: 'Prompt',
                type: 'text',
                required: false,
                defaultValue: 'default'
              }]
            }
          },
          ...databaseWorkflow.nodes.slice(1)
        ]
      },
      variables: { prompt },
      revision
    }
  }

  it('round-trips one draft per project and ignores stale revisions', () => {
    const tracked = createTrackedDatabase()
    const project = addProject(tracked.db, '/repo/task-draft', assumeProjectDirectory)

    const saved = saveTaskDraft(tracked.db, project.id, draftPayload(1))
    expect(saved).toMatchObject({
      projectId: project.id,
      workflow: expect.objectContaining({ id: databaseWorkflow.id }),
      variables: { prompt: 'saved prompt' },
      revision: 1
    })

    const newer = saveTaskDraft(tracked.db, project.id, draftPayload(2, 'newer prompt'))
    expect(newer.variables).toEqual({ prompt: 'newer prompt' })
    const stale = saveTaskDraft(tracked.db, project.id, draftPayload(1, 'stale prompt'))
    expect(stale.variables).toEqual({ prompt: 'newer prompt' })
    expect(getTaskDraft(tracked.db, project.id)?.variables).toEqual({ prompt: 'newer prompt' })

    const overwritten = saveTaskDraft(
      tracked.db,
      project.id,
      draftPayload(1, 'fresh prompt'),
      { overwrite: true }
    )
    expect(overwritten.variables).toEqual({ prompt: 'fresh prompt' })
    expect(overwritten.revision).toBeGreaterThan(newer.revision)
    expect(saveTaskDraft(tracked.db, project.id, draftPayload(2, 'late stale prompt')).variables)
      .toEqual({ prompt: 'fresh prompt' })

    tracked.db.close()
    tracked.db = openDatabase(tracked.dir)
    expect(getTaskDraft(tracked.db, project.id)?.variables).toEqual({ prompt: 'fresh prompt' })
  })

  it('removes a project draft when the project is deleted', () => {
    const { db } = createTrackedDatabase()
    const project = addProject(db, '/repo/task-draft-delete', assumeProjectDirectory)
    saveTaskDraft(db, project.id, draftPayload(1))

    deleteProject(db, project.id)

    expect(getTaskDraft(db, project.id)).toBeNull()
  })

  it('rejects malformed drafts and drafts for unknown projects', () => {
    const { db } = createTrackedDatabase()
    const project = addProject(db, '/repo/task-draft-validation', assumeProjectDirectory)

    expect(() => saveTaskDraft(db, 'missing-project', draftPayload(1))).toThrow()
    expect(() => saveTaskDraft(db, project.id, {
      ...draftPayload(1),
      variables: { prompt: { nested: true } }
    })).toThrow()
  })
})

describe('workflow persistence', () => {
  it('rejects incoming edges on start nodes before persistence', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-database-'))
    const db = openDatabase(dir)
    databases.push({ db, dir })
    const workflow: WorkflowDefinition = {
      id: 'workflow-start-incoming',
      name: 'Start incoming',
      nodes: [
        { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
        {
          id: 'terminal',
          type: 'interactive-terminal',
          name: 'Terminal',
          config: { command: 'bash', cwd: '${sys_project_dir}', autoStart: true }
        }
      ],
      edges: [
        { id: 'start-terminal', from: 'start', to: 'terminal' },
        { id: 'terminal-start', from: 'terminal', to: 'start' }
      ]
    }

    expect(() => saveWorkflowWithRevision(db, workflow)).toThrow('Invalid workflow definition')
    expect(listWorkflowRecords(db)).toEqual([])
  })

  it('uses a monotonic revision and rejects stale or missing update tokens', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-database-'))
    const db = openDatabase(dir)
    databases.push({ db, dir })

    const created = saveWorkflowWithRevision(db, databaseWorkflow)
    const updated = saveWorkflowWithRevision(
      db,
      { ...databaseWorkflow, name: 'Updated once' },
      created.revision
    )

    expect(created.revision).toBe(1)
    expect(updated.revision).toBe(2)
    expect(() => saveWorkflowWithRevision(db, databaseWorkflow, created.revision))
      .toThrow('The workflow has been modified by another operation')
    expect(() => saveWorkflowWithRevision(db, databaseWorkflow))
      .toThrow('an expected revision must be provided when updating')
  })

  it('allows different workflows to use the same edge ID without replacing each other', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-database-'))
    const db = openDatabase(dir)
    databases.push({ db, dir })
    const secondWorkflow = {
      ...databaseWorkflow,
      id: 'database-workflow-2',
      name: 'Database workflow 2'
    }

    saveWorkflowWithRevision(db, databaseWorkflow)
    saveWorkflowWithRevision(db, secondWorkflow)

    expect(db.prepare('select workflow_id from edges where id = ? order by workflow_id').all('start-end'))
      .toEqual([
        { workflow_id: 'database-workflow' },
        { workflow_id: 'database-workflow-2' }
      ])
  })

  it('starts a new database without software-defined workflows', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-database-'))
    const db = openDatabase(dir)
    databases.push({ db, dir })

    expect(listStoredWorkflows(db)).toEqual([])
  })

  it('keeps database workflows across application restarts', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-database-'))
    let db = openDatabase(dir)

    saveWorkflowWithRevision(db, databaseWorkflow)
    db.close()

    db = openDatabase(dir)
    databases.push({ db, dir })
    expect(listStoredWorkflows(db)).toEqual([databaseWorkflow])
    expect(
      db.prepare('select count(*) as count from edges where workflow_id = ?')
        .get(databaseWorkflow.id)
    ).toEqual({ count: databaseWorkflow.edges.length })
  })

  it('canonicalizes workflow versions before deduplication', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-database-'))
    const db = openDatabase(dir)
    databases.push({ db, dir })
    const legacyWorkflow = {
      id: 'legacy-parallel-policy',
      name: 'Legacy parallel policy',
      nodes: [
        {
          id: 'split',
          type: 'parallel-gateway',
          name: 'Split',
          config: { mode: 'split', failPolicy: 'fail-fast' }
        }
      ],
      edges: []
    } as unknown as WorkflowDefinition

    const workflowVersion = ensureWorkflowVersion(db, legacyWorkflow)
    const canonicalVersion = ensureWorkflowVersion(db, {
      ...legacyWorkflow,
      nodes: [{ ...legacyWorkflow.nodes[0], config: { mode: 'split' } }]
    } as WorkflowDefinition)

    const storedVersion = db.prepare(
      'select definition_json from workflow_versions where workflow_id = ? and version = ?'
    ).get(legacyWorkflow.id, workflowVersion) as { definition_json: string }
    expect(canonicalVersion).toBe(workflowVersion)
    expect(storedVersion.definition_json).not.toContain('failPolicy')
    expect(loadWorkflowVersion(db, legacyWorkflow.id, workflowVersion)?.nodes[0].config)
      .toEqual({ mode: 'split' })
  })
})

describe('workflow deletion', () => {
  function createCustomWorkflow(): WorkflowDefinition {
    return {
      id: 'custom-workflow',
      name: 'Custom workflow',
      nodes: [
        { id: 'custom-start', type: 'start', name: 'Start', config: { variables: [] } },
        { id: 'custom-end', type: 'end', name: 'End', config: {} }
      ],
      edges: [
        { id: 'custom-start-end', from: 'custom-start', to: 'custom-end' }
      ]
    }
  }

  it('deletes a custom workflow, its edges, and project default references', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-database-'))
    const db = openDatabase(dir)
    databases.push({ db, dir })
    const project = addProject(db, '/repo/custom-workflow', assumeProjectDirectory)
    const workflow = createCustomWorkflow()
    const saved = saveWorkflowWithRevision(db, workflow)
    setProjectDefaultWorkflow(db, project.id, workflow.id)

    deleteWorkflowWithRevision(db, workflow.id, saved.revision)

    expect(listStoredWorkflows(db).some((item) => item.id === workflow.id)).toBe(false)
    expect(listProjects(db).find((item) => item.id === project.id)?.default_workflow_id).toBeNull()
    expect((db.prepare('select count(*) as count from edges where workflow_id = ?').get(workflow.id) as { count: number }).count)
      .toBe(0)
  })

  it('deletes workflows used only by historical tasks while retaining their versions', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-database-'))
    const db = openDatabase(dir)
    databases.push({ db, dir })
    const workflow = createCustomWorkflow()
    const saved = saveWorkflowWithRevision(db, workflow)
    const workflowVersion = ensureWorkflowVersion(db, workflow)
    const now = '2026-07-30T00:00:00.000Z'
    db.prepare(
      'insert into workflow_runs (id, workflow_id, workflow_version, task_id, status, current_node_id, context_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('custom-run', workflow.id, workflowVersion, 'custom-task', 'completed', 'custom-end', '{}', now, now)

    deleteWorkflowWithRevision(db, workflow.id, saved.revision)

    expect(listStoredWorkflows(db).some((item) => item.id === workflow.id)).toBe(false)
    expect(loadWorkflowVersion(db, workflow.id, workflowVersion)).toEqual(workflow)
  })

  it('does not delete workflows used by active tasks', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-database-'))
    const db = openDatabase(dir)
    databases.push({ db, dir })
    const workflow = createCustomWorkflow()
    const saved = saveWorkflowWithRevision(db, workflow)
    const workflowVersion = ensureWorkflowVersion(db, workflow)
    const now = '2026-07-30T00:00:00.000Z'
    db.prepare(
      'insert into workflow_runs (id, workflow_id, workflow_version, task_id, status, current_node_id, context_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('custom-run', workflow.id, workflowVersion, 'custom-task', 'waiting-input', 'custom-end', '{}', now, now)

    expect(() => deleteWorkflowWithRevision(db, workflow.id, saved.revision))
      .toThrow('Active tasks using this workflow: 1')
    expect(listStoredWorkflows(db).some((item) => item.id === workflow.id)).toBe(true)
  })
})

describe('terminal session queries', () => {
  it('returns the interpolated display command without exposing the executable binding', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-database-'))
    const db = openDatabase(dir)
    databases.push({ db, dir })

    db.prepare(
      'insert into terminal_sessions (id, task_id, node_id, kind, command, cwd, status, transcript, created_at, updated_at, request_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      'session-display-command',
      'task-display-command',
      'terminal',
      'interactive',
      'pi -p "${CLILOOM_INTERNAL_VALUE_0}"',
      '/repo',
      'closed',
      'www@host$ pi -p "${CLILOOM_INTERNAL_VALUE_0}"\n',
      '2026-08-04T00:00:00.000Z',
      '2026-08-04T00:00:00.000Z',
      JSON.stringify({ env: { CLILOOM_INTERNAL_VALUE_0: '实际的值' } })
    )

    const [session] = listTerminalSessionMetadataByTask(db, 'task-display-command')

    expect(session.command).toBe('pi -p "实际的值"')
    expect(session.transcript).toBeNull()
    expect(getTerminalSessionTranscript(
      db,
      'task-display-command',
      'session-display-command'
    )).toBe('www@host$ pi -p "实际的值"\n')
    expect(session).not.toHaveProperty('request_json')
  })

  it('reconstructs version-2 display commands from explicit display text or neutral bindings', () => {
    const { db } = createTrackedDatabase()
    const insert = db.prepare(
      'insert into terminal_sessions (id, task_id, node_id, kind, command, cwd, status, transcript, created_at, updated_at, request_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    const neutral = {
      version: 1,
      segments: [
        { type: 'literal', value: 'printf "' },
        { type: 'binding', name: 'CLILOOM_INTERNAL_VALUE_0' },
        { type: 'literal', value: '"' }
      ],
      bindings: { CLILOOM_INTERNAL_VALUE_0: '实际值' }
    }
    insert.run(
      'v2-explicit', 'v2-task', 'node-a', 'non-interactive',
      'printf "${CLILOOM_INTERNAL_VALUE_0}"', '/repo', 'closed',
      'printf "${CLILOOM_INTERNAL_VALUE_0}"\n',
      '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z',
      JSON.stringify({ version: 2, retry: { command: neutral, displayCommand: 'printf "显示值"' } })
    )
    insert.run(
      'v2-neutral', 'v2-task', 'node-b', 'non-interactive',
      'printf "${CLILOOM_INTERNAL_VALUE_0}"', '/repo', 'closed',
      'printf "${CLILOOM_INTERNAL_VALUE_0}"\n',
      '2026-08-04T00:00:01.000Z', '2026-08-04T00:00:01.000Z',
      JSON.stringify({ version: 2, retry: { command: neutral } })
    )

    const sessions = listTerminalSessionMetadataByTask(db, 'v2-task')
    expect(sessions.map((session) => session.command)).toEqual([
      'printf "显示值"',
      'printf "实际值"'
    ])
    expect(sessions.map((session) => getTerminalSessionTranscript(db, 'v2-task', session.id))).toEqual([
      'printf "显示值"\n',
      'printf "实际值"\n'
    ])
  })

  it('keeps legacy WSL terminal records readable without exposing unsupported target metadata', () => {
    const { db } = createTrackedDatabase()
    db.prepare(
      'insert into terminal_sessions (id, task_id, node_id, kind, command, cwd, status, transcript, created_at, updated_at, request_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      'wsl-diagnostic',
      'wsl-diagnostic-task',
      'terminal',
      'non-interactive',
      'pwd',
      '/home/me/repo',
      'closed',
      '',
      '2026-08-04T00:00:00.000Z',
      '2026-08-04T00:00:00.000Z',
      JSON.stringify({
        version: 3,
        retry: {
          command: { version: 1, segments: [{ type: 'literal', value: 'pwd' }], bindings: {} },
          sourceCwd: 'C:\\work\\repo',
          targetCwd: '/home/me/repo',
          target: {
            kind: 'wsl',
            id: 'wsl:v1:Ubuntu',
            displayName: 'Ubuntu',
            family: 'posix',
            distributionName: 'Ubuntu'
          }
        },
        diagnostic: {
          targetId: 'wsl:v1:Ubuntu',
          kind: 'wsl',
          family: 'posix',
          displayName: 'Ubuntu',
          distributionName: 'Ubuntu',
          wslVersion: 2,
          loginShellPath: '/bin/bash'
        }
      })
    )

    const session = listTerminalSessionMetadataByTask(db, 'wsl-diagnostic-task')[0]
    expect(session).toMatchObject({ id: 'wsl-diagnostic', command: 'pwd', cwd: '/home/me/repo' })
    expect(session).not.toHaveProperty('execution_target')
    expect(getTerminalSessionTranscript(db, 'wsl-diagnostic-task', 'wsl-diagnostic')).toBe('')
  })

  it('returns a bounded transcript tail', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-database-'))
    const db = openDatabase(dir)
    databases.push({ db, dir })
    const transcript = `old-${'x'.repeat(MAX_TERMINAL_TRANSCRIPT_CHARS)}-new`

    db.prepare(
      'insert into terminal_sessions (id, task_id, node_id, kind, command, cwd, status, transcript, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      'session-1',
      'task-1',
      'terminal',
      'interactive',
      'bash',
      '/repo',
      'closed',
      transcript,
      '2026-07-29T00:00:00.000Z',
      '2026-07-29T00:00:00.000Z'
    )

    const [session] = listTerminalSessionMetadataByTask(db, 'task-1')
    const loadedTranscript = getTerminalSessionTranscript(db, 'task-1', session.id)
    const stored = db.prepare('select length(transcript) as length from terminal_sessions where id = ?')
      .get('session-1') as { length: number }

    expect(session.transcript).toBeNull()
    expect(loadedTranscript).toBe(transcript.slice(-MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS))
    expect(loadedTranscript).toHaveLength(MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS)
    expect(stored.length).toBe(transcript.length)
    expect(() => getTerminalSessionTranscript(db, 'another-task', session.id))
      .toThrow('Terminal session not found')
  })
})
