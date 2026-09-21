// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../i18n'
import { TerminalAutoRetryBanner } from './TerminalAutoRetryBanner'
import type { TerminalAutoRetryState } from '../../shared/terminalAutoRetry'

afterEach(cleanup)

function renderBanner(options: {
  autoRetry: Partial<TerminalAutoRetryState> & Pick<TerminalAutoRetryState, 'phase'>
  timeZone?: string
  maxRetries?: number | null
  onCancel?: (autoRetry: TerminalAutoRetryState) => void
}) {
  const onRetryNow = vi.fn()
  const onCancel = options.onCancel ?? vi.fn()
  const autoRetry: TerminalAutoRetryState = {
    version: 1,
    cycleId: 'cycle-1',
    attemptsStarted: 1,
    lastFailureAt: 1_000,
    scheduleId: 'sched-1',
    nextRetryAt: Date.now() + 42_000,
    ...options.autoRetry
  }
  render(
    <I18nextProvider i18n={i18n}>
      <TerminalAutoRetryBanner
        autoRetry={autoRetry}
        timeZone={options.timeZone ?? 'UTC'}
        maxRetries={options.maxRetries}
        onRetryNow={onRetryNow}
        onCancel={onCancel}
      />
    </I18nextProvider>
  )
  return { onRetryNow, onCancel, autoRetry }
}

describe('TerminalAutoRetryBanner', () => {
  it('shows the next attempt, count, timezone and a countdown', () => {
    renderBanner({ autoRetry: { phase: 'waiting', attemptsStarted: 1 }, maxRetries: 10 })
    expect(screen.getByText(/Automatic retry #2 will run at/)).toBeTruthy()
    expect(screen.getByText(/1 \/ 10 automatic retries used/)).toBeTruthy()
    expect(screen.getByText(/GMT\+?0/)).toBeTruthy()
    expect(screen.getByText(/left$/)).toBeTruthy()
  })

  it('shows the unlimited variant without a countdown cap', () => {
    renderBanner({ autoRetry: { phase: 'waiting', attemptsStarted: 3 }, maxRetries: null })
    expect(screen.getByText(/unlimited/)).toBeTruthy()
    expect(screen.getByText(/3 automatic retries used/)).toBeTruthy()
  })

  it('offers retry now and cancel only while waiting', () => {
    const first = renderBanner({ autoRetry: { phase: 'waiting' } })
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

describe('TerminalAutoRetryBanner review regressions', () => {
  it('reports preparing when the countdown reaches zero before the main process confirms', () => {
    renderBanner({
      autoRetry: { phase: 'waiting', attemptsStarted: 0, nextRetryAt: Date.now() - 2_000 },
      maxRetries: 10
    })
    expect(screen.getByText('Preparing retry…')).toBeTruthy()
    // Retry-now and cancel stay available while waiting for confirmation.
    expect(screen.getByRole('button', { name: 'Retry now' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel automatic retry' })).toBeTruthy()
  })
})
