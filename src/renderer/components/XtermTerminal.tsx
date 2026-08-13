import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { CODE_FONT_CHANGE_EVENT, getAppliedCodeFontStack } from '../fonts'
import { getTerminalTextSnapshot, type TerminalTextSnapshot } from '../terminalText'
import type { TerminalTransport } from './terminalTransport'
import {
  appendBoundedText,
  MAX_TERMINAL_TRANSCRIPT_CHARS
} from '../../shared/terminalBuffer'
import '@xterm/xterm/css/xterm.css'

type Session = { cursor?: number | null; id: string; transcript: string }

type TerminalBinding = {
  isReadOnly: () => boolean
  shouldPersist: () => boolean
  onInputReadyChange: () => ((ready: boolean) => void) | undefined
  onSendInput: () => ((sessionId: string, input: string) => void) | undefined
}

type TerminalAttachment = {
  binding: TerminalBinding
  host: HTMLDivElement
  observer: ResizeObserver
  token: symbol
}

type TerminalEntry = {
  attachment: TerminalAttachment | null
  closed: boolean
  disposed: boolean
  fit: FitAddon
  handleCodeFontChange: () => void
  inputDisposable?: { dispose: () => void }
  inputReady: boolean
  lastRemoteDimensions: { cols: number; rows: number } | null
  live: boolean
  pendingScroll: number
  readinessRequest: number
  renderedTranscript: string
  renderedTranscriptCursor: number | null
  sessionId: string
  terminal: Terminal
  transport?: TerminalTransport
  unsubAttached?: () => void
  unsubClosed?: () => void
  unsubData?: () => void
  unsubRestarted?: () => void
}

const TERMINAL_SCROLLBAR_GUTTER_WIDTH = 12
// Running sessions outlive whichever task/node view currently owns their host.
// Keep the emulator and IPC subscriptions keyed by session, then reparent its DOM on return.
const terminalEntries = new Map<string, TerminalEntry>()

function notifyInputReady(entry: TerminalEntry): void {
  const attachment = entry.attachment
  if (!attachment || !entry.inputReady) return
  attachment.binding.onInputReadyChange()?.(!attachment.binding.isReadOnly())
}

function setInputReady(entry: TerminalEntry, ready: boolean): void {
  if (entry.inputReady === ready) return
  entry.inputReady = ready
  if (ready) notifyInputReady(entry)
  else entry.attachment?.binding.onInputReadyChange()?.(false)
}

function confirmInputReady(entry: TerminalEntry): void {
  entry.readinessRequest += 1
  setInputReady(entry, true)
}

function writeTerminalData(
  entry: TerminalEntry,
  content: string,
  cursor?: number
): void {
  if (
    cursor !== undefined &&
    entry.renderedTranscriptCursor !== null &&
    cursor <= entry.renderedTranscriptCursor
  ) return

  if (content) {
    entry.terminal.write(content)
    entry.renderedTranscript = appendBoundedText(
      entry.renderedTranscript,
      content,
      MAX_TERMINAL_TRANSCRIPT_CHARS
    )
  }
  if (cursor !== undefined) entry.renderedTranscriptCursor = cursor
}

function reconcileTerminalTranscript(entry: TerminalEntry, session: Session): void {
  const cursor = session.cursor ?? null
  if (
    cursor !== null &&
    entry.renderedTranscriptCursor !== null &&
    cursor <= entry.renderedTranscriptCursor
  ) return
  if (cursor === null && entry.renderedTranscriptCursor !== null) return

  if (session.transcript === entry.renderedTranscript) {
    entry.renderedTranscriptCursor = cursor
    return
  }
  if (cursor === null && entry.renderedTranscript.startsWith(session.transcript)) return

  if (session.transcript.startsWith(entry.renderedTranscript)) {
    const missingContent = session.transcript.slice(entry.renderedTranscript.length)
    if (missingContent) entry.terminal.write(missingContent)
  } else {
    // A bounded transcript may have dropped the prefix that xterm already rendered.
    // Keep the same emulator instance, but use the authoritative snapshot in that rare case.
    entry.terminal.reset()
    if (session.transcript) entry.terminal.write(session.transcript)
  }
  entry.renderedTranscript = session.transcript
  entry.renderedTranscriptCursor = cursor
}

function resizeRemoteTerminal(entry: TerminalEntry, cols: number, rows: number): void {
  if (!entry.live && !entry.transport) return
  if (
    entry.lastRemoteDimensions?.cols === cols &&
    entry.lastRemoteDimensions.rows === rows
  ) return

  entry.lastRemoteDimensions = { cols, rows }
  if (entry.transport) void entry.transport.resize(entry.sessionId, cols, rows)
  else window.cliLoom?.resizeProcess(entry.sessionId, cols, rows)
}

