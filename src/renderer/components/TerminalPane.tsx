import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { LoaderCircle, RotateCcw, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  canAcceptTerminalInput,
  canRetryTerminalSession,
  type TerminalSession
} from '../utils'
import { isTerminalSessionRunning } from '../../shared/terminalSession'
import type { TerminalRetryMode } from '../../shared/terminalSession'
import {
  getTerminalAction,
  type TerminalWorkflowRole
} from '../executionActions'
import { StatusBadge } from './StatusBadge'
import { XtermTerminal, type XtermTerminalHandle } from './XtermTerminal'
import { TerminalContextMenu } from './TerminalContextMenu'
import { useTerminalScrollRegistration } from './TerminalScrollGroup'
import { getSelectionTextWithin, type TerminalTextSnapshot } from '../terminalText'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

const LazyTerminalMarkdownDialog = lazy(async () => {
  const module = await import('./TerminalMarkdownDialog')
  return { default: module.TerminalMarkdownDialog }
})

export type { TerminalSession }

function TerminalMarkdownDialogHost({
  markdown,
  onClose,
  onRestoreFocus
}: {
  markdown: string | null
  onClose: () => void
  onRestoreFocus?: () => void
}) {
  if (markdown === null) return null
  return (
    <Suspense fallback={null}>
      <LazyTerminalMarkdownDialog
        initialMarkdown={markdown}
        onClose={onClose}
        onRestoreFocus={onRestoreFocus}
      />
    </Suspense>
  )
}

export const TerminalPane = memo(function TerminalPane({
  session,
  disabled = false,
  onLoadTranscript,
  onSendInput,
  onRetry,
  onStop,
  workflowRole = 'history',
  className
}: {
  session: TerminalSession
  disabled?: boolean
  onLoadTranscript?: (session: TerminalSession) => Promise<void>
  onSendInput: (sessionId: string, input: string) => void
  onRetry: (sessionId: string, mode: TerminalRetryMode) => Promise<void>
  onStop: (sessionId: string) => Promise<void>
  workflowRole?: TerminalWorkflowRole
  className?: string
}) {
  const persistent = isTerminalSessionRunning(session.status)
  const readOnly = disabled || !canAcceptTerminalInput(session)
  const { t } = useTranslation()
  const [inputReady, setInputReady] = useState(false)
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [transcriptLoadAttempt, setTranscriptLoadAttempt] = useState(0)
  const [transcriptLoadState, setTranscriptLoadState] = useState<'idle' | 'loading' | 'failed'>('idle')
  const targetLabel = formatExecutionTarget(session)
  const action = getTerminalAction(session.status, workflowRole)
  const xtermRef = useRef<XtermTerminalHandle>(null)
  const getTextSnapshot = useCallback((): TerminalTextSnapshot => (
    xtermRef.current?.getTextSnapshot() ?? { source: 'all', text: '' }
  ), [])
  const paste = useCallback((text: string) => xtermRef.current?.paste(text) ?? false, [])
  const restoreTerminalFocus = useCallback(() => xtermRef.current?.focus(), [])
  const scrollBy = useCallback((deltaY: number) => {
    xtermRef.current?.scrollBy(deltaY)
  }, [])
  useTerminalScrollRegistration(session.id, scrollBy)

  useEffect(() => {
    if (session.transcript !== null) return
    if (!onLoadTranscript) {
      setTranscriptLoadState('failed')
      return
    }

    let cancelled = false
    setTranscriptLoadState('loading')
    void onLoadTranscript(session).then(() => {
      if (!cancelled) setTranscriptLoadState('idle')
    }).catch(() => {
      if (!cancelled) setTranscriptLoadState('failed')
    })
    return () => {
      cancelled = true
    }
  }, [onLoadTranscript, session.id, session.task_id, session.transcript, transcriptLoadAttempt])

  const retry = async (mode: TerminalRetryMode) => {
    if (retrying || !canRetryTerminalSession(session)) return
    setRetrying(true)
    try {
      await onRetry(session.id, mode)
    } finally {
      setRetrying(false)
    }
  }

  const stop = async () => {
    if (stopping || !isTerminalSessionRunning(session.status)) return
    setStopping(true)
    try {
      await onStop(session.id)
    } finally {
      setStopping(false)
    }
  }

  return (
    <>
      <Card className={cn('h-full w-full min-h-0 min-w-0 max-w-full gap-0 py-0', className)} size="sm">
        <CardHeader className="min-w-0 border-b py-2">
          <CardTitle className="min-w-0 truncate">
            {session.kind === 'interactive' ? t('terminal:kind.interactive') : t('terminal:kind.nonInteractive')}
          </CardTitle>
          <CardDescription className="min-w-0 truncate">
            {session.command}
            {targetLabel ? ` · ${t('terminal:environment.label', { target: targetLabel })}` : ''}
          </CardDescription>
          <CardAction className="flex items-center gap-2">
            {(action === 'retry-workflow' || action === 'rerun-command') && (
              <Button
                aria-label={action === 'retry-workflow'
                  ? t('terminal:retry.aria')
                  : t('terminal:action.rerunCommand')}
                disabled={retrying}
                onClick={() => void retry(action === 'retry-workflow' ? 'workflow' : 'standalone')}
                size="sm"
                title={action === 'retry-workflow'
                  ? t('terminal:retry.workflowTooltip')
                  : targetLabel
                    ? t('terminal:retry.rerunTooltipTarget', { target: targetLabel })
                    : t('terminal:retry.rerunTooltip')}
                variant="outline"
              >
                <RotateCcw data-icon="inline-start" />
                {action === 'retry-workflow'
                  ? t('common:action.retry')
                  : t('terminal:action.rerunCommand')}
              </Button>
            )}
            {(action === 'end-and-continue' || action === 'stop-command') && (
              <Button
                disabled={stopping}
                onClick={() => void stop()}
                size="sm"
                variant="destructive"
              >
                <Square data-icon="inline-start" />
                {action === 'end-and-continue'
                  ? t('terminal:action.endAndContinue')
                  : t('terminal:action.stopCommand')}
              </Button>
            )}
            <StatusBadge source="terminal" status={session.status} />
          </CardAction>
        </CardHeader>
        <CardContent
          className="bg-terminal text-terminal-foreground min-h-0 min-w-0 max-w-full flex-1 overflow-hidden p-0"
          data-terminal-scroll-region
        >
          {session.transcript === null ? (
            <div
              className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"
              role="status"
            >
              {transcriptLoadState === 'failed' ? (
                <>
                  <span>{t('terminal:transcript.historyLoadFailed')}</span>
                  <Button
                    onClick={() => setTranscriptLoadAttempt((attempt) => attempt + 1)}
                    size="sm"
                    variant="outline"
                  >
                    <RotateCcw data-icon="inline-start" />
                    {t('common:action.retry')}
                  </Button>
                </>
              ) : (
                <>
                  <LoaderCircle className="size-4 animate-spin" />
                  <span>{t('terminal:transcript.loadingHistory')}</span>
                </>
              )}
            </div>
          ) : (
            <TerminalContextMenu
              canPaste={!readOnly && inputReady}
              getText={getTextSnapshot}
              onPaste={paste}
              onRestoreFocus={restoreTerminalFocus}
              onShowMarkdown={setMarkdown}
            >
              <div className="h-full w-full min-h-0 min-w-0 overflow-hidden">
                <XtermTerminal
                  ref={xtermRef}
                  session={{
                    cursor: session.transcript_cursor,
                    id: session.id,
                    transcript: session.transcript
                  }}
                  readOnly={readOnly}
                  persistent={persistent}
                  onInputReadyChange={setInputReady}
                  onSendInput={onSendInput}
                />
              </div>
            </TerminalContextMenu>
          )}
        </CardContent>
      </Card>
      <TerminalMarkdownDialogHost
        markdown={markdown}
        onClose={() => setMarkdown(null)}
        onRestoreFocus={restoreTerminalFocus}
      />
    </>
  )
})

