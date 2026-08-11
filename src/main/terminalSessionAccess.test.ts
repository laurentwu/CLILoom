import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from './database'
import {
  listTaskTerminalSessions,
  resolveTaskSessionTranscript
} from './terminalSessionAccess'

const databases: Array<{ db: AppDatabase; dir: string }> = []

function createDatabase(): AppDatabase {
  const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-session-access-'))
  const db = openDatabase(dir)
  databases.push({ db, dir })
  db.prepare(
    'insert into terminal_sessions (id, task_id, node_id, kind, command, cwd, status, transcript, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    'session-1',
    'task-1',
    'node-1',
    'interactive',
    'bash',
    '/repo',
    'running',
    'stored transcript',
    '2026-08-09T00:00:00.000Z',
    '2026-08-09T00:00:00.000Z'
  )
  return db
}

afterEach(() => {
  while (databases.length > 0) {
    const item = databases.pop()!
    item.db.close()
    rmSync(item.dir, { recursive: true, force: true })
  }
})

describe('terminal session access', () => {
  it('prefers a task-bound live snapshot for session lists and transcript reads', () => {
    const db = createDatabase()
    const getLiveTranscriptSnapshot = vi.fn((sessionId: string, taskId?: string) => (
      sessionId === 'session-1' && taskId === 'task-1'
        ? { transcript: 'live transcript', cursor: 12 }
        : null
    ))
    const runner = { getLiveTranscriptSnapshot }

    expect(listTaskTerminalSessions(db, runner as never, 'task-1')[0]).toMatchObject({
      id: 'session-1',
      transcript: 'live transcript',
      transcript_cursor: 12
    })
    expect(resolveTaskSessionTranscript(db, runner as never, 'task-1', 'session-1'))
      .toEqual({ transcript: 'live transcript', cursor: 12 })
    expect(getLiveTranscriptSnapshot).toHaveBeenCalledWith('session-1', 'task-1')
  })

  it('falls back to persisted history while preserving task isolation', () => {
    const db = createDatabase()
    const runner = { getLiveTranscriptSnapshot: vi.fn(() => null) }

    expect(resolveTaskSessionTranscript(db, runner as never, 'task-1', 'session-1'))
      .toEqual({ transcript: 'stored transcript', cursor: null })
    expect(() => resolveTaskSessionTranscript(db, runner as never, 'other-task', 'session-1'))
      .toThrow()
  })

  it('rejects empty task and session identifiers before reading storage', () => {
    const db = createDatabase()
    const runner = { getLiveTranscriptSnapshot: vi.fn(() => null) }

    expect(() => resolveTaskSessionTranscript(db, runner as never, '', 'session-1'))
      .toThrow()
    expect(() => resolveTaskSessionTranscript(db, runner as never, 'task-1', ''))
      .toThrow()
    expect(runner.getLiveTranscriptSnapshot).not.toHaveBeenCalled()
  })
})
