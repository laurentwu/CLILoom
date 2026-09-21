import { describe, expect, it } from 'vitest'
import {
  AUTO_RETRY_DEFAULT_MAX_RETRIES,
  computeNextAutoRetryTime,
  getAutoRetryCronIssue,
  getRecommendedRetryDelayMs,
  isAutoRetryExhausted,
  parseTerminalAutoRetryConfig,
  parseTerminalAutoRetryState,
  parseWorkflowAutoRetryContext
} from './terminalAutoRetry'

describe('parseTerminalAutoRetryConfig', () => {
  it('returns undefined when the field is absent', () => {
    expect(parseTerminalAutoRetryConfig(undefined)).toBeUndefined()
    expect(parseTerminalAutoRetryConfig(null)).toBeUndefined()
  })

  it('normalizes a missing maxRetries to the default', () => {
    expect(parseTerminalAutoRetryConfig({ enabled: true, mode: 'recommended' }))
      .toEqual({ enabled: true, mode: 'recommended', maxRetries: AUTO_RETRY_DEFAULT_MAX_RETRIES })
  })

  it('parses cron mode with unlimited retries', () => {
    expect(parseTerminalAutoRetryConfig({ enabled: false, mode: 'cron', cron: '*/5 * * * *', maxRetries: null }))
      .toEqual({ enabled: false, mode: 'cron', cron: '*/5 * * * *', maxRetries: null })
  })

  it('rejects invalid shapes instead of silently disabling', () => {
    expect(() => parseTerminalAutoRetryConfig('yes')).toThrow()
    expect(() => parseTerminalAutoRetryConfig({ enabled: 'true', mode: 'recommended' })).toThrow()
    expect(() => parseTerminalAutoRetryConfig({ enabled: true, mode: 'weekly' })).toThrow()
    expect(() => parseTerminalAutoRetryConfig({ enabled: true, mode: 'recommended', maxRetries: 0 })).toThrow()
    expect(() => parseTerminalAutoRetryConfig({ enabled: true, mode: 'recommended', maxRetries: 10000 })).toThrow()
    expect(() => parseTerminalAutoRetryConfig({ enabled: true, mode: 'recommended', maxRetries: 1.5 })).toThrow()
    expect(() => parseTerminalAutoRetryConfig({ enabled: true, mode: 'cron' })).toThrow()
    expect(() => parseTerminalAutoRetryConfig({ enabled: true, mode: 'cron', cron: 5 })).toThrow()
    expect(() => parseTerminalAutoRetryConfig({ enabled: true, mode: 'cron', cron: '*\0* * * *' })).toThrow()
    expect(() => parseTerminalAutoRetryConfig({ enabled: true, mode: 'cron', cron: 'x'.repeat(513) })).toThrow()
  })
})

describe('getRecommendedRetryDelayMs', () => {
  it('follows the 1, 2, 5, 10, 30 minute ladder', () => {
    expect(getRecommendedRetryDelayMs(1)).toBe(60_000)
    expect(getRecommendedRetryDelayMs(2)).toBe(120_000)
    expect(getRecommendedRetryDelayMs(3)).toBe(300_000)
    expect(getRecommendedRetryDelayMs(4)).toBe(600_000)
    expect(getRecommendedRetryDelayMs(5)).toBe(1_800_000)
  })

  it('keeps waiting 30 minutes from the sixth attempt on', () => {
    expect(getRecommendedRetryDelayMs(6)).toBe(1_800_000)
    expect(getRecommendedRetryDelayMs(50)).toBe(1_800_000)
  })
})

describe('computeNextAutoRetryTime', () => {
  const failureAt = Date.UTC(2026, 8, 20, 10, 0, 0)

  it('adds the ladder delay to the latest failure time', () => {
    expect(computeNextAutoRetryTime({
      config: { enabled: true, mode: 'recommended', maxRetries: 10 },
      attemptsStarted: 0,
      lastFailureAt: failureAt,
      timeZone: 'UTC'
    })).toBe(failureAt + 60_000)
    expect(computeNextAutoRetryTime({
      config: { enabled: true, mode: 'recommended', maxRetries: 10 },
      attemptsStarted: 1,
      lastFailureAt: failureAt,
      timeZone: 'UTC'
    })).toBe(failureAt + 120_000)
  })

  it('uses the next cron match strictly after the failure', () => {
    const failedAt = Date.UTC(2026, 8, 20, 10, 4, 50)
    expect(computeNextAutoRetryTime({
      config: { enabled: true, mode: 'cron', cron: '*/5 * * * *', maxRetries: null },
      attemptsStarted: 3,
      lastFailureAt: failedAt,
      timeZone: 'UTC'
    })).toBe(Date.UTC(2026, 8, 20, 10, 5, 0))
  })

  it('throws for an unusable cron expression', () => {
    expect(() => computeNextAutoRetryTime({
      config: { enabled: true, mode: 'cron', cron: '0 0 31 2 *', maxRetries: null },
      attemptsStarted: 0,
      lastFailureAt: failureAt,
      timeZone: 'UTC'
    })).toThrow()
  })
})

