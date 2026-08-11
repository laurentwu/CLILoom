import {
  getTerminalSessionTranscript,
  listTerminalSessionMetadataByTask,
  type AppDatabase,
  type TerminalSessionRecord
} from './database'
import { t } from './i18n'
import type { ProcessRunner } from './processRunner'
import type { TerminalTranscriptSnapshot } from '../shared/terminalBuffer'

type LiveTranscriptReader = Pick<ProcessRunner, 'getLiveTranscriptSnapshot'>

export function listTaskTerminalSessions(
  db: AppDatabase,
  runner: LiveTranscriptReader,
  taskId: string
): TerminalSessionRecord[] {
  return listTerminalSessionMetadataByTask(db, taskId).map((session) => {
    const snapshot = runner.getLiveTranscriptSnapshot(session.id, taskId)
    return snapshot === null
      ? session
      : {
          ...session,
          transcript: snapshot.transcript,
          transcript_cursor: snapshot.cursor
        }
  })
}

export function resolveTaskSessionTranscript(
  db: AppDatabase,
  runner: LiveTranscriptReader,
  taskId: string,
  sessionId: string
): TerminalTranscriptSnapshot {
  if (
    typeof taskId !== 'string' || !taskId ||
    typeof sessionId !== 'string' || !sessionId
  ) throw new Error(t('errors:session.invalidId'))

  return runner.getLiveTranscriptSnapshot(sessionId, taskId) ?? {
    transcript: getTerminalSessionTranscript(db, taskId, sessionId),
    cursor: null
  }
}
