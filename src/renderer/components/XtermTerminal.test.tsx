// @vitest-environment jsdom

import { createRef, StrictMode } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { XtermTerminalHandle } from './XtermTerminal'
import type { TerminalTransport } from './terminalTransport'

type DataHandler = (data: string) => void

type TerminalMockInstance = {
  buffer: { active: unknown }
  cols: number
  dataHandler?: DataHandler
  dispose: ReturnType<typeof vi.fn>
  element: HTMLDivElement
  focus: ReturnType<typeof vi.fn>
  getSelection: ReturnType<typeof vi.fn>
  hasSelection: ReturnType<typeof vi.fn>
  loadAddon: ReturnType<typeof vi.fn>
  onData: ReturnType<typeof vi.fn>
  open: ReturnType<typeof vi.fn>
  options: Record<string, unknown>
  paste: ReturnType<typeof vi.fn>
  reset: ReturnType<typeof vi.fn>
  rows: number
  scrollLines: ReturnType<typeof vi.fn>
  write: ReturnType<typeof vi.fn>
}

const xtermState = vi.hoisted(() => ({
  fitInstances: [] as Array<{ fit: ReturnType<typeof vi.fn> }>,
  instances: [] as TerminalMockInstance[]
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: function Terminal(options: Record<string, unknown>) {
    const element = document.createElement('div')
    const instance: TerminalMockInstance = {
      buffer: {
        active: {
          baseY: 0,
          cursorY: 0,
          getLine: () => undefined,
          length: 1
        }
      },
      cols: 80,
      dispose: vi.fn(() => element.remove()),
      element,
      focus: vi.fn(),
      getSelection: vi.fn(() => ''),
      hasSelection: vi.fn(() => false),
      loadAddon: vi.fn(),
      onData: vi.fn((handler: DataHandler) => {
        instance.dataHandler = handler
        return {
          dispose: vi.fn(() => {
            instance.dataHandler = undefined
          })
        }
      }),
      open: vi.fn((host: HTMLElement) => host.appendChild(element)),
      options,
      paste: vi.fn((text: string): void => {
        instance.dataHandler?.(text)
      }),
      reset: vi.fn(),
      rows: 24,
      scrollLines: vi.fn(),
      write: vi.fn()
    }
    xtermState.instances.push(instance)
    return instance
  }
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: function FitAddon() {
    const instance = { fit: vi.fn() }
    xtermState.fitInstances.push(instance)
    return instance
  }
}))

import { disposeAllXtermSessions, XtermTerminal } from './XtermTerminal'

