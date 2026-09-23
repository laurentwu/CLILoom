// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../i18n'
import { TerminalAutoRetrySettings } from './TerminalAutoRetrySettings'

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

function renderSettings(
  config: Parameters<typeof TerminalAutoRetrySettings>[0]['config'],
  rerenderConfig?: Parameters<typeof TerminalAutoRetrySettings>[0]['config']
) {
  const onChange = vi.fn()
  const view = render(
    <I18nextProvider i18n={i18n}>
      <TerminalAutoRetrySettings nodeId="node-1" config={config} onChange={onChange} />
    </I18nextProvider>
  )
  if (rerenderConfig !== undefined) {
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <TerminalAutoRetrySettings nodeId="node-1" config={rerenderConfig} onChange={onChange} />
      </I18nextProvider>
    )
  }
  return { onChange, view }
}

describe('TerminalAutoRetrySettings', () => {
  it('is collapsed by default and does not render cron controls', () => {
    renderSettings(undefined)
    expect(screen.getByLabelText('Enable automatic retry')).toBeTruthy()
    expect(screen.queryByLabelText('Retry schedule')).toBeNull()
    expect(screen.queryByLabelText('Cron expression')).toBeNull()
  })

  it('creates the documented default configuration on first enable', () => {
    const { onChange } = renderSettings(undefined)
    fireEvent.click(screen.getByLabelText('Enable automatic retry'))
    expect(onChange).toHaveBeenCalledWith({
      enabled: true,
      mode: 'recommended',
      maxRetries: 10
    })
  })

  it('shows the recommended ladder and count hint when enabled', () => {
    renderSettings({ enabled: true, mode: 'recommended', maxRetries: 10 })
    expect(screen.getByText('Wait 1 → 2 → 5 → 10 → 30 minutes after each failure, then keep waiting 30 minutes.')).toBeTruthy()
    expect(screen.getByText('The first execution and manual retries are not counted; a manual retry starts a new count.')).toBeTruthy()
    expect((screen.getByLabelText('Maximum automatic retries') as HTMLInputElement).value).toBe('10')
  })

  it('keeps a disabled configuration with its cron draft and restores it on re-enable', () => {
    const disabledConfig = { enabled: false, mode: 'cron' as const, cron: 'unfinished', maxRetries: 3 }
    const { onChange } = renderSettings(disabledConfig)
    expect(screen.queryByLabelText('Cron expression')).toBeNull()

    fireEvent.click(screen.getByLabelText('Enable automatic retry'))
    expect(onChange).toHaveBeenCalledWith({
      enabled: true,
      mode: 'cron',
      cron: 'unfinished',
      maxRetries: 3
    })
  })

  it('edits the retry limit and supports unlimited', () => {
    const { onChange } = renderSettings({ enabled: true, mode: 'recommended', maxRetries: 10 })
    const input = screen.getByLabelText('Maximum automatic retries')
    fireEvent.change(input, { target: { value: '42' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ maxRetries: 42 }))

    const unlimited = screen.getByRole('checkbox', { name: 'Unlimited' })
    fireEvent.click(unlimited)
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ maxRetries: null }))
  })

  it('edits cron expressions and reports debounced validation errors', async () => {
    const { onChange } = renderSettings({ enabled: true, mode: 'cron', cron: '*/5 * * * *', maxRetries: 5 })
    const input = screen.getByLabelText('Cron expression')
    expect(screen.getByText('Next 5 candidate times')).toBeTruthy()

    fireEvent.change(input, { target: { value: 'not valid' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ cron: 'not valid' }))
    // Invalid text stays in the input while the error appears after debounce.
    expect((input as HTMLInputElement).value).toBe('not valid')
    expect(screen.queryByRole('alert')).toBeNull()

    await waitFor(() => expect(
      screen.getByText('The cron expression must have exactly 5 fields: minute hour day-of-month month day-of-week')
    ).toBeTruthy(), { timeout: 2_000 })
  })

  it('opens the assistant dialog from the button next to the input', () => {
    renderSettings({ enabled: true, mode: 'cron', cron: '*/5 * * * *', maxRetries: 5 })
    fireEvent.click(screen.getByRole('button', { name: 'Expression assistant' }))
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeTruthy()
    expect(screen.getByText('Use expression')).toBeTruthy()
  })

  it('renders a preview of the next five times for a valid expression', () => {
    renderSettings({ enabled: true, mode: 'cron', cron: '*/5 * * * *', maxRetries: 5 })
    expect(screen.getByText('Next 5 candidate times')).toBeTruthy()
    expect(screen.getAllByText(/GMT/).length).toBeGreaterThan(0)
  })
})

describe('TerminalAutoRetrySettings review regressions', () => {
  it('preserves an unlimited configuration across further edits', () => {
    const { onChange } = renderSettings({ enabled: true, mode: 'cron', cron: '*/5 * * * *', maxRetries: null })
    expect(screen.getByRole('checkbox', { name: 'Unlimited' }).getAttribute('aria-checked')).toBe('true')
    expect((screen.getByLabelText('Maximum automatic retries') as HTMLInputElement).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('Cron expression'), { target: { value: '*/10 * * * *' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      maxRetries: null,
      cron: '*/10 * * * *'
    }))
  })

  it('reverse-fills the assistant from the current cron draft', () => {
    renderSettings({ enabled: true, mode: 'cron', cron: '30 14 * * 1,3', maxRetries: 5 })
    fireEvent.click(screen.getByRole('button', { name: 'Expression assistant' }))
    expect(screen.getByText('30 14 * * 1,3')).toBeTruthy()
    expect(screen.getByText('Days of week')).toBeTruthy()
    expect((screen.getByRole('checkbox', { name: 'Mon' })).getAttribute('aria-checked')).toBe('true')
  })

  it('warns about complex expressions that cannot be reverse-filled', () => {
    renderSettings({ enabled: true, mode: 'cron', cron: '0 12 1 * *', maxRetries: 5 })
    fireEvent.click(screen.getByRole('button', { name: 'Expression assistant' }))
    expect(screen.getByText('The current expression cannot be converted to simple settings')).toBeTruthy()
  })

  it('closes the assistant dialog when the feature is disabled', () => {
    renderSettings({ enabled: true, mode: 'cron', cron: '*/5 * * * *', maxRetries: 5 })
    fireEvent.click(screen.getByRole('button', { name: 'Expression assistant' }))
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeTruthy()

    fireEvent.click(screen.getByLabelText('Enable automatic retry'))
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull()
  })
})
