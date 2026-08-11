import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addProject, listTasks, openDatabase, type AppDatabase } from './database'
import { deleteProjectWithProcesses, deleteTaskWithProcesses } from './taskCleanup'

const dbs: Array<{ db: AppDatabase; dir: string }> = []
const assumeProjectDirectory = () => true

function createDb(): AppDatabase {
  const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-cleanup-'))
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

function addTask(db: AppDatabase, projectId: string, id: string) {
  const now = new Date().toISOString()
  db.prepare(
    'insert into tasks (id, project_id, title, status, context_json, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, projectId, id, 'running', '{}', now, now)
}

describe('task cleanup', () => {
  it('stops task execution before deleting a task', async () => {
    const db = createDb()
    const project = addProject(db, '/repo/task-cleanup', assumeProjectDirectory)
    addTask(db, project.id, 'task-1')
    let finishStop: () => void = () => undefined
    const cleaner = {
      stop: vi.fn(() => new Promise<null>((resolve) => {
        finishStop = () => resolve(null)
      }))
    }

    const deletion = deleteTaskWithProcesses(db, cleaner, 'task-1')

    expect(cleaner.stop).toHaveBeenCalledWith('task-1')
    expect(listTasks(db, project.id)).toHaveLength(1)
    finishStop()
    await deletion
    expect(listTasks(db, project.id)).toEqual([])
  })

  it('preserves a task when process-tree cleanup cannot be confirmed', async () => {
    const db = createDb()
    const project = addProject(db, '/repo/task-cleanup-failure', assumeProjectDirectory)
    addTask(db, project.id, 'task-cleanup-failure')
    const cleaner = {
      stop: vi.fn().mockRejectedValue(new Error('进程树未能确认终止'))
    }

    await expect(deleteTaskWithProcesses(db, cleaner, 'task-cleanup-failure'))
      .rejects.toThrow('进程树未能确认终止')
    expect(listTasks(db, project.id)).toHaveLength(1)
  })

  it('stops every project task before deleting a project', async () => {
    const db = createDb()
    const project = addProject(db, '/repo/project-cleanup', assumeProjectDirectory)
    addTask(db, project.id, 'task-1')
    addTask(db, project.id, 'task-2')
    const cleaner = { stop: vi.fn(async () => null) }

    await deleteProjectWithProcesses(db, cleaner, project.id)

    expect(cleaner.stop).toHaveBeenCalledWith('task-1')
    expect(cleaner.stop).toHaveBeenCalledWith('task-2')
    expect(listTasks(db, project.id)).toEqual([])
  })
})
