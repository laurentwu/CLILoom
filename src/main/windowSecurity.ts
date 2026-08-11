import { pathToFileURL } from 'node:url'
import type {
  IpcMainEvent,
  IpcMainInvokeEvent,
  Session,
  WebContents,
  WebPreferences
} from 'electron'

const ALLOWED_PERMISSIONS = new Set([
  'clipboard-read',
  'clipboard-sanitized-write'
])
const DEVELOPMENT_SERVER_ORIGIN = 'http://127.0.0.1:5173'

export type IpcSenderEvent = Pick<
  IpcMainEvent | IpcMainInvokeEvent,
  'sender' | 'senderFrame'
>

export function createSecureWebPreferences(options: {
  preloadPath: string
  enableDevTools: boolean
}): WebPreferences {
  return {
    preload: options.preloadPath,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    navigateOnDragDrop: false,
    enableWebSQL: false,
    safeDialogs: true,
    devTools: options.enableDevTools
  }
}

export function resolveDevelopmentServerUrl(
  value: string | undefined,
  isPackaged: boolean
): URL | null {
  if (isPackaged || value === undefined || value.trim() === '') return null

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error('VITE_DEV_SERVER_URL must be a valid loopback HTTP URL')
  }

  if (
    parsed.protocol !== 'http:' ||
    parsed.origin !== DEVELOPMENT_SERVER_ORIGIN ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`VITE_DEV_SERVER_URL must be exactly ${DEVELOPMENT_SERVER_ORIGIN}`)
  }

  return new URL('/', parsed.origin)
}

export function resolveRendererUrl(options: {
  rendererPath: string
  devServerUrl: URL | null
  entryPath?: string
}): string {
  if (!options.devServerUrl) return pathToFileURL(options.rendererPath).toString()
  return new URL(options.entryPath ?? '', options.devServerUrl).toString()
}

export function isTrustedRendererUrl(candidate: string, expected: string): boolean {
  let candidateUrl: URL
  let expectedUrl: URL
  try {
    candidateUrl = new URL(candidate)
    expectedUrl = new URL(expected)
  } catch {
    return false
  }

  return candidateUrl.protocol === expectedUrl.protocol &&
    candidateUrl.username === expectedUrl.username &&
    candidateUrl.password === expectedUrl.password &&
    candidateUrl.host === expectedUrl.host &&
    candidateUrl.pathname === expectedUrl.pathname &&
    candidateUrl.search === expectedUrl.search
}

export function installNavigationGuards(
  webContents: WebContents,
  trustedRendererUrl: string
): void {
  const preventUntrustedNavigation = (event: Electron.Event & { url: string }) => {
    if (!isTrustedRendererUrl(event.url, trustedRendererUrl)) event.preventDefault()
  }

  webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame || !isTrustedRendererUrl(event.url, trustedRendererUrl)) {
      event.preventDefault()
    }
  })
  webContents.on('will-navigate', preventUntrustedNavigation)
  webContents.on('will-redirect', preventUntrustedNavigation)
  webContents.on('will-attach-webview', (event) => event.preventDefault())
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
}

export function installDevToolsShortcut(webContents: WebContents): void {
  webContents.on('before-input-event', (event, input) => {
    if (!isDevToolsShortcut(input)) return
    event.preventDefault()
    webContents.toggleDevTools()
  })
}

function isDevToolsShortcut(input: Electron.Input): boolean {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return false

  if (
    input.key === 'F12' &&
    !input.control &&
    !input.shift &&
    !input.alt &&
    !input.meta
  ) {
    return true
  }

  if (input.key.toLowerCase() !== 'i') return false
  const controlShiftI = input.control && input.shift && !input.alt && !input.meta
  const commandOptionI = input.meta && input.alt && !input.control && !input.shift
  return controlShiftI || commandOptionI
}

export function isTrustedIpcSender(
  event: IpcSenderEvent,
  expectedWebContents: WebContents,
  trustedRendererUrl: string
): boolean {
  if (event.sender !== expectedWebContents || event.senderFrame === null) return false
  if (event.senderFrame !== expectedWebContents.mainFrame) return false
  return isTrustedRendererUrl(event.senderFrame.url, trustedRendererUrl)
}

export function isTrustedWindowContents(
  candidate: WebContents | null,
  expectedWebContents: WebContents,
  trustedRendererUrl: string,
  requestingUrl?: string
): boolean {
  if (candidate !== expectedWebContents || candidate.isDestroyed()) return false
  const candidateUrl = requestingUrl || candidate.getURL()
  return isTrustedRendererUrl(candidateUrl, trustedRendererUrl)
}

export function installPermissionHandlers(
  targetSession: Session,
  isTrustedSource: (webContents: WebContents, requestingUrl?: string) => boolean
): void {
  targetSession.setPermissionCheckHandler((webContents, permission, _origin, details) => (
    webContents !== null &&
    details.isMainFrame &&
    ALLOWED_PERMISSIONS.has(permission) &&
    isTrustedSource(webContents, details.requestingUrl)
  ))
  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(
      details.isMainFrame &&
      ALLOWED_PERMISSIONS.has(permission) &&
      isTrustedSource(webContents, details.requestingUrl)
    )
  })
  targetSession.setDevicePermissionHandler(() => false)
}
