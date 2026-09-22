// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../i18n'
import { TerminalAutoRetryBanner } from './TerminalAutoRetryBanner'
import type { TerminalAutoRetryState } from '../../shared/terminalAutoRetry'

// Fixed display clock: 2026-09-21T21:30:00.000Z renders as 14:30 in
// America/Los_Angeles and as 05:30 on the next calendar day in Asia/Shanghai.
const fixedNow = Date.UTC(2026, 8, 21, 21, 30, 0)
const firstStartAt = Date.UTC(2026, 8, 21, 20, 0, 0)
const secondStartAt = Date.UTC(2026, 8, 21, 21, 4, 0)

function bannerText(): string {
  return document.body.textContent ?? ''
}

function bannerRoot() {
  return document.querySelector('[data-auto-retry-phase]')
}

function expectNoTimeZoneText(): void {
  expect(bannerText()).not.toMatch(/GMT|UTC|Los_Angeles|Shanghai/i)
}

type BannerAutoRetryOverrides = Partial<Omit<TerminalAutoRetryState, 'phase'>> &
  Pick<TerminalAutoRetryState, 'phase'>

function baseAutoRetry(overrides: BannerAutoRetryOverrides): TerminalAutoRetryState {
  return {
    version: 1,
    cycleId: 'cycle-1',
    attemptsStarted: 1,
    ...overrides
  }
}

function renderBanner(options: {
  autoRetry: BannerAutoRetryOverrides
  timeZone?: string
  maxRetries?: number | null
  onCancel?: (autoRetry: TerminalAutoRetryState) => void
}) {
  const onRetryNow = vi.fn()
  const onCancel = options.onCancel ?? vi.fn()
  const autoRetry = baseAutoRetry(options.autoRetry)
  const view = render(
    <I18nextProvider i18n={i18n}>
      <TerminalAutoRetryBanner
        autoRetry={autoRetry}
        timeZone={options.timeZone}
        maxRetries={options.maxRetries}
        onRetryNow={onRetryNow}
        onCancel={onCancel}
      />
    </I18nextProvider>
  )
  return { onRetryNow, onCancel, autoRetry, view }
}

beforeEach(() => {
  vi.useFakeTimers({ now: fixedNow })
  void i18n.changeLanguage('en')
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    locale: 'en-US'
  } as Intl.ResolvedDateTimeFormatOptions)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  cleanup()
})