function fitAttachedTerminal(entry: TerminalEntry, token: symbol): boolean {
  const attachment = entry.attachment
  if (!attachment || attachment.token !== token) return false
  const { host } = attachment
  if (!host.isConnected || host.clientWidth <= 0 || host.clientHeight <= 0) return false

  try {
    entry.fit.fit()
  } catch {
    return false
  }

  const cols = entry.terminal.cols
  const rows = entry.terminal.rows
  if (cols > 0 && rows > 0) resizeRemoteTerminal(entry, cols, rows)
  return true
}

function queryInputReadiness(entry: TerminalEntry): void {
  const attachment = entry.attachment
  if (!attachment || attachment.binding.isReadOnly()) {
    notifyInputReady(entry)
    return
  }

  const readiness = entry.transport?.isInputReady?.(entry.sessionId) ??
    window.cliLoom?.isInputReady(entry.sessionId)
  if (readiness === undefined) return

  const request = entry.readinessRequest + 1
  entry.readinessRequest = request
  Promise.resolve(readiness).then((ready) => {
    const current = entry.attachment
    if (
      !entry.disposed &&
      entry.readinessRequest === request &&
      current &&
      !current.binding.isReadOnly()
    ) {
      setInputReady(entry, ready)
    }
  }).catch(() => {
    /* the attached event can still make the terminal ready */
  })
}

function ensureInputSubscription(entry: TerminalEntry): void {
  if (entry.inputDisposable) return
  entry.inputDisposable = entry.terminal.onData((data) => {
    const attachment = entry.attachment
    if (!attachment || attachment.binding.isReadOnly() || !entry.inputReady) return
    if (entry.transport) entry.transport.write(entry.sessionId, data)
    else attachment.binding.onSendInput()?.(entry.sessionId, data)
  })
}

function ensureAttachedSubscription(entry: TerminalEntry): void {
  if (entry.unsubAttached) return
  entry.unsubAttached = entry.transport?.subscribeReady?.(
    entry.sessionId,
    () => confirmInputReady(entry)
  ) ?? window.cliLoom?.onTerminalAttached((event) => {
    if (event.sessionId === entry.sessionId) confirmInputReady(entry)
  })
}

function disconnectInput(entry: TerminalEntry): void {
  entry.inputDisposable?.dispose()
  entry.inputDisposable = undefined
  entry.unsubAttached?.()
  entry.unsubAttached = undefined
}

function syncTerminalAttachment(entry: TerminalEntry): void {
  const attachment = entry.attachment
  if (!attachment) return

  const readOnly = attachment.binding.isReadOnly()
  entry.live = attachment.binding.shouldPersist()
  entry.terminal.options.convertEol = readOnly
  entry.terminal.options.disableStdin = readOnly
  if (readOnly) {
    entry.readinessRequest += 1
    disconnectInput(entry)
    setInputReady(entry, false)
  } else {
    ensureInputSubscription(entry)
    ensureAttachedSubscription(entry)
    notifyInputReady(entry)
    queryInputReadiness(entry)
  }
}

function disposeTerminalEntry(entry: TerminalEntry): void {
  if (entry.disposed) return
  entry.disposed = true
  entry.readinessRequest += 1
  entry.attachment?.observer.disconnect()
  entry.attachment = null
  entry.unsubData?.()
  entry.unsubAttached?.()
  entry.unsubClosed?.()
  entry.unsubRestarted?.()
  entry.inputDisposable?.dispose()
  document.documentElement.removeEventListener(CODE_FONT_CHANGE_EVENT, entry.handleCodeFontChange)
  entry.terminal.dispose()
  if (terminalEntries.get(entry.sessionId) === entry) terminalEntries.delete(entry.sessionId)
}

type InternalTerminalEntry = TerminalEntry