function formatExecutionTarget(session: TerminalSession): string | null {
  const target = session.execution_target
  return target?.displayName ?? null
}

export const TerminalOutputPane = memo(function TerminalOutputPane({
  id,
  text,
  className
}: {
  id: string
  text: string
  className?: string
}) {
  const transcriptRef = useRef<HTMLPreElement>(null)
  const [markdown, setMarkdown] = useState<string | null>(null)
  const getTextSnapshot = useCallback((): TerminalTextSnapshot => {
    const transcript = transcriptRef.current
    const selectedText = transcript
      ? getSelectionTextWithin(transcript, window.getSelection())
      : null
    return selectedText === null
      ? { source: 'all', text }
      : { source: 'selection', text: selectedText }
  }, [text])
  const scrollBy = useCallback((deltaY: number) => {
    transcriptRef.current?.scrollBy({ top: deltaY })
  }, [])
  useTerminalScrollRegistration(id, scrollBy)

  return (
    <>
      <TerminalContextMenu getText={getTextSnapshot} onShowMarkdown={setMarkdown}>
        <pre
          className={cn(
            'terminal-output bg-terminal text-terminal-foreground h-full w-full min-h-0 min-w-0 max-w-full overflow-auto overscroll-contain rounded-lg p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]',
            className
          )}
          data-terminal-scroll-region
          ref={transcriptRef}
        >
          {text}
        </pre>
      </TerminalContextMenu>
      <TerminalMarkdownDialogHost markdown={markdown} onClose={() => setMarkdown(null)} />
    </>
  )
})
