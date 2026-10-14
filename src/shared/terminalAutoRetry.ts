import { AppError } from './appError'
import type { TranslationIssue } from './i18n/translator'
import { getNextCronTime, isValidTimeZone } from './cronSchedule'

export const AUTO_RETRY_DEFAULT_MAX_RETRIES = 10
export const AUTO_RETRY_MIN_MAX_RETRIES = 1
export const AUTO_RETRY_MAX_MAX_RETRIES = 9999
export const AUTO_RETRY_CRON_MAX_LENGTH = 512

export const RECOMMENDED_RETRY_DELAYS_MINUTES = [1, 2, 5, 10, 30] as const

export type TerminalAutoRetryConfig = {
  enabled: boolean
  maxRetries: number | null
} & (
  | { mode: 'recommended' }
  | { mode: 'cron'; cron: string }
)

export type WorkflowAutoRetryContext = {
  runId: string
  timeZone: string
}

export type TerminalAutoRetryPhase =
  | 'waiting'
  | 'running'
  | 'succeeded'
  | 'exhausted'
  | 'cancelled'
  | 'blocked'

export type TerminalAutoRetryReason =
  | 'hook-failed'
  | 'interrupted'
  | 'missing-session'
  | 'missing-workflow'
  | 'invalid-state'
  | 'schedule-error'
  | 'user-cancelled'
  | 'task-stopped'

export type TerminalAutoRetryState = {
  version: 1
  cycleId: string
  phase: TerminalAutoRetryPhase
  attemptsStarted: number
  lastFailureAt?: number
  lastRetryStartedAt?: number
  scheduleId?: string
  nextRetryAt?: number
  reason?: TerminalAutoRetryReason
}

const AUTO_RETRY_MAX_EPOCH_MS = 8_640_000_000_000_000

export function parseLastRetryStartedAt(
  value: unknown,
  attemptsStarted: number
): number | undefined {
  if (attemptsStarted <= 0) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return undefined
  if (value < 0 || value > AUTO_RETRY_MAX_EPOCH_MS) return undefined
  return value
}

export type AutoRetryClock = {
  now: () => number
  createScheduleId: () => string
  createCycleId: () => string
}

