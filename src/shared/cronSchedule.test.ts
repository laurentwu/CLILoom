import { describe, expect, it } from 'vitest'
import {
  checkCronSyntax,
  getCronPreview,
  getNextCronTime,
  getSystemTimeZone,
  isValidTimeZone,
  normalizeCronExpression,
  validateRetryCron
} from './cronSchedule'

const UTC = 'UTC'

describe('normalizeCronExpression', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeCronExpression('  */5   *  * * * ')).toBe('*/5 * * * *')
  })

  it('rejects empty, NUL and overlong values', () => {
    expect(normalizeCronExpression('')).toBeNull()
    expect(normalizeCronExpression('   ')).toBeNull()
    expect(normalizeCronExpression('* * * * *\0')).toBeNull()
    expect(normalizeCronExpression(`${'a'.repeat(513)}`)).toBeNull()
  })
})

describe('checkCronSyntax', () => {
  it('accepts the supported dialect', () => {
    expect(checkCronSyntax('*/5 * * * *')).toBeNull()
    expect(checkCronSyntax('0 9 1 1 0')).toBeNull()
    expect(checkCronSyntax('0-30/5 8-18 * * 1-5')).toBeNull()
    expect(checkCronSyntax('1,2,3 0 1,15 1,2 0,7')).toBeNull()
    expect(checkCronSyntax('59 23 31 12 7')).toBeNull()
  })

  it('rejects six fields, macros and named aliases', () => {
    expect(checkCronSyntax('* * * * * *')).not.toBeNull()
    expect(checkCronSyntax('@daily')).not.toBeNull()
    expect(checkCronSyntax('* * * * MON')).not.toBeNull()
    expect(checkCronSyntax('* * * * ?')).not.toBeNull()
    expect(checkCronSyntax('L * * * *')).not.toBeNull()
    expect(checkCronSyntax('* * * * 1#2')).not.toBeNull()
    expect(checkCronSyntax('* * * * H')).not.toBeNull()
  })

  it('rejects out-of-range values and zero steps', () => {
    expect(checkCronSyntax('60 * * * *')).not.toBeNull()
    expect(checkCronSyntax('* 24 * * *')).not.toBeNull()
    expect(checkCronSyntax('* * 0 * *')).not.toBeNull()
    expect(checkCronSyntax('* * 32 * *')).not.toBeNull()
    expect(checkCronSyntax('* * * 0 *')).not.toBeNull()
    expect(checkCronSyntax('* * * 13 *')).not.toBeNull()
    expect(checkCronSyntax('* * * * 8')).not.toBeNull()
    expect(checkCronSyntax('*/0 * * * *')).not.toBeNull()
    expect(checkCronSyntax('5-1 * * * *')).not.toBeNull()
  })

  it('accepts weekday 0 and 7 as Sunday', () => {
    expect(checkCronSyntax('0 0 * * 0')).toBeNull()
    expect(checkCronSyntax('0 0 * * 7')).toBeNull()
  })
})

describe('validateRetryCron', () => {
  it('validates and normalizes a working expression', () => {
    const result = validateRetryCron(' */5   *  * * * ', UTC, Date.UTC(2026, 8, 20, 10, 0, 0))
    expect(result.valid).toBe(true)
    expect(result.expression).toBe('*/5 * * * *')
  })

  it('reports an issue for invalid syntax', () => {
    const result = validateRetryCron('not a cron', UTC, 0)
    expect(result.valid).toBe(false)
    expect(result.issue?.key).toBeDefined()
  })

  it('reports an issue when no future date is reachable', () => {
    const result = validateRetryCron('0 0 31 2 *', UTC, 0)
    expect(result.valid).toBe(false)
    expect(result.issue?.key).toBe('errors:cronSchedule.noFutureDate')
  })
})

