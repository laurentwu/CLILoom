import { BrowserWindow, screen, type WebContents } from 'electron'
import { t } from './i18n'
import type { SettingsService } from './settingsService'
import type { AssistantTerminalService } from './assistantTerminalService'
import { clampWindowBounds } from './windowState'
import {
  createSecureWebPreferences,
  installDevToolsShortcut,
  installNavigationGuards,
  isTrustedIpcSender,
  isTrustedWindowContents,
  resolveRendererUrl,
  type IpcSenderEvent
} from './windowSecurity'

const THEME_READY_TIMEOUT_MS = 5_000
const WINDOW_STATE_DEBOUNCE_MS = 300

export class AssistantWindowManager {
  private window: BrowserWindow | null = null
  private showRequested = false
  private themeReady = false
  private allowDestroy = false
  private stateTimer: NodeJS.Timeout | null = null
  private themeTimer: NodeJS.Timeout | null = null
  private closing: Promise<void> | null = null
  private opening: Promise<void> | null = null
  private rendererUrl: string | null = null

  constructor(private readonly options: {
    settingsService: SettingsService
    terminalService: AssistantTerminalService
    preloadPath: string
    rendererPath: string
    enableDevTools: boolean
    devServerUrl?: URL
  }) {
    options.terminalService.onData((content) => {
      this.send('assistant:terminal-data', { content })
    })
    options.terminalService.onStatus((status) => {
      this.send('assistant:terminal-status', status)
    })
  }

  open(): Promise<void> {
    if (this.opening) return this.opening
    this.opening = this.performOpen().finally(() => {
      this.opening = null
    })
    return this.opening
  }

  private async performOpen(): Promise<void> {
    this.showRequested = true
    const window = this.ensureWindow()
    if (this.themeReady) {
      window.show()
      window.focus()
    }
    const command = this.options.settingsService.getSnapshot().assistant.initializationCommand
    if (command && this.options.terminalService.getStatus().state === 'idle') {
      try {
        await this.options.terminalService.start(command)
      } catch {
        // The renderer receives the failed status and offers settings.
      }
    }
  }

  hide(): void {
    this.showRequested = false
    this.window?.hide()
  }

  markThemeReady(event: IpcSenderEvent): void {
    if (!this.isSender(event)) throw new Error(t('errors:sender.assistantInvalid'))
    this.themeReady = true
    if (this.themeTimer) clearTimeout(this.themeTimer)
    this.themeTimer = null
    if (this.showRequested && this.window) {
      this.window.show()
      this.window.focus()
    }
  }

  getWindow(): BrowserWindow | null {
    return this.window
  }

  isSender(event: IpcSenderEvent): boolean {
    return Boolean(
      this.window &&
      !this.window.isDestroyed() &&
      this.rendererUrl &&
      isTrustedIpcSender(event, this.window.webContents, this.rendererUrl)
    )
  }

  isTrustedContents(sender: WebContents | null, requestingUrl?: string): boolean {
    return Boolean(
      this.window &&
      !this.window.isDestroyed() &&
      this.rendererUrl &&
      isTrustedWindowContents(
        sender,
        this.window.webContents,
        this.rendererUrl,
        requestingUrl
      )
    )
  }

  send(channel: string, payload: unknown): void {
    if (!this.window || this.window.isDestroyed()) return
    this.window.webContents.send(channel, payload)
  }

  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closing = this.performClose().finally(() => {
      this.closing = null
    })
    return this.closing
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window
    const rendererUrl = resolveRendererUrl({
      rendererPath: this.options.rendererPath,
      devServerUrl: this.options.devServerUrl ?? null,
      entryPath: 'assistant.html'
    })
    const primary = screen.getPrimaryDisplay().workArea
    const saved = this.options.settingsService.getAssistantWindowState()?.bounds
    const bounds = clampWindowBounds(
      saved ?? centeredBounds(primary, 1_000, 680),
      screen.getAllDisplays().map((display) => display.workArea),
      primary
    )
    const window = new BrowserWindow({
      ...bounds,
      minWidth: 640,
      minHeight: 480,
      frame: false,
      show: false,
      backgroundColor: '#0a0a0a',
      title: t('assistant:label.windowTitle'),
      webPreferences: createSecureWebPreferences({
        preloadPath: this.options.preloadPath,
        enableDevTools: this.options.enableDevTools
      })
    })
    this.window = window
    this.rendererUrl = rendererUrl
    this.themeReady = false
    this.allowDestroy = false
    installDevToolsShortcut(window.webContents)
    installNavigationGuards(window.webContents, rendererUrl)
    this.installWindowListeners(window)
    void window.loadURL(rendererUrl).catch((error) => {
      console.error('Failed to load assistant renderer:', error)
    })
    this.themeTimer = setTimeout(() => {
      if (window !== this.window || window.isDestroyed()) return
      this.themeReady = true
      this.send('assistant:theme-fallback', { skin: this.options.settingsService.resolveActiveSkin() })
      if (this.showRequested) window.show()
    }, THEME_READY_TIMEOUT_MS)
    return window
  }

  private installWindowListeners(window: BrowserWindow): void {
    const scheduleStateSave = () => {
      if (window.isDestroyed() || window.isMinimized() || window.isMaximized()) return
      if (this.stateTimer) clearTimeout(this.stateTimer)
      this.stateTimer = setTimeout(() => {
        if (window.isDestroyed() || window.isMinimized() || window.isMaximized()) return
        this.options.settingsService.setAssistantWindowState({
          version: 1,
          bounds: window.getBounds()
        })
      }, WINDOW_STATE_DEBOUNCE_MS)
    }
    window.on('move', scheduleStateSave)
    window.on('resize', scheduleStateSave)
    window.on('close', (event) => {
      if (this.allowDestroy) return
      event.preventDefault()
      void this.close()
    })
    window.on('closed', () => {
      if (this.themeTimer) clearTimeout(this.themeTimer)
      if (this.stateTimer) clearTimeout(this.stateTimer)
      this.themeTimer = null
      this.stateTimer = null
      if (this.window === window) {
        this.window = null
        this.rendererUrl = null
      }
      this.allowDestroy = false
      this.themeReady = false
      this.showRequested = false
    })
  }

  private async performClose(): Promise<void> {
    this.showRequested = false
    await this.options.terminalService.close()
    const window = this.window
    if (!window || window.isDestroyed()) return
    this.saveBoundsNow(window)
    this.allowDestroy = true
    window.destroy()
  }

  private saveBoundsNow(window: BrowserWindow): void {
    if (window.isDestroyed() || window.isMinimized() || window.isMaximized()) return
    this.options.settingsService.setAssistantWindowState({
      version: 1,
      bounds: window.getBounds()
    })
  }

  refreshTitle(): void {
    const window = this.window
    if (!window || window.isDestroyed()) return
    window.setTitle(t('assistant:label.windowTitle'))
  }
}

function centeredBounds(
  area: Electron.Rectangle,
  desiredWidth: number,
  desiredHeight: number
): Electron.Rectangle {
  const width = Math.min(desiredWidth, area.width)
  const height = Math.min(desiredHeight, area.height)
  return {
    x: area.x + Math.floor((area.width - width) / 2),
    y: area.y + Math.floor((area.height - height) / 2),
    width,
    height
  }
}
