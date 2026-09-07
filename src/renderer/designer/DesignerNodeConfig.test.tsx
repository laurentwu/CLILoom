// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../i18n'
import { DesignerNodeConfig } from './DesignerNodeConfig'

afterEach(cleanup)

describe('DesignerNodeConfig', () => {
  it('does not expose a failure policy for parallel split gateways', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <DesignerNodeConfig
          node={{
            id: 'split',
            type: 'parallel-gateway',
            name: 'Split',
            config: { mode: 'split' },
            x: 0,
            y: 0
          }}
          nodes={[]}
          edges={[]}
          onUpdateNode={vi.fn()}
        />
      </I18nextProvider>
    )

    expect(screen.getByText('Mode')).toBeTruthy()
    expect(screen.getAllByRole('combobox')).toHaveLength(1)
    expect(screen.queryByText('失败策略')).toBeNull()
  })

  it('renders a single command field for interactive terminal nodes', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <DesignerNodeConfig
          node={{
            id: 'it',
            type: 'interactive-terminal',
            name: 'Interactive',
            config: { command: 'echo hi', cwd: '', autoStart: false },
            x: 0,
            y: 0
          }}
          nodes={[]}
          edges={[]}
          onUpdateNode={vi.fn()}
        />
      </I18nextProvider>
    )

    expect(screen.getByLabelText('Command')).toBeTruthy()
    expect(screen.getByLabelText('Retry command (optional)')).toBeTruthy()
    expect(screen.getByPlaceholderText('Leave blank to replay the original command…')).toBeTruthy()
    expect(screen.getByText('Used only when retrying the node in its workflow; variables and the latest command result are available.')).toBeTruthy()
    expect(screen.queryByText('Command', { selector: 'legend' })).toBeNull()
    expect(screen.getByLabelText('Working directory')).toBeTruthy()
  })

  it('renders a single command field for non-interactive terminal nodes', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <DesignerNodeConfig
          node={{
            id: 'nit',
            type: 'non-interactive-terminal',
            name: 'NonInteractive',
            config: { command: 'echo hi', cwd: '', successExitCodes: [0] },
            x: 0,
            y: 0
          }}
          nodes={[]}
          edges={[]}
          onUpdateNode={vi.fn()}
        />
      </I18nextProvider>
    )

    expect(screen.getByLabelText('Command')).toBeTruthy()
    expect(screen.getByLabelText('Retry command (optional)')).toBeTruthy()
    expect(screen.queryByText('Command', { selector: 'legend' })).toBeNull()
    expect(screen.getByLabelText('Working directory')).toBeTruthy()
  })

  it.each(['interactive-terminal', 'non-interactive-terminal'] as const)(
    'updates and clears the retry command for %s nodes',
    (type) => {
      const config = type === 'interactive-terminal'
        ? { command: 'echo hi', retryCommand: 'echo old', cwd: '/repo', autoStart: false }
        : { command: 'echo hi', retryCommand: 'echo old', cwd: '/repo', successExitCodes: [0] }
      const onUpdateNode = vi.fn()
      render(
        <I18nextProvider i18n={i18n}>
          <DesignerNodeConfig
            node={{ id: type, type, name: 'Terminal', config, x: 0, y: 0 }}
            nodes={[]}
            edges={[]}
            onUpdateNode={onUpdateNode}
          />
        </I18nextProvider>
      )

      const input = screen.getByLabelText('Retry command (optional)')
      fireEvent.change(input, { target: { value: '  echo new  ' } })
      expect(onUpdateNode).toHaveBeenLastCalledWith(type, {
        config: { ...config, retryCommand: '  echo new  ' }
      })

      fireEvent.change(input, { target: { value: '' } })
      expect(onUpdateNode).toHaveBeenLastCalledWith(type, {
        config: { ...config, retryCommand: undefined }
      })
    }
  )
})
