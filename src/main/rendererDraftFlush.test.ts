import { EventEmitter } from 'node:events'
import type { BrowserWindow, IpcMain, IpcMainEvent, WebContents } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForRendererDraftFlush } from './rendererDraftFlush'

function createHarness() {
  const ipc = new EventEmitter()
  const webContents = { send: vi.fn() } as unknown as WebContents
  const window = {
    isDestroyed: vi.fn(() => false),
    webContents
  } as unknown as BrowserWindow
  return {
    ipc,
    typedIpc: ipc as unknown as Pick<IpcMain, 'on' | 'removeListener'>,
    webContents,
    window
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('renderer draft close handshake', () => {
  it('stops waiting after the timeout when the renderer does not respond', async () => {
    vi.useFakeTimers()
    const { ipc, typedIpc, webContents, window } = createHarness()
    const operation = waitForRendererDraftFlush(window, typedIpc, () => true, 2_000)
    let completed = false
    void operation.then(() => {
      completed = true
    })

    expect(webContents.send).toHaveBeenCalledWith('app:prepare-to-close')
    expect(ipc.listenerCount('app:renderer-ready-to-close')).toBe(1)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(completed).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await operation

    expect(completed).toBe(true)
    expect(ipc.listenerCount('app:renderer-ready-to-close')).toBe(0)
  })

  it('ignores unrelated acknowledgements and accepts the trusted window', async () => {
    vi.useFakeTimers()
    const { ipc, typedIpc, webContents, window } = createHarness()
    const isTrustedSender = vi.fn((event: IpcMainEvent) => event.sender === webContents)
    const operation = waitForRendererDraftFlush(window, typedIpc, isTrustedSender)
    let completed = false
    void operation.then(() => {
      completed = true
    })

    ipc.emit('app:renderer-ready-to-close', { sender: {} })
    await Promise.resolve()
    expect(completed).toBe(false)

    ipc.emit('app:renderer-ready-to-close', { sender: webContents })
    await operation

    expect(completed).toBe(true)
    expect(ipc.listenerCount('app:renderer-ready-to-close')).toBe(0)
  })
})
