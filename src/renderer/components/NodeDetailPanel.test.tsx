// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowNode } from '../../shared/workflow'
import type { TerminalSession } from '../utils'
import { i18n } from '../i18n'

vi.mock('./TerminalPane', async () => {
  const React = await import('react')
  return {
    TerminalPane: ({ workflowRole }: { workflowRole: string }) => React.createElement(
      'div',
      { 'data-testid': 'terminal-pane', 'data-workflow-role': workflowRole }
    ),
    TerminalOutputPane: () => React.createElement('div')
  }
})

import { NodeDetailPanel } from './NodeDetailPanel'

const terminalNode: WorkflowNode = {
  id: 'terminal',
  type: 'non-interactive-terminal',
  name: 'Terminal',
  config: { command: 'npm test', cwd: '/repo', successExitCodes: [0] }
}

const interruptedSession: TerminalSession = {
  id: 'session-current',
  task_id: 'task-1',
  node_id: terminalNode.id,
  kind: 'non-interactive',
  command: 'npm test',
  cwd: '/repo',
  status: 'interrupted',
  transcript: ''
}

function renderPanel(options: {
  node?: WorkflowNode
  run?: Parameters<typeof NodeDetailPanel>[0]['run']
  sessions?: TerminalSession[]
  onRetryNode?: () => void
  onRetryTerminal?: (sessionId: string, mode: string) => Promise<void>
  onCancelAutoRetry?: (nodeId: string) => Promise<void>
}) {
  const node = options.node ?? terminalNode
  return render(
    <I18nextProvider i18n={i18n}>
      <NodeDetailPanel
        node={node}
        run={options.run}
        sessions={options.sessions ?? []}
        variables={{}}
        editableVariables={[]}
        canOperate
        isWaitingForInput={options.run?.status === 'waiting-input'}
        onVariableChange={vi.fn()}
        onRun={vi.fn()}
        onRetryNode={options.onRetryNode ?? vi.fn()}
        onContinue={vi.fn()}
        onStopTerminal={vi.fn()}
        onShowGraph={vi.fn()}
        onLoadTerminalTranscript={vi.fn()}
        onSendTerminalInput={vi.fn()}
        onRetryTerminal={options.onRetryTerminal ?? vi.fn()}
        {...(options.onCancelAutoRetry ? { onCancelAutoRetry: options.onCancelAutoRetry } : {})}
      />
    </I18nextProvider>
  )
}

afterEach(() => cleanup())

describe('NodeDetailPanel execution actions', () => {
  it('uses only the workflow terminal retry after interruption', () => {
    renderPanel({
      run: {
        nodeId: terminalNode.id,
        status: 'interrupted',
        sessionId: interruptedSession.id
      },
      sessions: [interruptedSession]
    })

    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry node' })).toBeNull()
    expect(screen.getByTestId('terminal-pane').getAttribute('data-workflow-role')).toBe('retryable')
  })

  it('offers a node retry when an interrupted terminal has no retriable session', () => {
    renderPanel({
      run: { nodeId: terminalNode.id, status: 'interrupted' }
    })

    expect(screen.getByRole('button', { name: 'Retry node' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull()
  })

  it('shows Run only for an unstarted pending node', () => {
    renderPanel({ run: undefined })

    expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry node' })).toBeNull()
  })

  it('offers a node retry for a stopped non-terminal node', () => {
    const inputNode: WorkflowNode = {
      id: 'input',
      type: 'input',
      name: 'Input',
      config: { variables: [] }
    }
    renderPanel({
      node: inputNode,
      run: { nodeId: inputNode.id, status: 'stopped' }
    })

    expect(screen.getByRole('button', { name: 'Retry node' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Run' })).toBeNull()
  })

  it('keeps an older terminal session historical when a failed node has no session id', () => {
    renderPanel({
      run: { nodeId: terminalNode.id, status: 'failed' },
      sessions: [{
        ...interruptedSession,
        id: 'historical-session',
        status: 'closed'
      }]
    })

    expect(screen.getByRole('button', { name: 'Retry node' })).toBeTruthy()
    expect(screen.getByTestId('terminal-pane').getAttribute('data-workflow-role')).toBe('history')
  })
})

describe('NodeDetailPanel automatic retry banner', () => {
  it('routes banner retry-now through the workflow terminal retry entry', async () => {
    const onRetryNode = vi.fn()
    const onRetryTerminal = vi.fn(async () => undefined)
    renderPanel({
      run: {
        nodeId: terminalNode.id,
        status: 'failed',
        sessionId: 'session-current',
        autoRetry: {
          version: 1,
          cycleId: 'cycle-1',
          phase: 'waiting',
          attemptsStarted: 0,
          lastFailureAt: 1,
          scheduleId: 'sched-1',
          nextRetryAt: Date.now() + 60_000
        }
      },
      sessions: [interruptedSession],
      onRetryNode,
      onRetryTerminal
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Retry now' }))
    expect(onRetryTerminal).toHaveBeenCalledWith('session-current', 'workflow')
    expect(onRetryNode).not.toHaveBeenCalled()
  })

  it('keeps the cancelling state until the cancel promise settles', async () => {
    let resolveCancel: () => void = () => {}
    const onCancelAutoRetry = vi.fn(async () => {
      await new Promise<void>((resolve) => { resolveCancel = resolve })
    })
    renderPanel({
      run: {
        nodeId: terminalNode.id,
        status: 'failed',
        sessionId: 'session-current',
        autoRetry: {
          version: 1,
          cycleId: 'cycle-1',
          phase: 'waiting',
          attemptsStarted: 0,
          lastFailureAt: 1,
          scheduleId: 'sched-1',
          nextRetryAt: Date.now() + 60_000
        }
      },
      sessions: [interruptedSession],
      onCancelAutoRetry
    })

    const cancelButton = screen.getByRole('button', { name: 'Cancel automatic retry' })
    await fireEvent.click(cancelButton)
    expect((cancelButton as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Cancelling…')).toBeTruthy()
    expect(onCancelAutoRetry).toHaveBeenCalledWith(terminalNode.id, expect.objectContaining({
      cycleId: 'cycle-1',
      scheduleId: 'sched-1'
    }))

    resolveCancel()
    await waitFor(() => expect((cancelButton as HTMLButtonElement).disabled).toBe(false))
  })
})
