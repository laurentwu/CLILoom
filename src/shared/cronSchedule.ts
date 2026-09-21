import { CronExpressionParser } from 'cron-parser'
import { AppError } from './appError'
import type { TranslationIssue } from './i18n/translator'

export const CRON_EXPRESSION_MAX_LENGTH = 512
export const CRON_FIELD_COUNT = 5

const FIELD_RANGES: ReadonlyArray<{ min: number; max: number }> = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 7 }
]

export type CronValidationResult = {
  valid: boolean
  expression?: string
  issue?: TranslationIssue
}

/**
 * Normalize raw user input into the canonical five-field form: trimmed, with
 * runs of whitespace collapsed to single spaces. Returns null when the value
 * cannot possibly be a five-field expression.
 */
export function normalizeCronExpression(value: string): string | null {
  if (typeof value !== 'string') return null
  if (value.includes('\0')) return null
  if (value.length > CRON_EXPRESSION_MAX_LENGTH) return null
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (!normalized) return null
  return normalized
}

/**
 * Structural check for the supported dialect: five fields (minute hour
 * day-of-month month day-of-week) containing only digits, `*`, `,`, `-` and
 * `/` with valid ranges. Macros, seconds, names and Quartz extensions are
 * rejected before the parser is invoked.
 */
export function checkCronSyntax(normalized: string): TranslationIssue | null {
  const fields = normalized.split(' ')
  if (fields.length !== CRON_FIELD_COUNT) {
    return { key: 'errors:cronSchedule.fieldCount', params: { count: String(CRON_FIELD_COUNT) } }
  }
  for (let index = 0; index < fields.length; index += 1) {
    const issue = checkCronField(fields[index], index)
    if (issue) return issue
  }
  return null
}

function checkCronField(field: string, fieldIndex: number): TranslationIssue | null {
  const label = cronFieldLabelKey(fieldIndex)
  if (!/^[0-9*]+(?:[,\-/][0-9*]+)*$/.test(field)) {
    return { key: 'errors:cronSchedule.fieldSyntax', params: { field: label } }
  }
  const range = FIELD_RANGES[fieldIndex]
  for (const part of field.split(',')) {
    const stepSplit = part.split('/')
    if (stepSplit.length > 2) {
      return { key: 'errors:cronSchedule.fieldSyntax', params: { field: label } }
    }
    const step = stepSplit.length === 2 ? Number(stepSplit[1]) : null
    if (step !== null && (!Number.isInteger(step) || step < 1)) {
      return { key: 'errors:cronSchedule.stepInvalid', params: { field: label } }
    }
    const bounds = stepSplit[0]
    const rangeSplit = bounds.split('-')
    if (rangeSplit.length > 2) {
      return { key: 'errors:cronSchedule.fieldSyntax', params: { field: label } }
    }
    if (rangeSplit.some((bound) => bound === '' || bound === '*')) {
      if (rangeSplit.some((bound) => bound !== '*' && bound !== '')) {
        return { key: 'errors:cronSchedule.fieldSyntax', params: { field: label } }
      }
      continue
    }
    const low = Number(rangeSplit[0])
    const high = rangeSplit.length === 2 ? Number(rangeSplit[1]) : low
    if (!Number.isInteger(low) || !Number.isInteger(high)) {
      return { key: 'errors:cronSchedule.fieldSyntax', params: { field: label } }
    }
    if (low > high) {
      return { key: 'errors:cronSchedule.rangeInvalid', params: { field: label } }
    }
    if (low < range.min || high > range.max) {
      return { key: 'errors:cronSchedule.rangeOutOfBounds', params: { field: label, min: String(range.min), max: String(range.max) } }
    }
  }
  return null
}

function cronFieldLabelKey(fieldIndex: number): string {
  switch (fieldIndex) {
    case 0: return 'minute'
    case 1: return 'hour'
    case 2: return 'dayOfMonth'
    case 3: return 'month'
    default: return 'dayOfWeek'
  }
}

/**
 * Validate a cron expression for the terminal auto-retry feature. The check
 * verifies the five-field syntax, then confirms that at least one future
 * trigger exists after `afterMs` in the given IANA time zone.
 */
export function validateRetryCron(
  expression: string,
  timeZone: string,
  afterMs: number
): CronValidationResult {
  const normalized = normalizeCronExpression(expression)
  if (!normalized) {
    return { valid: false, issue: { key: 'errors:cronSchedule.empty' } }
  }
  const syntaxIssue = checkCronSyntax(normalized)
  if (syntaxIssue) return { valid: false, issue: syntaxIssue }
  try {
    const iterator = createCronIterator(normalized, timeZone, afterMs)
    iterator.next()
  } catch (error) {
    if (isNoFutureDateError(error)) {
      return { valid: false, issue: { key: 'errors:cronSchedule.noFutureDate' } }
    }
    return { valid: false, issue: { key: 'errors:cronSchedule.invalid' } }
  }
  return { valid: true, expression: normalized }
}

function isNoFutureDateError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('message' in error)) return false
  const message = String((error as { message?: unknown }).message)
  return message.includes('will never be reached') ||
    message.includes('Invalid explicit day of month definition')
}

/**
 * Compute the next cron trigger strictly after `afterMs`, in epoch
 * milliseconds. Throws when the expression is invalid or has no future date.
 */
export function getNextCronTime(expression: string, timeZone: string, afterMs: number): number {
  const normalized = normalizeCronExpression(expression)
  if (!normalized) throw cronSyntaxError()
  const syntaxIssue = checkCronSyntax(normalized)
  if (syntaxIssue) throw cronSyntaxError()
  const iterator = createCronIterator(normalized, timeZone, afterMs)
  return iterator.next().toDate().getTime()
}

/** Compute the next `count` strictly increasing trigger times after `afterMs`. */
export function getCronPreview(
  expression: string,
  timeZone: string,
  afterMs: number,
  count = 5
): number[] {
  const normalized = normalizeCronExpression(expression)
  if (!normalized) throw cronSyntaxError()
  const syntaxIssue = checkCronSyntax(normalized)
  if (syntaxIssue) throw cronSyntaxError()
  const iterator = createCronIterator(normalized, timeZone, afterMs)
  const times: number[] = []
  for (let index = 0; index < count; index += 1) {
    times.push(iterator.next().toDate().getTime())
  }
  return times
}

function createCronIterator(
  normalized: string,
  timeZone: string,
  afterMs: number
): ReturnType<typeof CronExpressionParser.parse> {
  return CronExpressionParser.parse(normalized, {
    currentDate: new Date(afterMs),
    tz: timeZone
  })
}

function cronSyntaxError(): Error {
  return new AppError({
    code: 'WORKFLOW_INVALID',
    message: 'Invalid cron expression',
    i18nKey: 'errors:cronSchedule.invalid'
  })
}

/**
 * Resolve the host system IANA time zone. Falls back to UTC when the runtime
 * cannot report a usable identifier.
 */
export function getSystemTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (zone && typeof zone === 'string' && isValidTimeZone(zone)) return zone
  } catch {
    // Fall through to UTC.
  }
  return 'UTC'
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== 'string' || timeZone.length > 128) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone })
    return true
  } catch {
    return false
  }
}
