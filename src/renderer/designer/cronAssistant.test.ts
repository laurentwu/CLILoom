// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  buildCronExpression,
  formatCountdown,
  formatScheduleTime,
  matchAssistantExpression,
  type CronAssistantDraft
} from './cronAssistant'

describe('buildCronExpression', () => {
  it('builds each of the four preset modes', () => {
    const base: CronAssistantDraft = {
      mode: 'every-n-minutes',
      intervalMinutes: 15,
      minuteOfHour: 5,
      timeMinute: 30,
      timeHour: 14,
      weekdays: [2, 0]
    }
    expect(buildCronExpression({ ...base, mode: 'every-n-minutes' })).toBe('*/15 * * * *')
    expect(buildCronExpression({ ...base, mode: 'hourly' })).toBe('5 * * * *')
    expect(buildCronExpression({ ...base, mode: 'daily' })).toBe('30 14 * * *')
    expect(buildCronExpression({ ...base, mode: 'weekly' })).toBe('30 14 * * 0,2')
  })
})

describe('matchAssistantExpression', () => {
  it('recognizes each preset form', () => {
    expect(matchAssistantExpression('*/30 * * * *')).toMatchObject({
      mode: 'every-n-minutes',
      intervalMinutes: 30
    })
    expect(matchAssistantExpression('7 * * * *')).toMatchObject({
      mode: 'hourly',
      minuteOfHour: 7
    })
    expect(matchAssistantExpression('30 14 * * *')).toMatchObject({
      mode: 'daily',
      timeMinute: 30,
      timeHour: 14
    })
    expect(matchAssistantExpression('30 14 * * 1,3,5')).toMatchObject({
      mode: 'weekly',
      timeMinute: 30,
      timeHour: 14,
      weekdays: [1, 3, 5]
    })
    expect(matchAssistantExpression('30 14 * * 7')).toMatchObject({
      mode: 'weekly',
      weekdays: [0]
    })
  })

  it('round-trips expressions built by the assistant', () => {
    const drafts: CronAssistantDraft[] = [
      { mode: 'every-n-minutes', intervalMinutes: 5, minuteOfHour: 0, timeMinute: 0, timeHour: 9, weekdays: [1] },
      { mode: 'hourly', intervalMinutes: 5, minuteOfHour: 59, timeMinute: 0, timeHour: 9, weekdays: [1] },
      { mode: 'daily', intervalMinutes: 5, minuteOfHour: 0, timeMinute: 0, timeHour: 0, weekdays: [1] },
      { mode: 'weekly', intervalMinutes: 5, minuteOfHour: 0, timeMinute: 45, timeHour: 23, weekdays: [0, 6] }
    ]
    for (const draft of drafts) {
      expect(matchAssistantExpression(buildCronExpression(draft))).toEqual(draft)
    }
  })

  it('returns null for empty, invalid and complex expressions', () => {
    expect(matchAssistantExpression('')).toBeNull()
    expect(matchAssistantExpression('   ')).toBeNull()
    expect(matchAssistantExpression('garbage')).toBeNull()
    expect(matchAssistantExpression('*/7 * * * *')).toBeNull()
    expect(matchAssistantExpression('5,10 * * * *')).toBeNull()
    expect(matchAssistantExpression('0 12 * * 1-5')).toBeNull()
    expect(matchAssistantExpression('0 12 1 * *')).toBeNull()
    expect(matchAssistantExpression('0 12 1 1 *')).toBeNull()
  })
})

describe('formatCountdown', () => {
  it('formats zero-padded segments with a zero floor', () => {
    expect(formatCountdown(-5_000)).toBe('00:00')
    expect(formatCountdown(0)).toBe('00:00')
    expect(formatCountdown(42_000)).toBe('00:42')
    expect(formatCountdown(3_723_000)).toBe('1:02:03')
  })
})

describe('formatScheduleTime', () => {
  it('renders the date, time and UTC offset in the given zone', () => {
    const text = formatScheduleTime(Date.UTC(2026, 8, 20, 6, 30, 0), 'Asia/Shanghai', 'en-US')
    expect(text).toContain('2026')
    expect(text).toContain('14:30')
    expect(text).toContain('GMT+8')
  })

  it('falls back when the zone is unusable', () => {
    expect(() => formatScheduleTime(Date.UTC(2026, 8, 20, 6, 30, 0), 'Not/AZone', 'en-US')).not.toThrow()
  })
})
