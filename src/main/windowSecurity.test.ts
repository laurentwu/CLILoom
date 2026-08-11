import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createSecureWebPreferences,
  installDevToolsShortcut,
  installNavigationGuards,
  installPermissionHandlers,
  isTrustedIpcSender,
  isTrustedRendererUrl,
  isTrustedWindowContents,
  resolveDevelopmentServerUrl,
  resolveRendererUrl
} from './windowSecurity'

describe('window security', () => {
  it('uses sandboxed, isolated web preferences with production DevTools disabled', () => {
    expect(createSecureWebPreferences({
      preloadPath: '/application/preload.js',
      enableDevTools: false
    })).toEqual({
      preload: '/application/preload.js',
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
      devTools: false
    })
  })

  it('accepts only the repository development server origin', () => {
    expect(resolveDevelopmentServerUrl('http://127.0.0.1:5173', false)?.toString())
      .toBe('http://127.0.0.1:5173/')

    for (const value of [
      'https://127.0.0.1:5173',
      'http://localhost:5173',
      'http://[::1]:5173',
      'http://127.0.0.1:4173',
      'http://192.168.1.20:5173',
      'http://example.com',
      'http://user:password@127.0.0.1:5173',
      'http://127.0.0.1:5173/nested',
      'not a URL'
    ]) {
      expect(() => resolveDevelopmentServerUrl(value, false)).toThrow(/loopback HTTP URL|exactly/)
    }
  })

  it('ignores development URL environment values in packaged applications', () => {
    expect(resolveDevelopmentServerUrl('http://example.com', true)).toBeNull()
    expect(resolveDevelopmentServerUrl(undefined, false)).toBeNull()
  })

  it('resolves fixed development and packaged renderer entry points', () => {
    const devServerUrl = new URL('http://127.0.0.1:5173/')
    expect(resolveRendererUrl({ rendererPath: '/ignored/index.html', devServerUrl }))
      .toBe('http://127.0.0.1:5173/')
    expect(resolveRendererUrl({
      rendererPath: '/ignored/assistant.html',
      devServerUrl,
      entryPath: 'assistant.html'
    })).toBe('http://127.0.0.1:5173/assistant.html')
    expect(resolveRendererUrl({
      rendererPath: path.resolve('/application/renderer/index.html'),
      devServerUrl: null
    })).toBe('file:///application/renderer/index.html')
  })

  it('matches only the fixed renderer document while allowing hash changes', () => {
    const expected = 'http://127.0.0.1:5173/assistant.html'
    expect(isTrustedRendererUrl(expected, expected)).toBe(true)
    expect(isTrustedRendererUrl(`${expected}#settings`, expected)).toBe(true)
    expect(isTrustedRendererUrl(`${expected}?source=remote`, expected)).toBe(false)
    expect(isTrustedRendererUrl('http://127.0.0.1:5173/', expected)).toBe(false)
    expect(isTrustedRendererUrl('https://127.0.0.1:5173/assistant.html', expected)).toBe(false)
    expect(isTrustedRendererUrl('javascript:alert(1)', expected)).toBe(false)
  })

  it('blocks untrusted navigation, subframes, webviews, and new windows', () => {
    const listeners = new Map<string, (...args: never[]) => void>()
    const setWindowOpenHandler = vi.fn()
    const webContents = {
      on: vi.fn((name: string, listener: (...args: never[]) => void) => {
        listeners.set(name, listener)
      }),
      setWindowOpenHandler
    }
    const expected = 'file:///application/renderer/index.html'

    installNavigationGuards(webContents as never, expected)

    const trusted = { url: `${expected}#task`, isMainFrame: true, preventDefault: vi.fn() }
    listeners.get('will-frame-navigate')?.(trusted as never)
    expect(trusted.preventDefault).not.toHaveBeenCalled()

    for (const [name, event] of [
      ['will-frame-navigate', { url: expected, isMainFrame: false, preventDefault: vi.fn() }],
      ['will-navigate', { url: 'https://example.com', preventDefault: vi.fn() }],
      ['will-redirect', { url: 'https://example.com', preventDefault: vi.fn() }],
      ['will-attach-webview', { preventDefault: vi.fn() }]
    ] as const) {
      listeners.get(name)?.(event as never)
      expect(event.preventDefault).toHaveBeenCalledOnce()
    }

    const openHandler = setWindowOpenHandler.mock.calls[0][0] as () => { action: string }
    expect(openHandler()).toEqual({ action: 'deny' })
  })

  it('toggles DevTools only for supported keyboard shortcuts', () => {
    let listener: (...args: never[]) => void = () => undefined
    const toggleDevTools = vi.fn()
    const webContents = {
      on: vi.fn((_name: string, nextListener: (...args: never[]) => void) => {
        listener = nextListener
      }),
      toggleDevTools
    }
    installDevToolsShortcut(webContents as never)

    const trigger = (overrides: Record<string, unknown>) => {
      const event = { preventDefault: vi.fn() }
      listener(event as never, {
        type: 'keyDown',
        key: '',
        control: false,
        shift: false,
        alt: false,
        meta: false,
        isAutoRepeat: false,
        ...overrides
      } as never)
      return event
    }

    for (const input of [
      { key: 'F12' },
      { key: 'i', control: true, shift: true },
      { key: 'I', meta: true, alt: true }
    ]) {
      expect(trigger(input).preventDefault).toHaveBeenCalledOnce()
    }
    expect(toggleDevTools).toHaveBeenCalledTimes(3)

    for (const input of [
      { key: 'F12', type: 'keyUp' },
      { key: 'F12', isAutoRepeat: true },
      { key: 'i', control: true },
      { key: 'i', control: true, shift: true, alt: true }
    ]) {
      expect(trigger(input).preventDefault).not.toHaveBeenCalled()
    }
    expect(toggleDevTools).toHaveBeenCalledTimes(3)
  })

  it('trusts IPC only from the expected main frame and renderer URL', () => {
    const mainFrame = { url: 'file:///application/renderer/index.html' }
    const webContents = { mainFrame }
    const event = { sender: webContents, senderFrame: mainFrame }

    expect(isTrustedIpcSender(event as never, webContents as never, mainFrame.url)).toBe(true)
    expect(isTrustedIpcSender(
      { sender: webContents, senderFrame: { url: mainFrame.url } } as never,
      webContents as never,
      mainFrame.url
    )).toBe(false)
    expect(isTrustedIpcSender(
      { sender: webContents, senderFrame: { url: 'https://example.com' } } as never,
      webContents as never,
      mainFrame.url
    )).toBe(false)
    expect(isTrustedIpcSender(
      { sender: {}, senderFrame: mainFrame } as never,
      webContents as never,
      mainFrame.url
    )).toBe(false)
  })

  it('allows only clipboard permissions from a trusted main document', () => {
    let checkHandler: (...args: never[]) => boolean = () => false
    let requestHandler: (...args: never[]) => void = () => undefined
    let deviceHandler: (...args: never[]) => boolean = () => true
    const targetSession = {
      setPermissionCheckHandler: vi.fn((handler) => { checkHandler = handler }),
      setPermissionRequestHandler: vi.fn((handler) => { requestHandler = handler }),
      setDevicePermissionHandler: vi.fn((handler) => { deviceHandler = handler })
    }
    const trustedContents = {}
    const isTrustedSource = vi.fn((contents, url) => (
      contents === trustedContents && url === 'file:///application/renderer/index.html'
    ))
    installPermissionHandlers(targetSession as never, isTrustedSource)

    const details = { isMainFrame: true, requestingUrl: 'file:///application/renderer/index.html' }
    expect(checkHandler(trustedContents as never, 'clipboard-read' as never, '' as never, details as never))
      .toBe(true)
    expect(checkHandler(trustedContents as never, 'geolocation' as never, '' as never, details as never))
      .toBe(false)
    expect(checkHandler(null as never, 'clipboard-read' as never, '' as never, details as never))
      .toBe(false)
    expect(checkHandler(
      trustedContents as never,
      'clipboard-read' as never,
      '' as never,
      { ...details, isMainFrame: false } as never
    )).toBe(false)

    const callback = vi.fn()
    requestHandler(
      trustedContents as never,
      'clipboard-sanitized-write' as never,
      callback as never,
      details as never
    )
    expect(callback).toHaveBeenCalledWith(true)
    expect(deviceHandler({} as never)).toBe(false)
  })

  it('validates the current document before trusting window contents', () => {
    const expected = 'file:///application/renderer/index.html'
    const webContents = {
      getURL: () => expected,
      isDestroyed: () => false
    }
    expect(isTrustedWindowContents(webContents as never, webContents as never, expected)).toBe(true)
    expect(isTrustedWindowContents(
      webContents as never,
      webContents as never,
      expected,
      'https://example.com'
    )).toBe(false)
    const destroyedWebContents = { ...webContents, isDestroyed: () => true }
    expect(isTrustedWindowContents(
      destroyedWebContents as never,
      destroyedWebContents as never,
      expected
    )).toBe(false)
  })
})
