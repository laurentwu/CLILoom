// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
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
    expect(screen.queryByText('Command', { selector: 'legend' })).toBeNull()
    expect(screen.getByLabelText('Working directory')).toBeTruthy()
  })
})
