import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import type { TerminalSession } from '../utils'
import { i18n } from '../i18n'

vi.mock('./XtermTerminal', async () => {
  const { createElement, forwardRef } = await import('react')
  return {
    XtermTerminal: forwardRef<HTMLDivElement, {
      persistent?: boolean
      readOnly?: boolean
      session: { cursor?: number | null }
    }>(
      function MockXtermTerminal({ persistent, readOnly, session }, ref) {
        return createElement('div', {
          className: 'xterm-host',
          'data-cursor': String(session.cursor ?? ''),
          'data-persistent': String(Boolean(persistent)),
          'data-read-only': String(Boolean(readOnly)),
          ref
        })
      }
    )
  }
})

import { TerminalPane } from './TerminalPane'

const completedSession: TerminalSession = {
  id: 'session-1',
  task_id: 'task-1',
  node_id: 'terminal-1',
  kind: 'interactive',
  command: 'npm test',
  cwd: '/repo',
  status: 'closed',
  transcript: '\u001b[32mcompleted\u001b[0m\r\n'
}

describe('TerminalPane', () => {
  it('keeps completed sessions in xterm instead of converting them to plain text', () => {
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <TerminalPane
          session={completedSession}
          onSendInput={vi.fn()}
          onRetry={vi.fn()}
          onStop={vi.fn()}
        />
      </I18nextProvider>
    )

    expect(markup).toContain('xterm-host')
    expect(markup).toContain('data-persistent="false"')
    expect(markup).toContain('data-read-only="true"')
    expect(markup).toContain('Interactive terminal')
    expect(markup).not.toContain('<pre')
  })

  it('marks running sessions for xterm instance persistence', () => {
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <TerminalPane
          session={{ ...completedSession, status: 'running', transcript_cursor: 7 }}
          onSendInput={vi.fn()}
          onRetry={vi.fn()}
          onStop={vi.fn()}
        />
      </I18nextProvider>
    )

    expect(markup).toContain('data-persistent="true"')
    expect(markup).toContain('data-cursor="7"')
  })
})