describe('isAutoRetryExhausted', () => {
  it('compares started attempts against the limit', () => {
    expect(isAutoRetryExhausted(9, 10)).toBe(false)
    expect(isAutoRetryExhausted(10, 10)).toBe(true)
    expect(isAutoRetryExhausted(11, 10)).toBe(true)
  })

  it('never exhausts unlimited plans', () => {
    expect(isAutoRetryExhausted(100_000, null)).toBe(false)
  })
})

describe('parseTerminalAutoRetryState', () => {
  it('round-trips a waiting state', () => {
    const state = {
      version: 1,
      cycleId: 'cycle-1',
      phase: 'waiting',
      attemptsStarted: 2,
      lastFailureAt: 123,
      scheduleId: 'sched-1',
      nextRetryAt: 456
    }
    expect(parseTerminalAutoRetryState(state)).toEqual(state)
  })

  it('rejects unknown versions and malformed values', () => {
    expect(parseTerminalAutoRetryState({ version: 2, phase: 'waiting' })).toBeNull()
    expect(parseTerminalAutoRetryState('waiting')).toBeNull()
    expect(parseTerminalAutoRetryState({ version: 1, cycleId: '', phase: 'waiting', attemptsStarted: 0 })).toBeNull()
    expect(parseTerminalAutoRetryState({ version: 1, cycleId: 'c', phase: 'nonsense', attemptsStarted: 0 })).toBeNull()
    expect(parseTerminalAutoRetryState({ version: 1, cycleId: 'c', phase: 'waiting', attemptsStarted: -1 })).toBeNull()
    expect(parseTerminalAutoRetryState({
      version: 1,
      cycleId: 'c',
      phase: 'waiting',
      attemptsStarted: 0,
      scheduleId: 's',
      nextRetryAt: 1,
      reason: 'not-a-reason'
    })).toBeNull()
  })

  it('requires schedule identity while waiting', () => {
    expect(parseTerminalAutoRetryState({ version: 1, cycleId: 'c', phase: 'waiting', attemptsStarted: 0 })).toBeNull()
    expect(parseTerminalAutoRetryState({ version: 1, cycleId: 'c', phase: 'running', attemptsStarted: 1 })).toEqual({
      version: 1,
      cycleId: 'c',
      phase: 'running',
      attemptsStarted: 1
    })
  })
})

describe('parseWorkflowAutoRetryContext', () => {
  it('accepts a valid context', () => {
    expect(parseWorkflowAutoRetryContext({ runId: 'run-1', timeZone: 'Asia/Shanghai' }))
      .toEqual({ runId: 'run-1', timeZone: 'Asia/Shanghai' })
  })

  it('rejects missing identities and invalid zones', () => {
    expect(parseWorkflowAutoRetryContext({ runId: '', timeZone: 'UTC' })).toBeNull()
    expect(parseWorkflowAutoRetryContext({ runId: 'run-1', timeZone: 'Nowhere/Bogus' })).toBeNull()
    expect(parseWorkflowAutoRetryContext(null)).toBeNull()
  })
})

describe('getAutoRetryCronIssue', () => {
  it('flags enabled cron configs that cannot produce a future time', () => {
    expect(getAutoRetryCronIssue(
      { enabled: true, mode: 'cron', cron: 'garbage', maxRetries: 10 },
      Date.now()
    )).toEqual({ key: 'errors:workflowValidation.autoRetryCronInvalid' })
  })

  it('allows disabled configs to keep an unfinished draft', () => {
    expect(getAutoRetryCronIssue(
      { enabled: false, mode: 'cron', cron: 'not done yet', maxRetries: 10 },
      Date.now()
    )).toBeNull()
  })

  it('still enforces structural limits on disabled drafts', () => {
    expect(getAutoRetryCronIssue(
      { enabled: false, mode: 'cron', cron: '*\0* * * *', maxRetries: 10 },
      Date.now()
    )).toEqual({ key: 'errors:workflowValidation.autoRetryCronInvalid' })
  })

  it('ignores recommended mode', () => {
    expect(getAutoRetryCronIssue(
      { enabled: true, mode: 'recommended', maxRetries: 10 },
      Date.now()
    )).toBeNull()
  })
})