describe('TerminalAutoRetryBanner', () => {
  it('shows the next attempt, count and a countdown without a timezone', () => {
    renderBanner({
      autoRetry: { phase: 'waiting', attemptsStarted: 1, scheduleId: 'sched-1', nextRetryAt: fixedNow + 42_000 },
      maxRetries: 10,
      timeZone: 'America/Los_Angeles'
    })
    expect(screen.getByText(/Automatic retry #2 will run at/)).toBeTruthy()
    expect(screen.getByText(/1 \/ 10 automatic retries used/)).toBeTruthy()
    expect(screen.getByText(/42 left$/)).toBeTruthy()
    expectNoTimeZoneText()
  })

  it('shows the unlimited variant without a countdown cap', () => {
    renderBanner({
      autoRetry: { phase: 'waiting', attemptsStarted: 3, scheduleId: 'sched-1', nextRetryAt: fixedNow + 42_000 },
      maxRetries: null
    })
    expect(screen.getByText(/unlimited/)).toBeTruthy()
    expect(screen.getByText(/3 automatic retries used/)).toBeTruthy()
    expectNoTimeZoneText()
  })

  it('shows the attempts and countdown while the cap is unknown', () => {
    renderBanner({
      autoRetry: { phase: 'waiting', attemptsStarted: 2, scheduleId: 'sched-1', nextRetryAt: fixedNow + 42_000 }
    })
    expect(screen.getByText(/2 automatic retries used · 00:42/)).toBeTruthy()
    expectNoTimeZoneText()
  })

  it('offers retry now and cancel only while waiting', () => {
    const first = renderBanner({
      autoRetry: { phase: 'waiting', scheduleId: 'sched-1', nextRetryAt: fixedNow + 42_000 }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }))
    expect(first.onRetryNow).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel automatic retry' }))
    expect(first.onCancel).toHaveBeenCalledTimes(1)

    cleanup()
    const second = renderBanner({ autoRetry: { phase: 'exhausted', attemptsStarted: 10 } })
    expect(screen.queryByRole('button', { name: 'Retry now' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel automatic retry' })).toBeNull()
    expect(second.onRetryNow).not.toHaveBeenCalled()
  })

  it('describes exhausted, cancelled and blocked outcomes', () => {
    renderBanner({ autoRetry: { phase: 'exhausted', attemptsStarted: 10 } })
    expect(screen.getAllByText('Automatic retries exhausted (10). Manual retry starts a new count.').length).toBeGreaterThan(0)

    cleanup()
    renderBanner({ autoRetry: { phase: 'cancelled', attemptsStarted: 1, reason: 'user-cancelled' } })
    expect(screen.getAllByText('Automatic retry cancelled').length).toBeGreaterThan(0)

    cleanup()
    renderBanner({ autoRetry: { phase: 'blocked', attemptsStarted: 1, reason: 'hook-failed' } })
    expect(screen.getByText('A hook failed, so this cycle can no longer retry automatically.')).toBeTruthy()

    cleanup()
    renderBanner({ autoRetry: { phase: 'blocked', attemptsStarted: 1, reason: 'task-stopped' } })
    expect(screen.getByText('The task was stopped, so automatic retries were cancelled.')).toBeTruthy()
  })

  it('reports an automatic attempt in progress', () => {
    renderBanner({ autoRetry: { phase: 'running', attemptsStarted: 2 } })
    expect(screen.getByText('Automatic retry #2 in progress')).toBeTruthy()
  })
})

describe('TerminalAutoRetryBanner last retry start time', () => {
  const startedScenarios: Array<{
    name: string
    autoRetry: Partial<TerminalAutoRetryState> & Pick<TerminalAutoRetryState, 'phase'>
    maxRetries?: number | null
    expectedDetail: RegExp
  }> = [
    {
      name: 'running',
      autoRetry: { phase: 'running', attemptsStarted: 1, lastRetryStartedAt: firstStartAt },
      expectedDetail: /1 automatic retries used/
    },
    {
      name: 'waiting with a limited cap',
      autoRetry: {
        phase: 'waiting',
        attemptsStarted: 1,
        lastRetryStartedAt: firstStartAt,
        scheduleId: 'sched-1',
        nextRetryAt: fixedNow + 42_000
      },
      maxRetries: 10,
      expectedDetail: /1 \/ 10 automatic retries used/
    },
    {
      name: 'waiting with an unlimited cap',
      autoRetry: {
        phase: 'waiting',
        attemptsStarted: 1,
        lastRetryStartedAt: firstStartAt,
        scheduleId: 'sched-1',
        nextRetryAt: fixedNow + 42_000
      },
      maxRetries: null,
      expectedDetail: /1 automatic retries used · unlimited/
    },
    {
      name: 'waiting without cap information',
      autoRetry: {
        phase: 'waiting',
        attemptsStarted: 1,
        lastRetryStartedAt: firstStartAt,
        scheduleId: 'sched-1',
        nextRetryAt: fixedNow + 42_000
      },
      expectedDetail: /1 automatic retries used · 00:42/
    },
    {
      name: 'preparing past the due time',
      autoRetry: {
        phase: 'waiting',
        attemptsStarted: 1,
        lastRetryStartedAt: firstStartAt,
        scheduleId: 'sched-1',
        nextRetryAt: fixedNow - 2_000
      },
      maxRetries: 10,
      expectedDetail: /Preparing retry…/
    },
    {
      name: 'cancelled',
      autoRetry: { phase: 'cancelled', attemptsStarted: 1, lastRetryStartedAt: firstStartAt, reason: 'user-cancelled' },
      expectedDetail: /Automatic retry cancelled/
    },
    {
      name: 'exhausted',
      autoRetry: { phase: 'exhausted', attemptsStarted: 10, lastRetryStartedAt: firstStartAt },
      expectedDetail: /Automatic retries exhausted \(10\)/
    },
    {
      name: 'blocked',
      autoRetry: { phase: 'blocked', attemptsStarted: 1, lastRetryStartedAt: firstStartAt, reason: 'task-stopped' },
      expectedDetail: /The task was stopped/
    }
  ]

  for (const scenario of startedScenarios) {
    it(`shows the latest start time in the ${scenario.name} phase`, () => {
      renderBanner({
        autoRetry: scenario.autoRetry,
        maxRetries: scenario.maxRetries,
        timeZone: 'America/Los_Angeles'
      })
      expect(scenario.expectedDetail.test(bannerText())).toBe(true)
      expect(screen.getByText(/Last automatic retry started at .*/)).toBeTruthy()
      // 2026-09-21T20:00Z is 13:00 in Los Angeles on the same calendar day.
      expect(screen.getByText(/13:00/)).toBeTruthy()
      expectNoTimeZoneText()
    })

    it(`hides the history line in the ${scenario.name} phase before any retry started`, () => {
      renderBanner({
        autoRetry: { ...scenario.autoRetry, attemptsStarted: 0, lastRetryStartedAt: undefined },
        maxRetries: scenario.maxRetries,
        timeZone: 'America/Los_Angeles'
      })
      expect(bannerText()).not.toContain('Last automatic retry')
      expect(bannerText()).not.toContain('start time unknown')
    })
  }

  it('reports the unknown fallback for retries without a usable start time', () => {
    for (const invalid of [undefined, 'yesterday', -1, 1.5, Number.NaN]) {
      cleanup()
      renderBanner({
        autoRetry: { phase: 'running', attemptsStarted: 2, lastRetryStartedAt: invalid as unknown as number },
        timeZone: 'America/Los_Angeles'
      })
      expect(screen.getByText('Last automatic retry start time unknown')).toBeTruthy()
      expectNoTimeZoneText()
    }
  })

  it('even drops a dirty stored time when the count is zero', () => {
    renderBanner({
      autoRetry: { phase: 'cancelled', attemptsStarted: 0, lastRetryStartedAt: firstStartAt },
      timeZone: 'America/Los_Angeles'
    })
    expect(bannerText()).not.toContain('Last automatic retry')
    expect(bannerText()).not.toContain('13:00')
  })

  it('converts the same epoch with the frozen task zone across day boundaries', () => {
    const { view } = renderBanner({
      autoRetry: { phase: 'running', attemptsStarted: 1, lastRetryStartedAt: fixedNow },
      timeZone: 'America/Los_Angeles'
    })
    expect(screen.getByText(/Last automatic retry started at .*14:30/)).toBeTruthy()

    view.rerender(
      <I18nextProvider i18n={i18n}>
        <TerminalAutoRetryBanner
          autoRetry={baseAutoRetry({ phase: 'running', attemptsStarted: 1, lastRetryStartedAt: fixedNow })}
          timeZone="Asia/Shanghai"
          maxRetries={undefined}
          onRetryNow={vi.fn()}
          onCancel={vi.fn()}
        />
      </I18nextProvider>
    )
    // The next calendar day in Shanghai, still without any zone text.
    expect(screen.getByText(/Last automatic retry started at .*05:30/)).toBeTruthy()
    expectNoTimeZoneText()
  })

  it('falls back to UTC for missing or invalid zones without naming it', () => {
    for (const timeZone of [undefined, 'Not/AZone']) {
      cleanup()
      renderBanner({
        autoRetry: { phase: 'running', attemptsStarted: 1, lastRetryStartedAt: fixedNow },
        timeZone
      })
      expect(screen.getByText(/Last automatic retry started at .*21:30/)).toBeTruthy()
      expectNoTimeZoneText()
    }
  })

  it('updates the time when a new retry starts and keeps it through waiting and outcomes', async () => {
    const onRetryNow = vi.fn()
    const onCancel = vi.fn()
    const initial: TerminalAutoRetryState = baseAutoRetry({
      phase: 'waiting',
      attemptsStarted: 1,
      lastRetryStartedAt: firstStartAt,
      scheduleId: 'sched-1',
      nextRetryAt: fixedNow + 10_000
    })
    const view = render(
      <I18nextProvider i18n={i18n}>
        <TerminalAutoRetryBanner
          autoRetry={initial}
          timeZone="America/Los_Angeles"
          maxRetries={5}
          onRetryNow={onRetryNow}
          onCancel={onCancel}
        />
      </I18nextProvider>
    )

    const rerender = (autoRetry: TerminalAutoRetryState) => view.rerender(
      <I18nextProvider i18n={i18n}>
        <TerminalAutoRetryBanner
          autoRetry={autoRetry}
          timeZone="America/Los_Angeles"
          maxRetries={5}
          onRetryNow={onRetryNow}
          onCancel={onCancel}
        />
      </I18nextProvider>
    )

    // First start recorded: waiting keeps it while the countdown ticks.
    expect(screen.getByText(/Last automatic retry started at .*13:00/)).toBeTruthy()
    await vi.advanceTimersByTimeAsync(4_000)
    expect(screen.getByText(/00:06 left/)).toBeTruthy()
    expect(screen.getByText(/Last automatic retry started at .*13:00/)).toBeTruthy()

    // The second automatic retry enters running: the time updates once.
    rerender(baseAutoRetry({
      phase: 'running',
      attemptsStarted: 2,
      lastRetryStartedAt: secondStartAt
    }))
    expect(screen.getByText('Automatic retry #2 in progress')).toBeTruthy()
    expect(screen.getByText(/Last automatic retry started at .*14:04/)).toBeTruthy()
    await vi.advanceTimersByTimeAsync(1_000)

    // Back to waiting: the countdown resumes but the history time is fixed.
    rerender(baseAutoRetry({
      phase: 'waiting',
      attemptsStarted: 2,
      lastRetryStartedAt: secondStartAt,
      scheduleId: 'sched-2',
      nextRetryAt: fixedNow + 60_000 + 5_000
    }))
    expect(screen.getByText(/01:0\d left/)).toBeTruthy()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(screen.getByText(/00:5\d left/)).toBeTruthy()
    expect(screen.getByText(/Last automatic retry started at .*14:04/)).toBeTruthy()

    // Past the plan time: preparing keeps the latest history line.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(screen.getByText('Preparing retry…')).toBeTruthy()
    expect(screen.getByText(/Last automatic retry started at .*14:04/)).toBeTruthy()

    // Terminal state after cancellation still keeps the same time.
    rerender(baseAutoRetry({
      phase: 'cancelled',
      attemptsStarted: 2,
      lastRetryStartedAt: secondStartAt,
      reason: 'user-cancelled'
    }))
    expect(screen.getByText('Automatic retry cancelled')).toBeTruthy()
    expect(screen.getByText(/Last automatic retry started at .*14:04/)).toBeTruthy()
    expectNoTimeZoneText()
  })

  it('renders the Chinese copy with matching interpolation', async () => {
    await i18n.changeLanguage('zh')
    renderBanner({
      autoRetry: {
        phase: 'waiting',
        attemptsStarted: 1,
        lastRetryStartedAt: firstStartAt,
        scheduleId: 'sched-1',
        nextRetryAt: fixedNow + 42_000
      },
      maxRetries: 10,
      timeZone: 'America/Los_Angeles'
    })
    expect(screen.getByText(/已自动重试 1 \/ 10 次 · 还剩 00:42/)).toBeTruthy()
    expect(screen.getByText(/上次重试开始于 .*13:00/)).toBeTruthy()
    expectNoTimeZoneText()

    cleanup()
    renderBanner({
      autoRetry: { phase: 'exhausted', attemptsStarted: 3 },
      timeZone: 'America/Los_Angeles'
    })
    expect(screen.getByText('上次重试开始时间未知')).toBeTruthy()
  })
})

describe('TerminalAutoRetryBanner review regressions', () => {
  it('reports preparing when the countdown reaches zero before the main process confirms', () => {
    renderBanner({
      autoRetry: { phase: 'waiting', attemptsStarted: 0, nextRetryAt: fixedNow - 2_000, scheduleId: 'sched-1' },
      maxRetries: 10
    })
    expect(screen.getByText('Preparing retry…')).toBeTruthy()
    // No retry has started yet, so no history or unknown line may appear.
    expect(bannerText()).not.toContain('Last automatic retry')
    // Retry-now and cancel stay available while waiting for confirmation.
    expect(screen.getByRole('button', { name: 'Retry now' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel automatic retry' })).toBeTruthy()
  })

  it('keeps the status role, phase attribute and alert structure', () => {
    renderBanner({
      autoRetry: { phase: 'running', attemptsStarted: 1, lastRetryStartedAt: firstStartAt },
      timeZone: 'UTC'
    })
    const root = bannerRoot()
    expect(root?.getAttribute('role')).toBe('status')
    expect(root?.getAttribute('data-auto-retry-phase')).toBe('running')
    expect(within(root as HTMLElement).getByText(/Last automatic retry started at/)).toBeTruthy()
  })
})