function createTerminalEntry(
  session: Session,
  host: HTMLDivElement,
  transport: TerminalTransport | undefined,
  live: boolean,
  readOnly: boolean
): InternalTerminalEntry {
  const terminal = new Terminal({
    convertEol: readOnly,
    disableStdin: readOnly,
    fontFamily: getAppliedCodeFontStack(),
    fontSize: 13,
    overviewRuler: { width: TERMINAL_SCROLLBAR_GUTTER_WIDTH },
    scrollback: 5000,
    theme: { overviewRulerBorder: '#00000000' }
  })
  const fit = new FitAddon()
  terminal.loadAddon(fit)
  terminal.open(host)

  const entry: InternalTerminalEntry = {
    attachment: null,
    closed: false,
    disposed: false,
    fit,
    inputReady: false,
    lastRemoteDimensions: null,
    live,
    pendingScroll: 0,
    readinessRequest: 0,
    renderedTranscript: session.transcript,
    renderedTranscriptCursor: session.cursor ?? null,
    sessionId: session.id,
    terminal,
    transport,
    handleCodeFontChange: () => {
      const fontFamily = getAppliedCodeFontStack()
      if (terminal.options.fontFamily === fontFamily) return
      terminal.options.fontFamily = fontFamily
      const token = entry.attachment?.token
      if (token) fitAttachedTerminal(entry, token)
    }
  }
  terminalEntries.set(session.id, entry)

  const sealed = { value: false }
  const bufferedData: Array<{ content: string; cursor?: number }> = []
  const writeData = (content: string, cursor?: number) => {
    if (!sealed.value) bufferedData.push({ content, cursor })
    else writeTerminalData(entry, content, cursor)
  }
  entry.unsubData = transport?.subscribeData(session.id, writeData) ??
    window.cliLoom?.onTerminalData((event) => {
      if (event.sessionId === session.id) writeData(event.content, event.cursor)
    })

  if (session.transcript) terminal.write(session.transcript)
  for (const data of bufferedData) writeTerminalData(entry, data.content, data.cursor)
  bufferedData.length = 0
  sealed.value = true

  if (!transport) {
    if (typeof window.cliLoom?.onTerminalClosed === 'function') {
      entry.unsubClosed = window.cliLoom.onTerminalClosed((event) => {
        if (event.sessionId !== session.id) return
        entry.closed = true
        entry.live = false
        entry.readinessRequest += 1
        setInputReady(entry, false)
        if (!entry.attachment) disposeTerminalEntry(entry)
      })
    }
    if (typeof window.cliLoom?.onTerminalRestarted === 'function') {
      entry.unsubRestarted = window.cliLoom.onTerminalRestarted((event) => {
        const restarted = event as {
          id?: unknown
          transcript?: unknown
          transcript_cursor?: unknown
        }
        if (restarted.id !== session.id) return
        entry.closed = false
        entry.live = true
        entry.lastRemoteDimensions = null
        entry.readinessRequest += 1
        setInputReady(entry, false)
        terminal.reset()
        const transcript = typeof restarted.transcript === 'string' ? restarted.transcript : ''
        entry.renderedTranscript = transcript
        entry.renderedTranscriptCursor = typeof restarted.transcript_cursor === 'number'
          ? restarted.transcript_cursor
          : null
        if (transcript) terminal.write(transcript)
        const token = entry.attachment?.token
        if (token) fitAttachedTerminal(entry, token)
      })
    }
  }

  document.documentElement.addEventListener(CODE_FONT_CHANGE_EVENT, entry.handleCodeFontChange)
  return entry
}

function getTerminalEntry(
  session: Session,
  host: HTMLDivElement,
  transport: TerminalTransport | undefined,
  shouldPersist: boolean,
  readOnly: boolean
): InternalTerminalEntry {
  const cached = terminalEntries.get(session.id) as InternalTerminalEntry | undefined
  if (
    cached &&
    !cached.disposed &&
    cached.transport === transport &&
    (shouldPersist || cached.attachment)
  ) return cached

  if (cached) disposeTerminalEntry(cached)
  return createTerminalEntry(session, host, transport, shouldPersist, readOnly)
}

function attachTerminalEntry(
  entry: InternalTerminalEntry,
  host: HTMLDivElement,
  binding: TerminalBinding
): TerminalAttachment {
  entry.attachment?.observer.disconnect()
  const element = entry.terminal.element
  // Terminal.open() is intentionally called only once; moving its root preserves all buffer state.
  if (element && element.parentElement !== host) host.appendChild(element)

  const token = Symbol(entry.sessionId)
  const observer = new ResizeObserver(() => fitAttachedTerminal(entry, token))
  const attachment = { binding, host, observer, token }
  entry.attachment = attachment
  entry.closed = false
  syncTerminalAttachment(entry)
  observer.observe(host)
  fitAttachedTerminal(entry, token)
  return attachment
}

function detachTerminalEntry(entry: InternalTerminalEntry, attachment: TerminalAttachment): void {
  if (entry.attachment?.token !== attachment.token) return
  entry.readinessRequest += 1
  setInputReady(entry, false)
  attachment.observer.disconnect()
  if (entry.terminal.element?.parentElement === attachment.host) {
    entry.terminal.element.remove()
  }
  entry.attachment = null
  if (!entry.live || entry.closed) disposeTerminalEntry(entry)
}

export function disposeAllXtermSessions(): void {
  for (const entry of [...terminalEntries.values()]) disposeTerminalEntry(entry)
}

