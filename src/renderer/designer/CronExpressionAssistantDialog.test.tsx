// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { i18n } from '../i18n'
import { CronExpressionAssistantDialog } from './CronExpressionAssistantDialog'

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
})

afterEach(cleanup)

function renderDialog(options: {
  initialExpression?: string
  onApply?: (expression: string) => void
} = {}) {
  const onApply = options.onApply ?? vi.fn()
  const onClose = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <CronExpressionAssistantDialog
        open
        initialExpression={options.initialExpression}
        timeZone="UTC"
        onClose={onClose}
        onApply={onApply}
      />
    </I18nextProvider>
  )
  return { onApply, onClose }
}

async function selectFrequency(label: string): Promise<void> {
  const trigger = screen.getByRole('combobox', { name: 'Frequency' })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'Enter' })
  await waitFor(() => expect(screen.getByRole('option', { name: label })).toBeTruthy())
  fireEvent.click(screen.getByRole('option', { name: label }))
  await waitFor(() => expect(screen.queryByRole('option', { name: label })).toBeNull())
}

describe('CronExpressionAssistantDialog', () => {
  it('renders the default every-N-minutes draft and applies it once', () => {
    const { onApply } = renderDialog()
    expect(screen.getByText('*/5 * * * *')).toBeTruthy()
    const apply = screen.getByRole('button', { name: 'Use expression' })
    expect((apply as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(apply)
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(onApply).toHaveBeenCalledWith('*/5 * * * *')
  })

  it('reverse-fills a recognizable weekly expression', async () => {
    renderDialog({ initialExpression: '30 14 * * 1,3' })
    expect(await screen.findByText('30 14 * * 1,3')).toBeTruthy()
    expect(screen.getByText('Days of week')).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Mon' })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Mon' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('checkbox', { name: 'Wed' }).getAttribute('aria-checked')).toBe('true')
  })

  it('warns that complex expressions cannot be converted without overwriting them', () => {
    renderDialog({ initialExpression: '0 12 1 * *' })
    expect(screen.getByText('The current expression cannot be converted to simple settings')).toBeTruthy()
    // The local draft still generates its own expression.
    expect(screen.getByText('*/5 * * * *')).toBeTruthy()
  })

  it('updates only the local draft while changing controls', async () => {
    const { onApply } = renderDialog({ initialExpression: '*/10 * * * *' })
    expect(screen.getByText('*/10 * * * *')).toBeTruthy()
    await selectFrequency('Daily')
    expect(screen.getByText('0 9 * * *')).toBeTruthy()
    expect(onApply).not.toHaveBeenCalled()
  })

  it('builds the daily and weekly presets', async () => {
    const { onApply } = renderDialog()
    await selectFrequency('Daily')
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '08:15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use expression' }))
    expect(onApply).toHaveBeenLastCalledWith('15 8 * * *')

    await selectFrequency('Weekly')
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:30' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fri' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sun' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use expression' }))
    expect(onApply).toHaveBeenLastCalledWith('30 9 * * 0,1,5')
  })

  it('discards the draft on cancel without applying', () => {
    const { onApply, onClose } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onApply).not.toHaveBeenCalled()
  })

  it('shows candidate preview times in the dialog timezone', () => {
    renderDialog()
    expect(screen.getByText('Next 5 candidate times')).toBeTruthy()
    expect(screen.getByText('Times shown in UTC')).toBeTruthy()
  })
})
