import { normalizeCronExpression } from '../../shared/cronSchedule'

export type CronAssistantMode = 'every-n-minutes' | 'hourly' | 'daily' | 'weekly'

export const EVERY_N_MINUTES_CHOICES = [1, 2, 3, 5, 10, 15, 20, 30] as const

export type CronAssistantDraft = {
  mode: CronAssistantMode
  intervalMinutes: number
  minuteOfHour: number
  timeMinute: number
  timeHour: number
  weekdays: number[]
}

export const DEFAULT_CRON_ASSISTANT_DRAFT: CronAssistantDraft = {
  mode: 'every-n-minutes',
  intervalMinutes: 5,
  minuteOfHour: 0,
  timeMinute: 0,
  timeHour: 9,
  weekdays: [1]
}

/** Build the five-field expression for an assistant draft. */
export function buildCronExpression(draft: CronAssistantDraft): string {
  switch (draft.mode) {
    case 'every-n-minutes':
      return `*/${draft.intervalMinutes} * * * *`
    case 'hourly':
      return `${draft.minuteOfHour} * * * *`
    case 'daily':
      return `${draft.timeMinute} ${draft.timeHour} * * *`
    case 'weekly': {
      const days = [...draft.weekdays].sort((left, right) => left - right).join(',')
      return `${draft.timeMinute} ${draft.timeHour} * * ${days}`
    }
  }
}

/**
 * Reverse-fill an assistant draft from an existing expression. Returns null
 * for empty, invalid, or legitimately complex expressions; the caller then
 * starts from defaults without touching the original input.
 */
export function matchAssistantExpression(expression: string): CronAssistantDraft | null {
  const normalized = normalizeCronExpression(expression)
  if (!normalized) return null
  const fields = normalized.split(' ')
  if (fields.length !== 5) return null
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields
  if (dayOfMonth !== '*' || month !== '*') return null

  const minuteValue = parseSingleNumber(minute, 0, 59)
  const hourValue = parseSingleNumber(hour, 0, 23)

  const stepMatch = /^\*\/(\d+)$/.exec(minute)
  if (stepMatch) {
    const interval = Number(stepMatch[1])
    if (hour !== '*') return null
    if (!(EVERY_N_MINUTES_CHOICES as readonly number[]).includes(interval)) return null
    return { ...DEFAULT_CRON_ASSISTANT_DRAFT, mode: 'every-n-minutes', intervalMinutes: interval }
  }
  if (minuteValue === null) return null

  if (dayOfWeek !== '*') {
    if (hourValue === null) return null
    const dayList = dayOfWeek.split(',')
    if (dayList.length === 0 || dayList.some((day) => parseSingleNumber(day, 0, 7) === null)) return null
    const weekdays = dayList
      .map((day) => (Number(day) === 7 ? 0 : Number(day)))
      .sort((left, right) => left - right)
    if (weekdays.length !== new Set(weekdays).size) return null
    return {
      ...DEFAULT_CRON_ASSISTANT_DRAFT,
      mode: 'weekly',
      timeMinute: minuteValue,
      timeHour: hourValue,
      weekdays
    }
  }

  if (hour !== '*') {
    if (hourValue === null) return null
    return {
      ...DEFAULT_CRON_ASSISTANT_DRAFT,
      mode: 'daily',
      timeMinute: minuteValue,
      timeHour: hourValue
    }
  }

  return { ...DEFAULT_CRON_ASSISTANT_DRAFT, mode: 'hourly', minuteOfHour: minuteValue }
}

function parseSingleNumber(field: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(field)) return null
  const value = Number(field)
  if (value < min || value > max) return null
  return value
}

/**
 * Render an epoch-millisecond time in the given zone. Includes the UTC offset
 * unless `showTimeZone` is explicitly false, in which case the formatting
 * options omit `timeZoneName` entirely instead of stripping rendered text.
 */
export function formatScheduleTime(
  timeMs: number,
  timeZone: string,
  locale: string,
  options?: { showTimeZone?: boolean }
): string {
  const dateOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(options?.showTimeZone === false ? {} : { timeZoneName: 'shortOffset' })
  }
  const attempt = (formatOptions: Intl.DateTimeFormatOptions): string => (
    new Intl.DateTimeFormat(locale, formatOptions).format(new Date(timeMs))
  )
  try {
    return attempt({ timeZone, ...dateOptions })
  } catch {
    try {
      return attempt({ timeZone, ...dateOptions, timeZoneName: undefined })
    } catch {
      return attempt({ ...dateOptions, timeZoneName: undefined })
    }
  }
}

/** Countdown text like "00:42" or "1:02:03"; minimum value is zero. */
export function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const paddedMinutes = String(minutes).padStart(2, '0')
  const paddedSeconds = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${paddedMinutes}:${paddedSeconds}` : `${paddedMinutes}:${paddedSeconds}`
}