export type XtermTerminalHandle = {
  focus: () => void
  getTextSnapshot: () => TerminalTextSnapshot
  paste: (text: string) => boolean
  scrollBy: (deltaY: number) => void
}

export const XtermTerminal = forwardRef<XtermTerminalHandle, {
  session: Session
  readOnly?: boolean
  persistent?: boolean
  refitOnWindowFocus?: boolean
  onInputReadyChange?: (ready: boolean) => void
  onSendInput?: (sessionId: string, input: string) => void
  transport?: TerminalTransport
}>(function XtermTerminal({
  session,
  readOnly = false,
  persistent = false,
  refitOnWindowFocus = false,
  onInputReadyChange,
  onSendInput,
  transport
}, ref) {
  const hostRef = useRef<HTMLDivElement>(null)
  const entryRef = useRef<InternalTerminalEntry | null>(null)
  const attachmentRef = useRef<TerminalAttachment | null>(null)
  const readOnlyRef = useRef(readOnly)
  const persistentRef = useRef(persistent)
  const onInputReadyChangeRef = useRef(onInputReadyChange)
  const onSendInputRef = useRef(onSendInput)
  const syncedStateRef = useRef<{ persistent: boolean; readOnly: boolean } | null>(null)
  readOnlyRef.current = readOnly
  persistentRef.current = persistent
  onInputReadyChangeRef.current = onInputReadyChange
  onSendInputRef.current = onSendInput

  useImperativeHandle(ref, () => ({
    focus() {
      entryRef.current?.terminal.focus()
    },
    getTextSnapshot() {
      const terminal = entryRef.current?.terminal
      return terminal
        ? getTerminalTextSnapshot(terminal)
        : { source: 'all', text: '' }
    },
    paste(text) {
      const entry = entryRef.current
      if (!entry || readOnlyRef.current || !entry.inputReady || !entry.attachment) return false
      entry.terminal.focus()
      entry.terminal.paste(text)
      return true
    },
    scrollBy(deltaY) {
      const entry = entryRef.current
      if (!entry) return

      const lineHeight = 16
      const pending = entry.pendingScroll + deltaY
      const lines = pending > 0 ? Math.floor(pending / lineHeight) : Math.ceil(pending / lineHeight)
      if (lines === 0) {
        entry.pendingScroll = pending
        return
      }

      entry.terminal.scrollLines(lines)
      entry.pendingScroll = pending - lines * lineHeight
    }
  }), [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const binding: TerminalBinding = {
      isReadOnly: () => readOnlyRef.current,
      shouldPersist: () => persistentRef.current,
      onInputReadyChange: () => onInputReadyChangeRef.current,
      onSendInput: () => onSendInputRef.current
    }
    const entry = getTerminalEntry(
      session,
      host,
      transport,
      persistentRef.current,
      readOnlyRef.current
    )
    const attachment = attachTerminalEntry(entry, host, binding)
    entryRef.current = entry
    attachmentRef.current = attachment
    syncedStateRef.current = {
      persistent: persistentRef.current,
      readOnly: readOnlyRef.current
    }

    return () => {
      if (attachmentRef.current?.token === attachment.token) attachmentRef.current = null
      if (entryRef.current === entry) entryRef.current = null
      syncedStateRef.current = null
      detachTerminalEntry(entry, attachment)
    }
  }, [session.id, transport])

  useEffect(() => {
    const entry = entryRef.current
    if (!entry || entry.sessionId !== session.id) return
    reconcileTerminalTranscript(entry, session)
  }, [session.cursor, session.id, session.transcript])

  useEffect(() => {
    const entry = entryRef.current
    const synced = syncedStateRef.current
    if (
      !entry ||
      (synced?.persistent === persistent && synced.readOnly === readOnly)
    ) return
    syncTerminalAttachment(entry)
    syncedStateRef.current = { persistent, readOnly }
  }, [persistent, readOnly])

  useEffect(() => {
    if (!refitOnWindowFocus) return

    let animationFrame: number | null = null
    const scheduleFit = () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null
        const entry = entryRef.current
        const attachment = attachmentRef.current
        if (!entry || !attachment) return
        if (fitAttachedTerminal(entry, attachment.token)) {
          entry.terminal.refresh(0, entry.terminal.rows - 1)
        }
      })
    }

    // Electron 隐藏窗口显示时不会改变 DOM 尺寸，下一帧主动测量并刷新视口可修正 Windows 下的滚动条布局。
    window.addEventListener('focus', scheduleFit)
    scheduleFit()
    return () => {
      window.removeEventListener('focus', scheduleFit)
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame)
    }
  }, [refitOnWindowFocus, session.id, transport])

  return <div className="xterm-host h-full w-full min-h-0 min-w-0 max-w-full overflow-hidden" ref={hostRef} />
})
