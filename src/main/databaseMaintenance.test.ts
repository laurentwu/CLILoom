import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS } from '../shared/terminalBuffer'
import { getSetting, openDatabase, type AppDatabase } from './database'
import {
  compactLegacyStorage,
  getDatabaseSpaceStats,
  reclaimDatabaseSpaceIfNeeded,
  shouldReclaimDatabaseSpace
} from './databaseMaintenance'

const databases: Array<{ db: AppDatabase; dir: string }> = []

function createDatabase(): AppDatabase {
  const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-maintenance-'))
  const db = openDatabase(dir)
  databases.push({ db, dir })
  return db
}

afterEach(() => {
  while (databases.length > 0) {
    const item = databases.pop()!
    item.db.close()
    rmSync(item.dir, { recursive: true, force: true })
  }
})

describe('database storage maintenance', () => {
  it('deletes legacy process logs and compacts only ended terminal transcripts', async () => {
    const db = createDatabase()
    const insertLog = db.prepare(
      'insert into process_logs (id, task_id, node_id, stream, content, created_at) values (?, ?, ?, ?, ?, ?)'
    )
    const insertLogs = db.transaction(() => {
      for (let index = 0; index < 1_200; index += 1) {
        insertLog.run(`log-${index}`, 'task-1', 'node-1', 'stdout', `log-${index}`, new Date().toISOString())
      }
    })
    insertLogs()

    const oversizedTranscript = `old-${'x'.repeat(MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS)}-tail`
    const insertSession = db.prepare(
      'insert into terminal_sessions (id, task_id, node_id, kind, command, cwd, status, transcript, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    insertSession.run(
      'ended-session', 'task-1', 'node-1', 'interactive', 'bash', '/repo', 'closed',
      oversizedTranscript, '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z'
    )
    insertSession.run(
      'running-session', 'task-1', 'node-2', 'interactive', 'bash', '/repo', 'running',
      oversizedTranscript, '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z'
    )
    const oversizedEmojiTranscript = '😀'.repeat(
      Math.floor(MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS / 2) + 1
    )
    insertSession.run(
      'ended-emoji-session', 'task-1', 'node-3', 'interactive', 'bash', '/repo', 'closed',
      oversizedEmojiTranscript, '2026-08-09T00:00:00.000Z', '2026-08-09T00:00:00.000Z'
    )
    const yieldToEventLoop = vi.fn(async () => undefined)

    const result = await compactLegacyStorage(db, { yieldToEventLoop })

    expect(result).toEqual({
      completed: true,
      processLogsDeleted: 1_200,
      transcriptsCompacted: 2
    })
    expect(yieldToEventLoop).toHaveBeenCalled()
    expect((db.prepare('select count(*) as count from process_logs').get() as { count: number }).count)
      .toBe(0)
    const sessions = db.prepare(
      'select id, transcript from terminal_sessions order by id'
    ).all() as Array<{ id: string; transcript: string }>
    const transcripts = new Map(sessions.map((session) => [session.id, session.transcript]))
    expect(transcripts.get('ended-session')).toBe(
      oversizedTranscript.slice(-MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS)
    )
    expect(transcripts.get('ended-emoji-session')).toBe(
      oversizedEmojiTranscript.slice(-MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS)
    )
    expect(transcripts.get('running-session')).toBe(oversizedTranscript)
    expect(getSetting(db, 'database.storageMaintenanceVersion', 0)).toBe(1)
    await expect(compactLegacyStorage(db)).resolves.toEqual({
      completed: true,
      processLogsDeleted: 0,
      transcriptsCompacted: 0
    })
  })

  it('leaves cleanup resumable when process activity interrupts a batch', async () => {
    const db = createDatabase()
    const insert = db.prepare(
      'insert into process_logs (id, task_id, node_id, stream, content, created_at) values (?, ?, ?, ?, ?, ?)'
    )
    const seed = db.transaction(() => {
      for (let index = 0; index < 600; index += 1) {
        insert.run(`log-${index}`, 'task-1', 'node-1', 'stdout', 'output', '2026-08-09T00:00:00.000Z')
      }
    })
    seed()
    let idle = true

    const interrupted = await compactLegacyStorage(db, {
      canContinue: () => idle,
      yieldToEventLoop: async () => {
        idle = false
      }
    })

    expect(interrupted.completed).toBe(false)
    expect(interrupted.processLogsDeleted).toBe(500)
    expect(getSetting(db, 'database.storageMaintenanceVersion', 0)).toBe(0)
    const resumed = await compactLegacyStorage(db)
    expect(resumed).toMatchObject({ completed: true, processLogsDeleted: 100 })
  })

  it('resumes transcript compaction after activity interrupts a batch', async () => {
    const db = createDatabase()
    const insert = db.prepare(
      'insert into terminal_sessions (id, task_id, node_id, kind, command, cwd, status, transcript, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    const seed = db.transaction(() => {
      for (let index = 0; index < 25; index += 1) {
        insert.run(
          `session-${index}`,
          'task-1',
          'node-1',
          'interactive',
          'bash',
          '/repo',
          'closed',
          `prefix-${index}-${'x'.repeat(MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS)}`,
          '2026-08-09T00:00:00.000Z',
          '2026-08-09T00:00:00.000Z'
        )
      }
    })
    seed()
    let idle = true

    const interrupted = await compactLegacyStorage(db, {
      canContinue: () => idle,
      yieldToEventLoop: async () => {
        idle = false
      }
    })

    expect(interrupted).toMatchObject({ completed: false, transcriptsCompacted: 20 })
    expect(getSetting(db, 'database.storageMaintenanceVersion', 0)).toBe(0)
    const resumed = await compactLegacyStorage(db)
    expect(resumed).toMatchObject({ completed: true, transcriptsCompacted: 5 })
    expect(getSetting(db, 'database.storageMaintenanceVersion', 0)).toBe(1)
  })

  it('reclaims space only when both configured thresholds are met', () => {
    const db = createDatabase()
    expect(shouldReclaimDatabaseSpace({
      databaseBytes: 100,
      reclaimableBytes: 20,
      reclaimableRatio: 0.2
    }, 20, 0.2)).toBe(true)
    expect(shouldReclaimDatabaseSpace({
      databaseBytes: 100,
      reclaimableBytes: 19,
      reclaimableRatio: 0.2
    }, 20, 0.2)).toBe(false)

    expect(reclaimDatabaseSpaceIfNeeded(db).vacuumed).toBe(false)

    const skipped = reclaimDatabaseSpaceIfNeeded(db, {
      canRun: () => false,
      minimumReclaimBytes: 0,
      minimumReclaimRatio: 0
    })
    expect(skipped.vacuumed).toBe(false)

    const canRunThroughCheckpoint = vi.fn()
      .mockReturnValueOnce(true)
      .mockReturnValue(false)
    const interruptedAfterCheckpoint = reclaimDatabaseSpaceIfNeeded(db, {
      canRun: canRunThroughCheckpoint,
      minimumReclaimBytes: 0,
      minimumReclaimRatio: 0
    })
    expect(interruptedAfterCheckpoint.vacuumed).toBe(false)
    expect(canRunThroughCheckpoint).toHaveBeenCalledTimes(2)

    const reclaimed = reclaimDatabaseSpaceIfNeeded(db, {
      minimumReclaimBytes: 0,
      minimumReclaimRatio: 0
    })
    expect(reclaimed.vacuumed).toBe(true)
    expect(getDatabaseSpaceStats(db).reclaimableBytes).toBe(0)
  })
})
