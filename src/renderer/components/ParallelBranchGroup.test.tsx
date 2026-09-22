// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowNode } from '../../shared/workflow'
import type { WorkflowRuntimeBranchRun, WorkflowRuntimeNodeRun } from '../../shared/workflowRuntime'
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

import { ParallelBranchGroup } from './ParallelBranchGroup'

// 2026-09-21T21:30Z renders as 13:30 in America/Los_Angeles and 21:30 in UTC.
const startedAt = Date.UTC(2026, 8, 21, 20, 30, 0)

const terminalNode: WorkflowNode = {
  id: 'left',
  type: 'non-interactive-terminal',
  name: 'Left command',
  config: {
    command: 'boom',
    cwd: '/repo',
    successExitCodes: [0],
    autoRetry: { enabled: true, mode: 'recommended', maxRetries: 7 }
  }
}

const branch: WorkflowRuntimeBranchRun = {
  branchId: 'split:e-left',
  splitNodeId: 'split',
  entryEdgeId: 'e-left',
  entryNodeId: 'left',
  currentNodeId: 'left',
  status: 'failed',
  nodeIds: ['left'],
  variables: {}
}

function renderGroup(options: {
  run: WorkflowRuntimeNodeRun
  autoRetryTimeZone?: string
}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ParallelBranchGroup
        branches={[branch]}
        gatewayNode={{ id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split' } }}
        workflowNodes={[terminalNode]}
        nodeRuns={{ left: options.run }}
        sessions={[]}
        autoRetryTimeZone={options.autoRetryTimeZone}
        onBranchVariableChange={vi.fn()}
        onBranchContinue={vi.fn()}
        onRetryNode={vi.fn()}
        onStopTerminal={vi.fn()}
        onShowGraph={vi.fn()}
        onToggleZoomNode={vi.fn()}
        onLoadTerminalTranscript={vi.fn()}
        onSendTerminalInput={vi.fn()}
        onRetryTerminal={vi.fn()}
      />
    </I18nextProvider>
  )
}

beforeEach(() => {
  void i18n.changeLanguage('en')
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    locale: 'en-US'
  } as Intl.ResolvedDateTimeFormatOptions)
})

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
})

describe('ParallelBranchGroup automatic retry banner', () => {
  it('converts the retry start time with the frozen task time zone', () => {
    renderGroup({
      autoRetryTimeZone: 'America/Los_Angeles',
      run: {
        nodeId: 'left',
        status: 'failed',
        sessionId: 'session-left',
        autoRetry: {
          version: 1,
          cycleId: 'cycle-1',
          phase: 'running',
          attemptsStarted: 1,
          lastRetryStartedAt: startedAt
        }
      }
    })

    expect(screen.getByText(/Automatic retry #1 in progress/)).toBeTruthy()
    expect(screen.getByText(/Last automatic retry started at .*13:30/)).toBeTruthy()
    expect(document.body.textContent ?? '').not.toMatch(/GMT|UTC|Los_Angeles|Shanghai/i)
  })

  it('falls back to UTC when no task time zone is provided', () => {
    renderGroup({
      run: {
        nodeId: 'left',
        status: 'failed',
        sessionId: 'session-left',
        autoRetry: {
          version: 1,
          cycleId: 'cycle-1',
          phase: 'running',
          attemptsStarted: 1,
          lastRetryStartedAt: startedAt
        }
      }
    })

    expect(screen.getByText(/Last automatic retry started at .*20:30/)).toBeTruthy()
    expect(document.body.textContent ?? '').not.toMatch(/GMT|UTC/i)
  })

  it('passes the node retry cap into the waiting stats', () => {
    renderGroup({
      autoRetryTimeZone: 'UTC',
      run: {
        nodeId: 'left',
        status: 'failed',
        sessionId: 'session-left',
        autoRetry: {
          version: 1,
          cycleId: 'cycle-1',
          phase: 'waiting',
          attemptsStarted: 1,
          lastFailureAt: 1,
          lastRetryStartedAt: startedAt,
          scheduleId: 'sched-1',
          nextRetryAt: Date.now() + 42_000
        }
      }
    })

    expect(screen.getByText(/1 \/ 7 automatic retries used/)).toBeTruthy()
    expect(screen.getByText(/Last automatic retry started at/)).toBeTruthy()
  })
})
