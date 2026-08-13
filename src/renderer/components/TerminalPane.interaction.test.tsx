// @vitest-environment jsdom

import { act } from '@testing-library/react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalSession } from '../utils'

const paneState = vi.hoisted(() => ({
  focus: vi.fn(),
  paste: vi.fn(() => true),
  scrollBy: vi.fn(),
  snapshot: { source: 'all' as 'all' | 'selection', text: 'initial output' }
}))

const terminalMockState = vi.hoisted(() => ({
  exposeHandle: true
}))

const scrollRegistrations = vi.hoisted(() => ({
  handlers: new Map<string, (deltaY: number) => void>()
}))

vi.mock('./XtermTerminal', async () => {
  const React = await import('react')
  return {
    XtermTerminal: React.forwardRef(function MockXtermTerminal(
      {
        onInputReadyChange,
        readOnly,
        session
      }: {
        onInputReadyChange?: (ready: boolean) => void
        readOnly?: boolean
        session: { id: string }
      },
      ref: React.ForwardedRef<unknown>
    ) {
      React.useImperativeHandle(ref, () => (
        terminalMockState.exposeHandle
          ? {
            focus: paneState.focus,
            getTextSnapshot: () => paneState.snapshot,
            paste: paneState.paste,
            scrollBy: paneState.scrollBy
          }
          : null
      ))
      React.useEffect(() => () => onInputReadyChange?.(false), [onInputReadyChange, readOnly, session.id])
      return React.createElement('button', {
        'aria-label': `连接输入 ${session.id}`,
        disabled: readOnly,
        onClick: () => onInputReadyChange?.(true),
        type: 'button'
      })
    })
  }
})

vi.mock('./TerminalContextMenu', async () => {
  const React = await import('react')
  return {
    TerminalContextMenu: ({
      canPaste,
      children,
      getText,
      onPaste,
      onRestoreFocus,
      onShowMarkdown
    }: {
      canPaste?: boolean
      children: React.ReactNode
      getText: () => { source: 'all' | 'selection'; text: string }
      onPaste?: (text: string) => boolean
      onRestoreFocus?: () => void
      onShowMarkdown: (text: string) => void
    }) => React.createElement(
      'section',
      { 'data-can-paste': String(Boolean(canPaste)) },
      children,
      canPaste && onPaste
        ? React.createElement('button', {
            onClick: () => onPaste('clipboard input'),
            type: 'button'
          }, '测试粘贴')
        : null,
      React.createElement('button', {
        onClick: () => onShowMarkdown(getText().text),
        type: 'button'
      }, '测试打开编辑器'),
      onRestoreFocus
        ? React.createElement('button', {
            onClick: onRestoreFocus,
            type: 'button'
          }, '测试恢复焦点')
        : null
    )
  }
})

vi.mock('./TerminalMarkdownDialog', async () => {
  const React = await import('react')
  return {
    TerminalMarkdownDialog: ({
      initialMarkdown,
      onClose,
      onRestoreFocus
    }: {
      initialMarkdown: string
      onClose: () => void
      onRestoreFocus?: () => void
    }) => React.createElement(
      'div',
      { 'data-markdown': initialMarkdown, role: 'dialog' },
      initialMarkdown,
      React.createElement('button', { onClick: onClose, type: 'button' }, '测试关闭编辑器'),
      onRestoreFocus
        ? React.createElement('button', { onClick: onRestoreFocus, type: 'button' }, '测试编辑器恢复焦点')
        : null
    )
  }
})

vi.mock('./TerminalScrollGroup', () => ({
  useTerminalScrollRegistration: (id: string, handler: (deltaY: number) => void) => {
    scrollRegistrations.handlers.set(id, handler)
  }
}))

import { TerminalOutputPane, TerminalPane } from './TerminalPane'

