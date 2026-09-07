import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, LoaderCircle, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TerminalRetryMode } from '../../shared/terminalSession'
import type { TerminalRetryDraft, TerminalRetryEdit } from '../../shared/terminalRetry'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'

type TerminalRetryDialogProps = {
  open: boolean
  sessionId: string
  mode: TerminalRetryMode
  available: boolean
  onLoad: (sessionId: string, mode: TerminalRetryMode) => Promise<TerminalRetryDraft>
  onSubmit: (
    sessionId: string,
    mode: TerminalRetryMode,
    edit: TerminalRetryEdit
  ) => Promise<void>
  onClose: () => void
  onRestoreFocus?: () => void
}

export function TerminalRetryDialog({
  open,
  sessionId,
  mode,
  available,
  onLoad,
  onSubmit,
  onClose,
  onRestoreFocus
}: TerminalRetryDialogProps) {
  const { t } = useTranslation()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const loadRef = useRef(onLoad)
  loadRef.current = onLoad
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [draft, setDraft] = useState<TerminalRetryDraft | null>(null)
  const [command, setCommand] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setDraft(null)
    setCommand('')
    setLoadError(null)
    setSubmitError(null)
    setValidationError(null)
    setLoading(true)
    void loadRef.current(sessionId, mode).then((value) => {
      if (cancelled) return
      if (value.sessionId !== sessionId || value.mode !== mode) {
        setLoadError(t('terminal:retry.stateChanged'))
        return
      }
      setDraft(value)
      setCommand(value.command)
    }).catch((error: unknown) => {
      if (!cancelled) setLoadError(errorMessage(error))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [loadAttempt, mode, open, sessionId, t])

  useEffect(() => {
    if (open && draft && !loading) textareaRef.current?.focus()
  }, [draft, loading, open])

  const close = () => {
    if (!submitting) onClose()
  }

  const submit = async () => {
    if (!draft || loading || submitting || !available) return
    if (!command.trim()) {
      setValidationError(t('terminal:retry.emptyError'))
      textareaRef.current?.focus()
      return
    }
    if (command.includes('\0')) {
      setValidationError(t('terminal:retry.nulError'))
      textareaRef.current?.focus()
      return
    }
    setValidationError(null)
    setSubmitError(null)
    setSubmitting(true)
    try {
      await onSubmit(sessionId, mode, { revision: draft.revision, command })
      onClose()
    } catch (error) {
      setSubmitError(errorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  const blockedError = !available && draft ? t('terminal:retry.stateChanged') : null
  const error = validationError ?? submitError ?? blockedError

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && close()}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] w-[min(45rem,calc(100vw-2rem))] max-w-[calc(100%-2rem)] flex-col overflow-hidden sm:max-w-[min(45rem,calc(100%-2rem))]"
        onCloseAutoFocus={(event) => {
          if (!onRestoreFocus) return
          event.preventDefault()
          onRestoreFocus()
        }}
        onEscapeKeyDown={(event) => submitting && event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        showCloseButton={!submitting}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{t('terminal:retry.editAction')}</DialogTitle>
          <DialogDescription>{t('terminal:retry.editDescription')}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          {loading && (
            <div className="flex min-h-40 items-center justify-center gap-2 text-muted-foreground" role="status">
              <LoaderCircle className="size-4 animate-spin" />
              {t('terminal:retry.loading')}
            </div>
          )}

          {!loading && loadError && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertDescription>
                <p>{t('terminal:retry.loadFailed', { detail: loadError })}</p>
                <Button className="mt-2" onClick={() => setLoadAttempt((value) => value + 1)} size="sm" variant="outline">
                  <RotateCcw data-icon="inline-start" />
                  {t('terminal:retry.reload')}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {draft && !loading && (
            <>
              <dl className="grid gap-x-4 gap-y-2 rounded-lg border bg-muted/30 p-3 sm:grid-cols-[max-content_minmax(0,1fr)]">
                <dt className="font-medium">{t('terminal:retry.executionEnvironment')}</dt>
                <dd className="min-w-0 break-words select-text">{draft.executionTargetName ?? '—'}</dd>
                <dt className="font-medium">{t('terminal:retry.workingDirectory')}</dt>
                <dd className="min-w-0 break-all font-mono text-xs select-text">{draft.cwd}</dd>
              </dl>
              <Field data-invalid={Boolean(error)}>
                <FieldLabel htmlFor={`terminal-retry-command-${sessionId}`}>
                  {t('terminal:retry.commandLabel')}
                </FieldLabel>
                <Textarea
                  ref={textareaRef}
                  id={`terminal-retry-command-${sessionId}`}
                  className="min-h-40 resize-y font-mono whitespace-pre-wrap"
                  disabled={submitting || !available}
                  value={command}
                  onChange={(event) => {
                    setCommand(event.target.value)
                    setValidationError(null)
                    setSubmitError(null)
                  }}
                />
                <FieldDescription>
                  {mode === 'workflow'
                    ? t('terminal:retry.workflowHint')
                    : t('terminal:retry.standaloneHint')}
                  {mode === 'workflow' && draft.hasSavedVariables
                    ? ` ${t('terminal:retry.workflowSavedHint')}`
                    : ''}
                </FieldDescription>
                <FieldError>{error}</FieldError>
              </Field>
            </>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <Button disabled={submitting} onClick={close} variant="outline">
            {t('common:action.cancel')}
          </Button>
          <Button
            disabled={!draft || loading || submitting || Boolean(loadError) || !available}
            onClick={() => void submit()}
          >
            {submitting
              ? t('terminal:retry.submitting')
              : mode === 'workflow'
                ? t('terminal:retry.workflowSubmit')
                : t('terminal:retry.standaloneSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