export function createAutoRetryId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID()
  return `ar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function parseTerminalAutoRetryConfig(
  value: unknown
): TerminalAutoRetryConfig | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw autoRetryConfigError('errors:workflowValidation.autoRetryInvalid')
  }
  const raw = value as Record<string, unknown>
  if (typeof raw.enabled !== 'boolean') {
    throw autoRetryConfigError('errors:workflowValidation.autoRetryInvalid')
  }
  if (raw.mode !== 'recommended' && raw.mode !== 'cron') {
    throw autoRetryConfigError('errors:workflowValidation.autoRetryModeInvalid')
  }
  const maxRetries = parseMaxRetries(raw.maxRetries)
  if (raw.mode === 'recommended') {
    return { enabled: raw.enabled, mode: 'recommended', maxRetries }
  }
  if (typeof raw.cron !== 'string' || raw.cron.includes('\0') || raw.cron.length > AUTO_RETRY_CRON_MAX_LENGTH) {
    throw autoRetryConfigError('errors:workflowValidation.autoRetryCronInvalid')
  }
  return { enabled: raw.enabled, mode: 'cron', cron: raw.cron, maxRetries }
}

function parseMaxRetries(value: unknown): number | null {
  if (value === undefined) return AUTO_RETRY_DEFAULT_MAX_RETRIES
  if (value === null) return null
  if (typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < AUTO_RETRY_MIN_MAX_RETRIES ||
    value > AUTO_RETRY_MAX_MAX_RETRIES
  ) {
    throw autoRetryConfigError('errors:workflowValidation.autoRetryMaxRetriesInvalid')
  }
  return value
}

function autoRetryConfigError(i18nKey: TranslationIssue['key'], params?: Record<string, unknown>): AppError {
  return new AppError({
    code: 'WORKFLOW_INVALID',
    message: 'Invalid terminal auto-retry configuration',
    i18nKey,
    params
  })
}

export function getRecommendedRetryDelayMs(nextAttempt: number): number {
  const index = Math.min(Math.max(nextAttempt, 1) - 1, RECOMMENDED_RETRY_DELAYS_MINUTES.length - 1)
  return RECOMMENDED_RETRY_DELAYS_MINUTES[index] * 60_000
}

export function isAutoRetryExhausted(attemptsStarted: number, maxRetries: number | null): boolean {
  if (maxRetries === null) return false
  return attemptsStarted >= maxRetries
}

export function computeNextAutoRetryTime(args: {
  config: TerminalAutoRetryConfig
  attemptsStarted: number
  lastFailureAt: number
  timeZone: string
}): number {
  if (args.config.mode === 'recommended') {
    return args.lastFailureAt + getRecommendedRetryDelayMs(args.attemptsStarted + 1)
  }
  return getNextCronTime(args.config.cron, args.timeZone, args.lastFailureAt)
}

const AUTO_RETRY_PHASES: readonly TerminalAutoRetryPhase[] = [
  'waiting',
  'running',
  'succeeded',
  'exhausted',
  'cancelled',
  'blocked'
]

const AUTO_RETRY_REASONS: readonly TerminalAutoRetryReason[] = [
  'hook-failed',
  'interrupted',
  'missing-session',
  'missing-workflow',
  'invalid-state',
  'schedule-error',
  'user-cancelled',
  'task-stopped'
]

export function parseTerminalAutoRetryState(value: unknown): TerminalAutoRetryState | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.version !== 1) return null
  if (typeof raw.cycleId !== 'string' || !raw.cycleId || raw.cycleId.length > 512 || raw.cycleId.includes('\0')) return null
  if (typeof raw.phase !== 'string' || !AUTO_RETRY_PHASES.includes(raw.phase as TerminalAutoRetryPhase)) return null
  if (typeof raw.attemptsStarted !== 'number' || !Number.isInteger(raw.attemptsStarted) || raw.attemptsStarted < 0) return null

  const state: TerminalAutoRetryState = {
    version: 1,
    cycleId: raw.cycleId,
    phase: raw.phase as TerminalAutoRetryPhase,
    attemptsStarted: raw.attemptsStarted
  }
  if (typeof raw.lastFailureAt === 'number' && Number.isFinite(raw.lastFailureAt)) {
    state.lastFailureAt = raw.lastFailureAt
  }
  const lastRetryStartedAt = parseLastRetryStartedAt(raw.lastRetryStartedAt, state.attemptsStarted)
  if (lastRetryStartedAt !== undefined) {
    state.lastRetryStartedAt = lastRetryStartedAt
  }
  if (raw.reason !== undefined) {
    if (typeof raw.reason !== 'string' || !AUTO_RETRY_REASONS.includes(raw.reason as TerminalAutoRetryReason)) {
      return null
    }
    state.reason = raw.reason as TerminalAutoRetryReason
  }
  if (state.phase === 'waiting') {
    if (typeof raw.scheduleId !== 'string' || !raw.scheduleId || raw.scheduleId.length > 512 || raw.scheduleId.includes('\0')) return null
    if (typeof raw.nextRetryAt !== 'number' || !Number.isFinite(raw.nextRetryAt)) return null
    state.scheduleId = raw.scheduleId
    state.nextRetryAt = raw.nextRetryAt
  }
  return state
}

export function parseWorkflowAutoRetryContext(value: unknown): WorkflowAutoRetryContext | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.runId !== 'string' || !raw.runId || raw.runId.length > 512 || raw.runId.includes('\0')) return null
  if (typeof raw.timeZone !== 'string' || !isValidTimeZone(raw.timeZone)) return null
  return { runId: raw.runId, timeZone: raw.timeZone }
}

export function getAutoRetryCronIssue(
  config: TerminalAutoRetryConfig,
  nowMs: number
): TranslationIssue | null {
  if (config.mode !== 'cron') return null
  if (config.cron.includes('\0') || config.cron.length > AUTO_RETRY_CRON_MAX_LENGTH) {
    return { key: 'errors:workflowValidation.autoRetryCronInvalid' }
  }
  if (!config.enabled) return null
  try {
    getNextCronTime(config.cron, 'UTC', nowMs)
    return null
  } catch {
    return { key: 'errors:workflowValidation.autoRetryCronInvalid' }
  }
}