type AttachedEvent = { sessionId: string; taskId: string; nodeId: string }
type DataEvent = AttachedEvent & { stream: 'stdout' | 'stderr'; content: string; cursor: number }
type ClosedEvent = AttachedEvent & { exitCode: number | null; status: 'closed' | 'killed' | 'failed' }
type RestartedEvent = {
  id: string
  task_id: string
  node_id: string
  kind: string
  command: string
  cwd: string
  status: string
  transcript: string
  transcript_cursor?: number
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

function createBridge(readiness: (sessionId: string) => Promise<boolean>) {
  const attachedHandlers = new Set<(event: AttachedEvent) => void>()
  const closedHandlers = new Set<(event: ClosedEvent) => void>()
  const dataHandlers = new Set<(event: DataEvent) => void>()
  const restartedHandlers = new Set<(event: RestartedEvent) => void>()
  const unsubAttached = vi.fn()
  const unsubClosed = vi.fn()
  const unsubData = vi.fn()
  const unsubRestarted = vi.fn()
  const bridge = {
    isInputReady: vi.fn(readiness),
    onTerminalAttached: vi.fn((handler: (event: AttachedEvent) => void) => {
      attachedHandlers.add(handler)
      return () => {
        attachedHandlers.delete(handler)
        unsubAttached()
      }
    }),
    onTerminalData: vi.fn((handler: (event: DataEvent) => void) => {
      dataHandlers.add(handler)
      return () => {
        dataHandlers.delete(handler)
        unsubData()
      }
    }),
    onTerminalClosed: vi.fn((handler: (event: ClosedEvent) => void) => {
      closedHandlers.add(handler)
      return () => {
        closedHandlers.delete(handler)
        unsubClosed()
      }
    }),
    onTerminalRestarted: vi.fn((handler: (event: RestartedEvent) => void) => {
      restartedHandlers.add(handler)
      return () => {
        restartedHandlers.delete(handler)
        unsubRestarted()
      }
    }),
    resizeProcess: vi.fn().mockResolvedValue(undefined)
  }
  Object.defineProperty(window, 'cliLoom', {
    configurable: true,
    value: bridge
  })
  return {
    attachedHandlers,
    bridge,
    closedHandlers,
    dataHandlers,
    restartedHandlers,
    unsubAttached,
    unsubClosed,
    unsubData,
    unsubRestarted
  }
}

const resizeObserverInstances: Array<{
  callback: () => void
  disconnect: ReturnType<typeof vi.fn>
  observe: ReturnType<typeof vi.fn>
  unobserve: ReturnType<typeof vi.fn>
}> = []

class ResizeObserverMock {
  disconnect = vi.fn()
  observe = vi.fn()
  unobserve = vi.fn()
  callback: () => void
  constructor(callback: () => void) {
    this.callback = callback
    resizeObserverInstances.push(this)
  }
}

function triggerResizeObservers() {
  for (const instance of resizeObserverInstances) instance.callback()
}

function createTransport(options: { bufferedChunk?: string } = {}) {
  const unsubData = vi.fn()
  const unsubReady = vi.fn()
  const dataCallbacks: Array<(content: string) => void> = []
  const readyCallbacks: Array<() => void> = []
  const transport: TerminalTransport = {
    subscribeData: vi.fn((_sessionId, callback) => {
      dataCallbacks.push(callback)
      if (options.bufferedChunk !== undefined) callback(options.bufferedChunk)
      return unsubData
    }),
    subscribeReady: vi.fn((_sessionId, callback) => {
      readyCallbacks.push(callback)
      return unsubReady
    }),
    isInputReady: vi.fn(() => false),
    write: vi.fn(),
    resize: vi.fn()
  }
  return { dataCallbacks, readyCallbacks, transport, unsubData, unsubReady }
}

const session = { id: 'session-1', transcript: 'existing output' }

describe('XtermTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    xtermState.fitInstances.length = 0
    xtermState.instances.length = 0
    resizeObserverInstances.length = 0
    document.documentElement.style.removeProperty('--font-code')
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  })

  afterEach(() => {
    cleanup()
    disposeAllXtermSessions()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reserves a vertical scrollbar gutter without a visible overview ruler border', () => {
    createBridge(() => Promise.resolve(false))
    render(<XtermTerminal session={session} onSendInput={vi.fn()} />)

    expect(xtermState.instances[0].options).toMatchObject({
      fontFamily: expect.stringContaining("'JetBrains Mono Variable'"),
      overviewRuler: { width: 12 },
      theme: { overviewRulerBorder: '#00000000' }
    })
  })

  it('updates the active terminal when the theme code font changes', () => {
    createBridge(() => Promise.resolve(false))
    document.documentElement.style.setProperty('--font-code', "'Fira Code', monospace")
    const { unmount } = render(<XtermTerminal session={session} onSendInput={vi.fn()} />)
    const terminal = xtermState.instances[0]
    const fit = xtermState.fitInstances[0].fit

    expect(terminal.options.fontFamily).toBe("'Fira Code', monospace")
    const initialFitCalls = fit.mock.calls.length

    document.documentElement.style.setProperty('--font-code', "'Iosevka Term', monospace")
    act(() => document.documentElement.dispatchEvent(new Event('cliloom:code-font-change')))

    expect(terminal.options.fontFamily).toBe("'Iosevka Term', monospace")
    expect(fit).toHaveBeenCalledTimes(initialFitCalls + 1)

    unmount()
    document.documentElement.style.setProperty('--font-code', "'Fira Code', monospace")
    act(() => document.documentElement.dispatchEvent(new Event('cliloom:code-font-change')))
    expect(terminal.options.fontFamily).toBe("'Iosevka Term', monospace")
  })

  it('blocks paste until readiness resolves, then uses focus and xterm onData', async () => {
    const readiness = deferred<boolean>()
    const { bridge } = createBridge(() => readiness.promise)
    const onInputReadyChange = vi.fn()
    const onSendInput = vi.fn()
    const ref = createRef<XtermTerminalHandle>()
    render(
      <XtermTerminal
        ref={ref}
        session={session}
        onInputReadyChange={onInputReadyChange}
        onSendInput={onSendInput}
      />
    )
    const terminal = xtermState.instances[0]

    expect(ref.current?.paste('blocked')).toBe(false)
    expect(terminal.focus).not.toHaveBeenCalled()
    expect(terminal.paste).not.toHaveBeenCalled()

    await act(async () => readiness.resolve(true))
    await waitFor(() => expect(onInputReadyChange).toHaveBeenCalledWith(true))

    expect(ref.current?.paste('echo ready\r')).toBe(true)
    expect(terminal.focus).toHaveBeenCalledOnce()
    expect(terminal.paste).toHaveBeenCalledWith('echo ready\r')
    expect(terminal.focus.mock.invocationCallOrder[0]).toBeLessThan(terminal.paste.mock.invocationCallOrder[0])
    expect(onSendInput).toHaveBeenCalledWith('session-1', 'echo ready\r')
    expect(bridge.isInputReady).toHaveBeenCalledWith('session-1')
  })

  it('ignores unrelated attached events and gates keyboard data until the matching event', async () => {
    const { attachedHandlers } = createBridge(() => Promise.reject(new Error('query unavailable')))
    const onInputReadyChange = vi.fn()
    const onSendInput = vi.fn()
    render(
      <XtermTerminal
        session={session}
        onInputReadyChange={onInputReadyChange}
        onSendInput={onSendInput}
      />
    )
    const terminal = xtermState.instances[0]
    await act(async () => undefined)

    act(() => terminal.dataHandler?.('before'))
    act(() => {
      for (const handler of attachedHandlers) {
        handler({ sessionId: 'another-session', taskId: 'task', nodeId: 'node' })
      }
    })
    expect(onInputReadyChange).not.toHaveBeenCalled()
    expect(onSendInput).not.toHaveBeenCalled()

    act(() => {
      for (const handler of attachedHandlers) {
        handler({ sessionId: 'session-1', taskId: 'task', nodeId: 'node' })
      }
    })
    act(() => terminal.dataHandler?.('after'))

    expect(onInputReadyChange).toHaveBeenCalledWith(true)
    expect(onSendInput).toHaveBeenCalledOnce()
    expect(onSendInput).toHaveBeenCalledWith('session-1', 'after')
  })

  it('keeps a matching attached event authoritative over an older readiness query', async () => {
    const readiness = deferred<boolean>()
    const { attachedHandlers } = createBridge(() => readiness.promise)
    const onInputReadyChange = vi.fn()
    const ref = createRef<XtermTerminalHandle>()
    render(
      <XtermTerminal
        ref={ref}
        session={session}
        onInputReadyChange={onInputReadyChange}
        onSendInput={vi.fn()}
      />
    )

    act(() => {
      for (const handler of attachedHandlers) {
        handler({ sessionId: 'session-1', taskId: 'task', nodeId: 'node' })
      }
    })
    expect(onInputReadyChange.mock.calls.map(([ready]) => ready)).toEqual([true])

    await act(async () => readiness.resolve(false))

    expect(onInputReadyChange.mock.calls.map(([ready]) => ready)).toEqual([true])
    expect(ref.current?.paste('still ready')).toBe(true)
  })

  it('keeps read-only terminals disconnected from all input paths', () => {
    const { bridge } = createBridge(() => Promise.resolve(true))
    const onInputReadyChange = vi.fn()
    const onSendInput = vi.fn()
    const ref = createRef<XtermTerminalHandle>()
    render(
      <XtermTerminal
        ref={ref}
        readOnly
        session={session}
        onInputReadyChange={onInputReadyChange}
        onSendInput={onSendInput}
      />
    )
    const terminal = xtermState.instances[0]

    expect(terminal.options).toMatchObject({ convertEol: true, disableStdin: true })
    expect(terminal.onData).not.toHaveBeenCalled()
    expect(bridge.isInputReady).not.toHaveBeenCalled()
    expect(bridge.onTerminalAttached).not.toHaveBeenCalled()
    expect(bridge.resizeProcess).not.toHaveBeenCalled()
    expect(ref.current?.paste('blocked')).toBe(false)
    expect(onInputReadyChange).not.toHaveBeenCalled()
    expect(onSendInput).not.toHaveBeenCalled()
  })

  it('writes transcript before buffered live data and ignores other sessions', () => {
    const { bridge } = createBridge(() => Promise.resolve(false))
    bridge.onTerminalData.mockImplementationOnce((handler) => {
      handler({
        sessionId: 'another-session',
        taskId: 'task',
        nodeId: 'node',
        stream: 'stdout',
        content: 'ignore',
        cursor: 1
      })
      handler({
        sessionId: 'session-1',
        taskId: 'task',
        nodeId: 'node',
        stream: 'stdout',
        content: 'buffered live output',
        cursor: 2
      })
      return vi.fn()
    })

    render(<XtermTerminal session={session} onSendInput={vi.fn()} />)

    expect(xtermState.instances[0].write.mock.calls).toEqual([
      ['existing output'],
      ['buffered live output']
    ])
  })

  it('writes matching live data after backfill and ignores other sessions', () => {
    const { dataHandlers } = createBridge(() => Promise.resolve(false))
    render(<XtermTerminal session={session} onSendInput={vi.fn()} />)
    const terminal = xtermState.instances[0]

    act(() => {
      for (const handler of dataHandlers) {
        handler({
          sessionId: 'another-session',
          taskId: 'task',
          nodeId: 'node',
          stream: 'stdout',
          content: 'ignore',
          cursor: 1
        })
        handler({
          sessionId: 'session-1',
          taskId: 'task',
          nodeId: 'node',
          stream: 'stderr',
          content: 'live output',
          cursor: 2
        })
      }
    })

    expect(terminal.write.mock.calls).toEqual([
      ['existing output'],
      ['live output']
    ])
  })

  it('appends transcript content missed before subscription without replacing the instance', () => {
    createBridge(() => Promise.resolve(false))
    const { rerender } = render(
      <XtermTerminal
        persistent
        session={{ ...session, cursor: 1 }}
        onSendInput={vi.fn()}
      />
    )
    const terminal = xtermState.instances[0]

    rerender(
      <XtermTerminal
        readOnly
        session={{
          ...session,
          cursor: 2,
          transcript: 'existing outputfinal output missed before subscription'
        }}
        onSendInput={vi.fn()}
      />
    )

    expect(xtermState.instances).toHaveLength(1)
    expect(terminal.write.mock.calls).toEqual([
      ['existing output'],
      ['final output missed before subscription']
    ])
    expect(terminal.reset).not.toHaveBeenCalled()

    rerender(
      <XtermTerminal
        readOnly
        session={{
          ...session,
          cursor: 2,
          transcript: 'existing outputfinal output missed before subscription'
        }}
        onSendInput={vi.fn()}
      />
    )
    expect(terminal.write).toHaveBeenCalledTimes(2)
  })

  it('does not replay transcript content already received through the live cursor', () => {
    const { dataHandlers } = createBridge(() => Promise.resolve(false))
    const { rerender } = render(
      <XtermTerminal
        persistent
        session={{ ...session, cursor: 1 }}
        onSendInput={vi.fn()}
      />
    )
    const terminal = xtermState.instances[0]

    act(() => {
      for (const handler of dataHandlers) {
        handler({
          sessionId: 'session-1',
          taskId: 'task-1',
          nodeId: 'node',
          stream: 'stdout',
          content: 'live cursor output',
          cursor: 2
        })
      }
    })
    rerender(
      <XtermTerminal
        persistent
        session={{
          ...session,
          cursor: 2,
          transcript: 'existing outputlive cursor output'
        }}
        onSendInput={vi.fn()}
      />
    )

    expect(terminal.write.mock.calls).toEqual([
      ['existing output'],
      ['live cursor output']
    ])
    expect(terminal.reset).not.toHaveBeenCalled()
  })

  it('resets readiness and subscriptions when switching sessions', async () => {
    const secondReadiness = deferred<boolean>()
    const { bridge, unsubAttached, unsubData } = createBridge((sessionId) => (
      sessionId === 'session-1' ? Promise.resolve(true) : secondReadiness.promise
    ))
    const onInputReadyChange = vi.fn()
    const { rerender } = render(
      <XtermTerminal
        session={session}
        onInputReadyChange={onInputReadyChange}
        onSendInput={vi.fn()}
      />
    )
    await waitFor(() => expect(onInputReadyChange).toHaveBeenLastCalledWith(true))
    const firstTerminal = xtermState.instances[0]

    rerender(
      <XtermTerminal
        session={{ id: 'session-2', transcript: 'new session' }}
        onInputReadyChange={onInputReadyChange}
        onSendInput={vi.fn()}
      />
    )

    expect(onInputReadyChange).toHaveBeenLastCalledWith(false)
    expect(firstTerminal.dispose).toHaveBeenCalledOnce()
    expect(unsubAttached).toHaveBeenCalledOnce()
    expect(unsubData).toHaveBeenCalledOnce()
    expect(bridge.isInputReady).toHaveBeenLastCalledWith('session-2')

    await act(async () => secondReadiness.resolve(true))
    await waitFor(() => expect(onInputReadyChange).toHaveBeenLastCalledWith(true))
    expect(onInputReadyChange.mock.calls.map(([ready]) => ready)).toEqual([true, false, true])
  })

  it('keeps one live xterm instance and subscription across detach and reattach', () => {
    const {
      bridge,
      closedHandlers,
      dataHandlers,
      unsubAttached,
      unsubClosed,
      unsubData,
      unsubRestarted
    } = createBridge(() => Promise.resolve(true))
    const first = render(
      <XtermTerminal persistent session={session} onSendInput={vi.fn()} />
    )
    const terminal = xtermState.instances[0]

    expect(xtermState.instances).toHaveLength(1)
    expect(terminal.write.mock.calls).toEqual([['existing output']])
    expect(bridge.resizeProcess).toHaveBeenCalledTimes(1)

    first.unmount()
    expect(terminal.dispose).not.toHaveBeenCalled()
    expect(unsubAttached).not.toHaveBeenCalled()
    expect(unsubClosed).not.toHaveBeenCalled()
    expect(unsubData).not.toHaveBeenCalled()
    expect(unsubRestarted).not.toHaveBeenCalled()

    act(() => {
      for (const handler of dataHandlers) {
        handler({
          sessionId: 'session-1',
          taskId: 'task-1',
          nodeId: 'node',
          stream: 'stdout',
          content: 'output while another task is selected',
          cursor: 1
        })
      }
    })
    expect(terminal.write).toHaveBeenLastCalledWith('output while another task is selected')

    const second = render(
      <XtermTerminal
        persistent
        session={{
          id: 'session-1',
          transcript: 'existing outputoutput while another task is selected'
        }}
        onSendInput={vi.fn()}
      />
    )

    expect(xtermState.instances).toHaveLength(1)
    expect(terminal.write.mock.calls).toEqual([
      ['existing output'],
      ['output while another task is selected']
    ])
    expect(terminal.element.parentElement).toBe(second.container.querySelector('.xterm-host'))
    expect(bridge.resizeProcess).toHaveBeenCalledTimes(1)

    second.unmount()
    act(() => {
      for (const handler of closedHandlers) {
        handler({
          sessionId: 'session-1',
          taskId: 'task-1',
          nodeId: 'node',
          exitCode: 0,
          status: 'closed'
        })
      }
    })

    expect(terminal.dispose).toHaveBeenCalledOnce()
    expect(unsubAttached).toHaveBeenCalledOnce()
    expect(unsubClosed).toHaveBeenCalledOnce()
    expect(unsubData).toHaveBeenCalledOnce()
    expect(unsubRestarted).toHaveBeenCalledOnce()
  })

  it('requires fresh readiness after a retained terminal is reattached', async () => {
    const reattachedReadiness = deferred<boolean>()
    let readinessCalls = 0
    const { bridge } = createBridge(() => {
      readinessCalls += 1
      return readinessCalls === 1 ? Promise.resolve(true) : reattachedReadiness.promise
    })
    const onInputReadyChange = vi.fn()
    const first = render(
      <XtermTerminal
        persistent
        session={session}
        onInputReadyChange={onInputReadyChange}
        onSendInput={vi.fn()}
      />
    )
    const terminal = xtermState.instances[0]
    await waitFor(() => expect(onInputReadyChange).toHaveBeenLastCalledWith(true))

    first.unmount()
    expect(onInputReadyChange.mock.calls.map(([ready]) => ready)).toEqual([true, false])

    const secondRef = createRef<XtermTerminalHandle>()
    render(
      <XtermTerminal
        ref={secondRef}
        persistent
        session={session}
        onInputReadyChange={onInputReadyChange}
        onSendInput={vi.fn()}
      />
    )

    expect(xtermState.instances).toHaveLength(1)
    expect(xtermState.instances[0]).toBe(terminal)
    expect(bridge.isInputReady).toHaveBeenCalledTimes(2)
    expect(onInputReadyChange.mock.calls.map(([ready]) => ready)).toEqual([true, false])
    expect(secondRef.current?.paste('not ready yet')).toBe(false)

    await act(async () => reattachedReadiness.resolve(false))
    expect(onInputReadyChange.mock.calls.map(([ready]) => ready)).toEqual([true, false])
  })

  it('resets an attached retained instance when its session restarts', async () => {
    const { bridge, restartedHandlers } = createBridge(() => Promise.resolve(true))
    const onInputReadyChange = vi.fn()
    render(
      <XtermTerminal
        persistent
        session={{ ...session, cursor: 1 }}
        onInputReadyChange={onInputReadyChange}
        onSendInput={vi.fn()}
      />
    )
    const terminal = xtermState.instances[0]
    await waitFor(() => expect(onInputReadyChange).toHaveBeenLastCalledWith(true))
    const initialResizeCalls = bridge.resizeProcess.mock.calls.length

    act(() => {
      for (const handler of restartedHandlers) {
        handler({
          id: 'session-1',
          task_id: 'task-1',
          node_id: 'node',
          kind: 'interactive',
          command: 'retry',
          cwd: '/repo',
          status: 'running',
          transcript: 'fresh retry output',
          transcript_cursor: 2
        })
      }
    })

    expect(xtermState.instances).toHaveLength(1)
    expect(terminal.reset).toHaveBeenCalledOnce()
    expect(terminal.write).toHaveBeenLastCalledWith('fresh retry output')
    expect(onInputReadyChange).toHaveBeenLastCalledWith(false)
    expect(bridge.resizeProcess).toHaveBeenCalledTimes(initialResizeCalls + 1)
    expect(terminal.dispose).not.toHaveBeenCalled()
  })

  it('resets a detached retained instance on restart and reattaches it without replaying twice', () => {
    const { bridge, restartedHandlers } = createBridge(() => Promise.resolve(false))
    const first = render(
      <XtermTerminal persistent session={{ ...session, cursor: 1 }} onSendInput={vi.fn()} />
    )
    const terminal = xtermState.instances[0]
    const initialResizeCalls = bridge.resizeProcess.mock.calls.length
    first.unmount()

    act(() => {
      for (const handler of restartedHandlers) {
        handler({
          id: 'session-1',
          task_id: 'task-1',
          node_id: 'node',
          kind: 'interactive',
          command: 'retry',
          cwd: '/repo',
          status: 'running',
          transcript: 'fresh detached retry output',
          transcript_cursor: 2
        })
      }
    })

    expect(terminal.reset).toHaveBeenCalledOnce()
    expect(terminal.write.mock.calls).toEqual([
      ['existing output'],
      ['fresh detached retry output']
    ])
    expect(bridge.resizeProcess).toHaveBeenCalledTimes(initialResizeCalls)
    expect(terminal.dispose).not.toHaveBeenCalled()

    const second = render(
      <XtermTerminal
        persistent
        session={{
          id: 'session-1',
          transcript: 'fresh detached retry output',
          cursor: 2
        }}
        onSendInput={vi.fn()}
      />
    )

    expect(xtermState.instances).toHaveLength(1)
    expect(xtermState.instances[0]).toBe(terminal)
    expect(terminal.write).toHaveBeenCalledTimes(2)
    expect(bridge.resizeProcess).toHaveBeenCalledTimes(initialResizeCalls + 1)
    expect(terminal.element.parentElement).toBe(second.container.querySelector('.xterm-host'))
  })

  it('keeps an attached closed instance until detach and ignores an older readiness query', async () => {
    const staleReadiness = deferred<boolean>()
    let readinessCalls = 0
    const {
      bridge,
      closedHandlers,
      unsubAttached,
      unsubClosed,
      unsubData,
      unsubRestarted
    } = createBridge(() => {
      readinessCalls += 1
      return readinessCalls === 1 ? Promise.resolve(true) : staleReadiness.promise
    })
    const onInputReadyChange = vi.fn()
    const { rerender, unmount } = render(
      <XtermTerminal
        persistent
        session={session}
        onInputReadyChange={onInputReadyChange}
        onSendInput={vi.fn()}
      />
    )
    const terminal = xtermState.instances[0]
    await waitFor(() => expect(onInputReadyChange).toHaveBeenLastCalledWith(true))

    rerender(
      <XtermTerminal
        session={session}
        onInputReadyChange={onInputReadyChange}
        onSendInput={vi.fn()}
      />
    )
    expect(bridge.isInputReady).toHaveBeenCalledTimes(2)
    onInputReadyChange.mockClear()

    act(() => {
      for (const handler of closedHandlers) {
        handler({
          sessionId: 'session-1',
          taskId: 'task-1',
          nodeId: 'node',
          exitCode: 0,
          status: 'closed'
        })
      }
    })

    expect(onInputReadyChange.mock.calls.map(([ready]) => ready)).toEqual([false])
    expect(terminal.dispose).not.toHaveBeenCalled()
    expect(unsubAttached).not.toHaveBeenCalled()
    expect(unsubClosed).not.toHaveBeenCalled()
    expect(unsubData).not.toHaveBeenCalled()
    expect(unsubRestarted).not.toHaveBeenCalled()

    await act(async () => staleReadiness.resolve(true))
    expect(onInputReadyChange.mock.calls.map(([ready]) => ready)).toEqual([false])

    unmount()
    expect(terminal.dispose).toHaveBeenCalledOnce()
    expect(unsubAttached).toHaveBeenCalledOnce()
    expect(unsubClosed).toHaveBeenCalledOnce()
    expect(unsubData).toHaveBeenCalledOnce()
    expect(unsubRestarted).toHaveBeenCalledOnce()
  })

  it('reuses the live instance through React Strict Mode effect remounting', () => {
    const { bridge } = createBridge(() => Promise.resolve(true))

    render(
      <StrictMode>
        <XtermTerminal persistent session={session} onSendInput={vi.fn()} />
      </StrictMode>
    )

    expect(xtermState.instances).toHaveLength(1)
    expect(xtermState.instances[0].write).toHaveBeenCalledOnce()
    expect(xtermState.instances[0].write).toHaveBeenCalledWith('existing output')
    expect(bridge.resizeProcess).toHaveBeenCalledOnce()
  })

  it('changes a retained terminal to read-only without replacing its xterm instance', () => {
    createBridge(() => Promise.resolve(true))
    const { rerender, unmount } = render(
      <XtermTerminal persistent session={session} onSendInput={vi.fn()} />
    )
    const terminal = xtermState.instances[0]

    rerender(
      <XtermTerminal readOnly session={session} onSendInput={vi.fn()} />
    )

    expect(xtermState.instances).toHaveLength(1)
    expect(terminal.options).toMatchObject({ convertEol: true, disableStdin: true })
    expect(terminal.dispose).not.toHaveBeenCalled()

    unmount()
    expect(terminal.dispose).toHaveBeenCalledOnce()
  })

  it('requires fresh readiness after a retained terminal becomes writable again', async () => {
    const writableAgainReadiness = deferred<boolean>()
    let readinessCalls = 0
    createBridge(() => {
      readinessCalls += 1
      return readinessCalls === 1 ? Promise.resolve(true) : writableAgainReadiness.promise
    })
    const onInputReadyChange = vi.fn()
    const { rerender } = render(
      <XtermTerminal
        persistent
        session={session}
        onInputReadyChange={onInputReadyChange}
        onSendInput={vi.fn()}
      />
    )
    await waitFor(() => expect(onInputReadyChange).toHaveBeenLastCalledWith(true))

    rerender(
      <XtermTerminal
        persistent
        readOnly
        session={session}
        onInputReadyChange={onInputReadyChange}
        onSendInput={vi.fn()}
      />
    )
    rerender(
      <XtermTerminal
        persistent
        session={session}
        onInputReadyChange={onInputReadyChange}
        onSendInput={vi.fn()}
      />
    )

    expect(onInputReadyChange.mock.calls.map(([ready]) => ready)).toEqual([true, false])
    await act(async () => writableAgainReadiness.resolve(false))
    expect(onInputReadyChange.mock.calls.map(([ready]) => ready)).toEqual([true, false])
  })

  it('returns the active xterm selection through its narrow handle', () => {
    createBridge(() => Promise.resolve(false))
    const ref = createRef<XtermTerminalHandle>()
    render(<XtermTerminal ref={ref} session={session} onSendInput={vi.fn()} />)
    const terminal = xtermState.instances[0]
    terminal.hasSelection.mockReturnValue(true)
    terminal.getSelection.mockReturnValue('selected output')

    expect(ref.current?.getTextSnapshot()).toEqual({
      source: 'selection',
      text: 'selected output'
    })
    ref.current?.focus()
    expect(terminal.focus).toHaveBeenCalledOnce()
  })

  it('accumulates wheel pixels into whole xterm scroll lines', () => {
    createBridge(() => Promise.resolve(false))
    const ref = createRef<XtermTerminalHandle>()
    render(<XtermTerminal ref={ref} session={session} onSendInput={vi.fn()} />)
    const terminal = xtermState.instances[0]

    ref.current?.scrollBy(8)
    expect(terminal.scrollLines).not.toHaveBeenCalled()
    ref.current?.scrollBy(8)
    ref.current?.scrollBy(-32)

    expect(terminal.scrollLines.mock.calls).toEqual([[1], [-2]])
  })

  it('uses the transport for transcript/buffered order, live data, readiness, input and resize', async () => {
    const { dataCallbacks, readyCallbacks, transport, unsubData, unsubReady } = createTransport({ bufferedChunk: 'buffered live output' })
    const onSendInput = vi.fn()
    const ref = createRef<XtermTerminalHandle>()
    const { unmount } = render(
      <XtermTerminal ref={ref} session={session} transport={transport} onSendInput={onSendInput} />
    )
    const terminal = xtermState.instances[0]
    const observer = resizeObserverInstances[0]

    expect(terminal.write.mock.calls).toEqual([
      ['existing output'],
      ['buffered live output']
    ])

    act(() => {
      for (const callback of dataCallbacks) callback('live output')
    })
    expect(terminal.write).toHaveBeenLastCalledWith('live output')

    act(() => {
      for (const callback of readyCallbacks) callback()
    })

    act(() => terminal.dataHandler?.('typed'))
    expect(transport.write).toHaveBeenCalledWith('session-1', 'typed')
    expect(onSendInput).not.toHaveBeenCalled()

    expect(transport.resize).toHaveBeenCalledWith('session-1', 80, 24)

    unmount()

    expect(unsubData).toHaveBeenCalledTimes(1)
    expect(unsubReady).toHaveBeenCalledTimes(1)
    expect(observer.disconnect).toHaveBeenCalledTimes(1)
    expect(terminal.dispose).toHaveBeenCalledTimes(1)
    expect(terminal.dataHandler).toBeUndefined()
  })

  it('skips resize when fit reports non-positive dimensions and resizes once positive', () => {
    const { transport } = createTransport()
    render(<XtermTerminal session={session} transport={transport} />)
    const terminal = xtermState.instances[0]
    vi.mocked(transport.resize).mockClear()

    terminal.cols = 0
    act(() => triggerResizeObservers())
    expect(transport.resize).not.toHaveBeenCalled()

    terminal.cols = 100
    act(() => triggerResizeObservers())
    expect(transport.resize).toHaveBeenCalledWith('session-1', 100, terminal.rows)
  })

  it('does not write a placeholder when transcript and buffered data are empty', () => {
    const { transport } = createTransport()
    render(<XtermTerminal session={{ id: 'session-1', transcript: '' }} transport={transport} />)

    expect(xtermState.instances[0].write).not.toHaveBeenCalled()
  })

  it('keeps the narrow handle safe after unmount', () => {
    const { transport } = createTransport()
    const ref = createRef<XtermTerminalHandle>()
    const { unmount } = render(<XtermTerminal ref={ref} session={session} transport={transport} />)
    const handle = ref.current!
    unmount()

    expect(handle.getTextSnapshot()).toEqual({ source: 'all', text: '' })
    expect(() => handle.scrollBy(16)).not.toThrow()
    expect(() => handle.focus()).not.toThrow()
    expect(handle.paste('x')).toBe(false)
  })
})