describe('getNextCronTime', () => {
  it('returns the next match strictly after the reference time', () => {
    expect(getNextCronTime('*/5 * * * *', UTC, Date.UTC(2026, 8, 20, 10, 4, 50)))
      .toBe(Date.UTC(2026, 8, 20, 10, 5, 0))
    expect(getNextCronTime('*/5 * * * *', UTC, Date.UTC(2026, 8, 20, 10, 5, 0)))
      .toBe(Date.UTC(2026, 8, 20, 10, 10, 0))
  })

  it('honours the Asia/Shanghai time zone', () => {
    // 02:30 UTC == 10:30 in Asia/Shanghai (UTC+8, no DST).
    expect(getNextCronTime('30 14 * * *', 'Asia/Shanghai', Date.UTC(2026, 8, 20, 2, 0, 0)))
      .toBe(Date.UTC(2026, 8, 20, 6, 30, 0))
  })

  it('handles month and day rollovers', () => {
    expect(getNextCronTime('0 0 1 * *', UTC, Date.UTC(2026, 11, 31, 12, 0, 0)))
      .toBe(Date.UTC(2027, 0, 1, 0, 0, 0))
  })

  it('handles leap-day schedules', () => {
    expect(getNextCronTime('0 0 29 2 *', UTC, Date.UTC(2026, 0, 1, 0, 0, 0)))
      .toBe(Date.UTC(2028, 1, 29, 0, 0, 0))
  })

  it('uses either-match semantics for restricted day-of-month and day-of-week', () => {
    // `0 0 13 * 5` fires on the 13th of each month and every Friday.
    const after = Date.UTC(2026, 8, 20, 0, 0, 0)
    expect(getNextCronTime('0 0 13 * 5', UTC, after))
      .toBe(Date.UTC(2026, 8, 25, 0, 0, 0))
  })

  it('resolves Europe/London DST transitions like the locked parser', () => {
    // British Summer Time ends on 2026-10-25: 01:00 BST becomes 01:00 GMT.
    // The locked parser fires at 01:30 BST and then skips the ambiguous
    // repeated 01:30 GMT wall time, landing on the next unambiguous day.
    const first = getNextCronTime('30 1 * * *', 'Europe/London', Date.UTC(2026, 9, 24, 12, 0, 0))
    const second = getNextCronTime('30 1 * * *', 'Europe/London', first)
    expect(first).toBe(Date.UTC(2026, 9, 25, 0, 30, 0))
    expect(second).toBe(Date.UTC(2026, 9, 26, 1, 30, 0))
  })

  it('resolves the Europe/London DST start with the locked parser semantics', () => {
    // BST starts 2026-03-29: local 01:30 does not exist. The locked parser
    // resolves it to the corresponding instant after the jump.
    const first = getNextCronTime('30 1 * * *', 'Europe/London', Date.UTC(2026, 2, 29, 0, 31, 0))
    const second = getNextCronTime('30 1 * * *', 'Europe/London', first)
    expect(first).toBe(Date.UTC(2026, 2, 29, 1, 30, 0))
    expect(second).toBe(Date.UTC(2026, 2, 30, 0, 30, 0))
  })
})

describe('getCronPreview', () => {
  it('returns five strictly increasing times matching direct scheduling', () => {
    const after = Date.UTC(2026, 8, 20, 10, 4, 50)
    const preview = getCronPreview('*/5 * * * *', UTC, after)
    expect(preview).toHaveLength(5)
    for (let index = 1; index < preview.length; index += 1) {
      expect(preview[index]).toBeGreaterThan(preview[index - 1])
    }
    expect(preview[0]).toBe(getNextCronTime('*/5 * * * *', UTC, after))
  })
})

describe('time zone helpers', () => {
  it('reports a valid system time zone', () => {
    expect(isValidTimeZone(getSystemTimeZone())).toBe(true)
  })

  it('rejects invalid zone identifiers', () => {
    expect(isValidTimeZone('Not/AZone')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })
})
