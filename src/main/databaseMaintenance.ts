import { getSetting, setSetting, type AppDatabase } from './database'
import {
  MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS,
  tailText
} from '../shared/terminalBuffer'

const STORAGE_MAINTENANCE_SETTING_KEY = 'database.storageMaintenanceVersion'
const STORAGE_MAINTENANCE_VERSION = 1
const PROCESS_LOG_DELETE_BATCH_SIZE = 500
const TRANSCRIPT_UPDATE_BATCH_SIZE = 20

export const MIN_DATABASE_RECLAIM_BYTES = 16 * 1024 * 1024
export const MIN_DATABASE_RECLAIM_RATIO = 0.2

export type LegacyStorageCleanupResult = {
  completed: boolean
  processLogsDeleted: number
  transcriptsCompacted: number
}

export type DatabaseSpaceStats = {
  databaseBytes: number
  reclaimableBytes: number
  reclaimableRatio: number
}

export type DatabaseSpaceReclaimResult = {
  before: DatabaseSpaceStats
  after: DatabaseSpaceStats
  vacuumed: boolean
}

type LegacyStorageCleanupOptions = {
  canContinue?: () => boolean
  yieldToEventLoop?: () => Promise<void>
}

type DatabaseSpaceReclaimOptions = {
  canRun?: () => boolean
  minimumReclaimBytes?: number
  minimumReclaimRatio?: number
}

export async function compactLegacyStorage(
  db: AppDatabase,
  options: LegacyStorageCleanupOptions = {}
): Promise<LegacyStorageCleanupResult> {
  const storedVersion = getSetting<number>(db, STORAGE_MAINTENANCE_SETTING_KEY, 0)
  if (Number.isInteger(storedVersion) && storedVersion >= STORAGE_MAINTENANCE_VERSION) {
    return { completed: true, processLogsDeleted: 0, transcriptsCompacted: 0 }
  }

  const canContinue = options.canContinue ?? (() => true)
  const yieldToEventLoop = options.yieldToEventLoop ?? yieldForMaintenance
  let processLogsDeleted = 0
  let transcriptsCompacted = 0

  const deleteProcessLogs = db.prepare(
    `delete from process_logs where rowid in (
      select rowid from process_logs order by rowid limit ?
    )`
  )
  while (canContinue()) {
    const result = deleteProcessLogs.run(PROCESS_LOG_DELETE_BATCH_SIZE)
    processLogsDeleted += result.changes
    if (result.changes === 0) break
    await yieldToEventLoop()
  }
  if (!canContinue()) {
    return { completed: false, processLogsDeleted, transcriptsCompacted }
  }

  const selectOversizedTranscripts = db.prepare(
    `select rowid as row_id, transcript from terminal_sessions
    where rowid > ? and status <> 'running' and length(cast(transcript as blob)) > ?
    order by rowid limit ?`
  )
  const truncateTranscript = db.prepare(
    'update terminal_sessions set transcript = ? where rowid = ?'
  )
  const truncateBatch = db.transaction((rows: Array<{ row_id: number; transcript: string }>) => {
    let changes = 0
    for (const row of rows) {
      const transcript = tailText(row.transcript, MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS)
      if (transcript === row.transcript) continue
      changes += truncateTranscript.run(transcript, row.row_id).changes
    }
    return changes
  })
  let lastRowId = 0
  while (canContinue()) {
    const rows = selectOversizedTranscripts.all(
      lastRowId,
      MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS,
      TRANSCRIPT_UPDATE_BATCH_SIZE
    ) as Array<{ row_id: number; transcript: string }>
    if (rows.length === 0) break

    transcriptsCompacted += truncateBatch(rows)
    lastRowId = rows.at(-1)?.row_id ?? lastRowId
    await yieldToEventLoop()
  }
  if (!canContinue()) {
    return { completed: false, processLogsDeleted, transcriptsCompacted }
  }

  setSetting(db, STORAGE_MAINTENANCE_SETTING_KEY, STORAGE_MAINTENANCE_VERSION)
  return { completed: true, processLogsDeleted, transcriptsCompacted }
}

export function getDatabaseSpaceStats(db: AppDatabase): DatabaseSpaceStats {
  const pageSize = readPragmaNumber(db, 'page_size')
  const pageCount = readPragmaNumber(db, 'page_count')
  const freePageCount = readPragmaNumber(db, 'freelist_count')
  const databaseBytes = pageSize * pageCount
  const reclaimableBytes = pageSize * freePageCount
  return {
    databaseBytes,
    reclaimableBytes,
    reclaimableRatio: databaseBytes > 0 ? reclaimableBytes / databaseBytes : 0
  }
}

export function shouldReclaimDatabaseSpace(
  stats: DatabaseSpaceStats,
  minimumReclaimBytes = MIN_DATABASE_RECLAIM_BYTES,
  minimumReclaimRatio = MIN_DATABASE_RECLAIM_RATIO
): boolean {
  return stats.reclaimableBytes >= minimumReclaimBytes &&
    stats.reclaimableRatio >= minimumReclaimRatio
}

export function reclaimDatabaseSpaceIfNeeded(
  db: AppDatabase,
  options: DatabaseSpaceReclaimOptions = {}
): DatabaseSpaceReclaimResult {
  const canRun = options.canRun ?? (() => true)
  const minimumReclaimBytes = options.minimumReclaimBytes ?? MIN_DATABASE_RECLAIM_BYTES
  const minimumReclaimRatio = options.minimumReclaimRatio ?? MIN_DATABASE_RECLAIM_RATIO
  const before = getDatabaseSpaceStats(db)
  if (
    !canRun() ||
    !shouldReclaimDatabaseSpace(before, minimumReclaimBytes, minimumReclaimRatio)
  ) {
    return { before, after: before, vacuumed: false }
  }

  db.pragma('wal_checkpoint(TRUNCATE)')
  const checkpointed = getDatabaseSpaceStats(db)
  if (
    !canRun() ||
    !shouldReclaimDatabaseSpace(checkpointed, minimumReclaimBytes, minimumReclaimRatio)
  ) {
    return { before, after: checkpointed, vacuumed: false }
  }

  db.exec('vacuum')
  db.pragma('wal_checkpoint(TRUNCATE)')
  return { before, after: getDatabaseSpaceStats(db), vacuumed: true }
}

function readPragmaNumber(db: AppDatabase, name: string): number {
  return Number(db.pragma(name, { simple: true }))
}

function yieldForMaintenance(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}
