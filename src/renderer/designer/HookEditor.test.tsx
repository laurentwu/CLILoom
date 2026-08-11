// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../i18n'
import { HookEditor } from './HookEditor'

afterEach(cleanup)

describe('HookEditor', () => {
  it('hides the command field when the hook is disabled', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <HookEditor kind="start" nodeId="n1" onChange={vi.fn()} />
      </I18nextProvider>
    )

    expect(screen.getByText('Start hook')).toBeTruthy()
    expect(screen.getByRole('checkbox', { checked: false })).toBeTruthy()
    expect(screen.queryByLabelText('Command')).toBeNull()
  })

  it('shows the configured command when the hook is enabled', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <HookEditor
          kind="end"
          nodeId="n1"
          hook={{ enabled: true, command: 'echo done', failPolicy: 'continue' }}
          onChange={vi.fn()}
        />
      </I18nextProvider>
    )

    expect((screen.getByLabelText('Command') as HTMLTextAreaElement).value).toBe('echo done')
    expect(screen.getByRole('checkbox', { checked: true })).toBeTruthy()
  })

  it('creates a default enabled hook when toggled on', () => {
    const onChange = vi.fn()
    render(
      <I18nextProvider i18n={i18n}>
        <HookEditor kind="start" nodeId="n1" onChange={onChange} />
      </I18nextProvider>
    )

    fireEvent.click(screen.getByRole('checkbox'))

    expect(onChange).toHaveBeenCalledWith({ enabled: true, command: '', failPolicy: 'continue' })
  })

  it('keeps the configuration when toggled off', () => {
    const onChange = vi.fn()
    render(
      <I18nextProvider i18n={i18n}>
        <HookEditor
          kind="start"
          nodeId="n1"
          hook={{ enabled: true, command: 'echo hi', failPolicy: 'continue' }}
          onChange={onChange}
        />
      </I18nextProvider>
    )

    fireEvent.click(screen.getByRole('checkbox'))

    expect(onChange).toHaveBeenCalledWith({ enabled: false, command: 'echo hi', failPolicy: 'continue' })
  })

  it('preserves the command when re-enabling a disabled hook', () => {
    const onChange = vi.fn()
    render(
      <I18nextProvider i18n={i18n}>
        <HookEditor
          kind="start"
          nodeId="n1"
          hook={{ enabled: false, command: 'echo hi', failPolicy: 'fail-node' }}
          onChange={onChange}
        />
      </I18nextProvider>
    )

    expect(screen.getByRole('checkbox', { checked: false })).toBeTruthy()
    expect(screen.queryByLabelText('Command')).toBeNull()

    fireEvent.click(screen.getByRole('checkbox'))

    expect(onChange).toHaveBeenCalledWith({ enabled: true, command: 'echo hi', failPolicy: 'fail-node' })
  })

  it('patches the command without losing the fail policy', () => {
    const onChange = vi.fn()
    render(
      <I18nextProvider i18n={i18n}>
        <HookEditor
          kind="start"
          nodeId="n1"
          hook={{ enabled: true, command: '', failPolicy: 'fail-node' }}
          onChange={onChange}
        />
      </I18nextProvider>
    )

    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'curl example.com' } })

    expect(onChange).toHaveBeenCalledWith({ enabled: true, command: 'curl example.com', failPolicy: 'fail-node' })
  })

  it('clears cwd to undefined when emptied', () => {
    const onChange = vi.fn()
    render(
      <I18nextProvider i18n={i18n}>
        <HookEditor
          kind="start"
          nodeId="n1"
          hook={{ enabled: true, command: 'echo hi', cwd: '/tmp', failPolicy: 'continue' }}
          onChange={onChange}
        />
      </I18nextProvider>
    )

    fireEvent.change(screen.getByLabelText('Working directory'), { target: { value: '' } })

    expect(onChange).toHaveBeenCalledWith({ enabled: true, command: 'echo hi', cwd: undefined, failPolicy: 'continue' })
  })

  it('drops env to undefined when the last entry is removed', () => {
    const onChange = vi.fn()
    render(
      <I18nextProvider i18n={i18n}>
        <HookEditor
          kind="start"
          nodeId="n1"
          hook={{ enabled: true, command: 'echo hi', env: { DEBUG: '1' }, failPolicy: 'continue' }}
          onChange={onChange}
        />
      </I18nextProvider>
    )

    fireEvent.click(screen.getByLabelText('Delete environment variable'))

    expect(onChange).toHaveBeenCalledWith({ enabled: true, command: 'echo hi', env: undefined, failPolicy: 'continue' })
  })

  it('associates the failure-policy label with the combobox', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <HookEditor
          kind="start"
          nodeId="n1"
          hook={{ enabled: true, command: 'echo hi', failPolicy: 'continue' }}
          onChange={vi.fn()}
        />
      </I18nextProvider>
    )

    const trigger = screen.getByRole('combobox')
    expect(trigger.id).toBe('designer-start-hook-policy-n1')
    expect(document.querySelector('label[for="designer-start-hook-policy-n1"]')).toBeTruthy()
  })
})
