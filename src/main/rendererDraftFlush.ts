import type { BrowserWindow, IpcMain, IpcMainEvent } from 'electron'

export const RENDERER_DRAFT_FLUSH_TIMEOUT_MS = 2_000

export function waitForRendererDraftFlush(
  window: BrowserWindow,
  ipc: Pick<IpcMain, 'on' | 'removeListener'>,
  isTrustedSender: (event: IpcMainEvent) => boolean,
  timeoutMs = RENDERER_DRAFT_FLUSH_TIMEOUT_MS
): Promise<void> {
  if (window.isDestroyed()) return Promise.resolve()

  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      ipc.removeListener('app:renderer-ready-to-close', onReady)
      resolve()
    }
    const timeout = setTimeout(finish, timeoutMs)
    const onReady = (event: IpcMainEvent) => {
      if (event.sender !== window.webContents || !isTrustedSender(event)) return
      finish()
    }

    ipc.on('app:renderer-ready-to-close', onReady)
    try {
      window.webContents.send('app:prepare-to-close')
    } catch {
      finish()
    }
  })
}