const runningSession: TerminalSession = {
  id: 'session-1',
  task_id: 'task-1',
  node_id: 'terminal-1',
  kind: 'interactive',
  command: 'bash',
  cwd: '/repo',
  status: 'running',
  transcript: ''
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('TerminalPane context actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    paneState.snapshot = { source: 'all', text: 'initial output' }
    paneState.paste.mockReturnValue(true)
    terminalMockState.exposeHandle = true
    scrollRegistrations.handlers.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('exposes paste only while a running interactive terminal is input-ready', () => {
    const { rerender } = render(
      <TerminalPane session={runningSession} onRetry={vi.fn()} onSendInput={vi.fn()} onStop={vi.fn()} />
    )
    expect(screen.queryByRole('button', { name: '测试粘贴' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '连接输入 session-1' }))
    fireEvent.click(screen.getByRole('button', { name: '测试粘贴' }))
    expect(paneState.paste).toHaveBeenCalledWith('clipboard input')

    rerender(
      <TerminalPane disabled session={runningSession} onRetry={vi.fn()} onSendInput={vi.fn()} onStop={vi.fn()} />
    )
    expect(screen.queryByRole('button', { name: '测试粘贴' })).toBeNull()

    rerender(
      <TerminalPane
        session={{ ...runningSession, kind: 'non-interactive' }}
        onRetry={vi.fn()}
        onSendInput={vi.fn()}
        onStop={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: '测试粘贴' })).toBeNull()

    rerender(
      <TerminalPane
        session={{ ...runningSession, status: 'closed' }}
        onRetry={vi.fn()}
        onSendInput={vi.fn()}
        onStop={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: '测试粘贴' })).toBeNull()
  })

  it('keeps an open editor snapshot stable and takes fresh content after reopening', async () => {
    paneState.snapshot = { source: 'selection', text: 'first selection' }
    const { rerender } = render(
      <TerminalPane session={runningSession} onRetry={vi.fn()} onSendInput={vi.fn()} onStop={vi.fn()} />
    )
    fireEvent.click(screen.getByRole('button', { name: '测试打开编辑器' }))
    expect((await screen.findByRole('dialog')).getAttribute('data-markdown')).toBe('first selection')

    paneState.snapshot = { source: 'all', text: 'new live output' }
    rerender(<TerminalPane session={runningSession} onRetry={vi.fn()} onSendInput={vi.fn()} onStop={vi.fn()} />)
    expect(screen.getByRole('dialog').getAttribute('data-markdown')).toBe('first selection')

    fireEvent.click(screen.getByRole('button', { name: '测试关闭编辑器' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '测试打开编辑器' }))

    expect((await screen.findByRole('dialog')).getAttribute('data-markdown')).toBe('new live output')
  })

  it('routes menu and dialog focus restoration back to xterm', async () => {
    render(<TerminalPane session={runningSession} onRetry={vi.fn()} onSendInput={vi.fn()} onStop={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '测试恢复焦点' }))
    fireEvent.click(screen.getByRole('button', { name: '测试打开编辑器' }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: '测试编辑器恢复焦点' }))

    expect(paneState.focus).toHaveBeenCalledTimes(2)
  })

  it('uses a selection contained in TerminalOutputPane and otherwise falls back to all text', async () => {
    const { rerender } = render(<TerminalOutputPane id="output" text="all output" />)
    const pre = screen.getByText('all output')
    const textNode = pre.firstChild
    vi.spyOn(window, 'getSelection').mockReturnValue({
      anchorNode: textNode,
      focusNode: textNode,
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'selected output'
    } as Selection)

    fireEvent.click(screen.getByRole('button', { name: '测试打开编辑器' }))
    expect((await screen.findByRole('dialog')).getAttribute('data-markdown')).toBe('selected output')
    fireEvent.click(screen.getByRole('button', { name: '测试关闭编辑器' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    vi.mocked(window.getSelection).mockReturnValue(null)
    rerender(<TerminalOutputPane id="output" text="updated all output" />)
    fireEvent.click(screen.getByRole('button', { name: '测试打开编辑器' }))

    expect((await screen.findByRole('dialog')).getAttribute('data-markdown')).toBe('updated all output')
    expect(screen.queryByRole('button', { name: '测试粘贴' })).toBeNull()
  })

  it('loads an unloaded transcript before mounting xterm', async () => {
    const loadDeferred = deferred<void>()
    const onLoadTranscript = vi.fn(() => loadDeferred.promise)
    const unloadedSession: TerminalSession = {
      ...runningSession,
      status: 'closed',
      transcript: null
    }
    const { rerender } = render(
      <TerminalPane
        session={unloadedSession}
        onLoadTranscript={onLoadTranscript}
        onRetry={vi.fn()}
        onSendInput={vi.fn()}
        onStop={vi.fn()}
      />
    )

    await waitFor(() => expect(onLoadTranscript).toHaveBeenCalledWith(unloadedSession))
    expect(screen.getByText('terminal:transcript.loadingHistory')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '连接输入 session-1' })).toBeNull()

    await act(async () => loadDeferred.resolve())
    rerender(
      <TerminalPane
        session={{ ...unloadedSession, transcript: 'loaded history' }}
        onLoadTranscript={onLoadTranscript}
        onRetry={vi.fn()}
        onSendInput={vi.fn()}
        onStop={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: '连接输入 session-1' })).toBeTruthy()
    expect(onLoadTranscript).toHaveBeenCalledTimes(1)
  })

  it('allows a failed transcript load to be retried', async () => {
    const onLoadTranscript = vi.fn()
      .mockRejectedValueOnce(new Error('load failed'))
      .mockResolvedValueOnce(undefined)
    render(
      <TerminalPane
        session={{ ...runningSession, status: 'closed', transcript: null }}
        onLoadTranscript={onLoadTranscript}
        onRetry={vi.fn()}
        onSendInput={vi.fn()}
        onStop={vi.fn()}
      />
    )

    const retryLoad = await screen.findByRole('button', { name: 'common:action.retry' })
    fireEvent.click(retryLoad)
    await waitFor(() => expect(onLoadTranscript).toHaveBeenCalledTimes(2))
  })

  it('reruns a historical command once and clears the retrying flag after it resolves', async () => {
    const retryDeferred = deferred<void>()
    const onRetry = vi.fn(() => retryDeferred.promise)
    const closedSession: TerminalSession = { ...runningSession, status: 'closed' }
    render(<TerminalPane session={closedSession} onRetry={onRetry} onSendInput={vi.fn()} onStop={vi.fn()} />)
    const retryButton = screen.getByRole('button', { name: 'terminal:action.rerunCommand' })

    fireEvent.click(retryButton)
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith('session-1', 'standalone')
    await waitFor(() => expect(retryButton.hasAttribute('disabled')).toBe(true))

    fireEvent.click(retryButton)
    expect(onRetry).toHaveBeenCalledTimes(1)

    await act(async () => retryDeferred.resolve())
    await waitFor(() => expect(retryButton.hasAttribute('disabled')).toBe(false))
  })

  it('retries the current failed workflow terminal in workflow mode', () => {
    const onRetry = vi.fn().mockResolvedValue(undefined)
    render(
      <TerminalPane
        session={{ ...runningSession, status: 'failed' }}
        workflowRole="retryable"
        onRetry={onRetry}
        onSendInput={vi.fn()}
        onStop={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'terminal:retry.aria' }))

    expect(onRetry).toHaveBeenCalledWith('session-1', 'workflow')
    expect(screen.queryByRole('button', { name: 'terminal:action.rerunCommand' })).toBeNull()
  })

  it('distinguishes ending the workflow terminal from stopping a standalone command', () => {
    const onStop = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(
      <TerminalPane
        session={runningSession}
        workflowRole="current"
        onRetry={vi.fn()}
        onSendInput={vi.fn()}
        onStop={onStop}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'terminal:action.endAndContinue' }))
    expect(onStop).toHaveBeenCalledWith('session-1')

    rerender(
      <TerminalPane
        session={runningSession}
        workflowRole="history"
        onRetry={vi.fn()}
        onSendInput={vi.fn()}
        onStop={onStop}
      />
    )
    expect(screen.getByRole('button', { name: 'terminal:action.stopCommand' })).toBeTruthy()
  })

  it('delegates xterm wheel scroll to the registered handle', () => {
    render(<TerminalPane session={runningSession} onRetry={vi.fn()} onSendInput={vi.fn()} onStop={vi.fn()} />)
    const handler = scrollRegistrations.handlers.get(runningSession.id)
    expect(handler).toBeDefined()

    act(() => handler?.(32))
    expect(paneState.scrollBy).toHaveBeenCalledWith(32)
  })

  it('delegates TerminalOutputPane wheel scroll to the transcript element', () => {
    render(<TerminalOutputPane id="output" text="all output" />)
    const scrollByMock = vi.fn()
    const pre = screen.getByText('all output')
    ;(pre as unknown as { scrollBy: (options: { top: number }) => void }).scrollBy = scrollByMock
    const handler = scrollRegistrations.handlers.get('output')
    expect(handler).toBeDefined()

    act(() => handler?.(48))
    expect(scrollByMock).toHaveBeenCalledWith({ top: 48 })
  })

  it('uses an empty snapshot and rejects paste when the xterm handle is unavailable', async () => {
    terminalMockState.exposeHandle = false
    render(<TerminalPane session={runningSession} onRetry={vi.fn()} onSendInput={vi.fn()} onStop={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '测试打开编辑器' }))
    expect((await screen.findByRole('dialog')).getAttribute('data-markdown')).toBe('')

    fireEvent.click(screen.getByRole('button', { name: '连接输入 session-1' }))
    fireEvent.click(screen.getByRole('button', { name: '测试粘贴' }))
    expect(paneState.paste).not.toHaveBeenCalled()
  })
})
