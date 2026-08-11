import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleAlert, Minus, Play, RotateCcw, Settings, TerminalSquare, X } from 'lucide-react'
import type { AppSettingsSnapshot } from '../../shared/appSettings'
import type { AssistantTerminalStatus } from '../../shared/assistant'
import { isWslExecutionTarget, type ShellSnapshot } from '../../shared/shell'
import { applySkin } from '../theme'
import { i18n, syncI18nLanguage } from '../i18n'
import { XtermTerminal } from '../components/XtermTerminal'
import type { TerminalTransport } from '../components/terminalTransport'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export type AssistantBootstrap = {
  settings: AppSettingsSnapshot
  shell: ShellSnapshot
  status: AssistantTerminalStatus
  transcript: string
}

export function AssistantApp({
  initialBootstrap,
  bootstrapError
}: {
  initialBootstrap: AssistantBootstrap
  bootstrapError: string | null
}) {
  const [settingsSnapshot, setSettingsSnapshot] = useState(initialBootstrap.settings)
  const [shellSnapshot, setShellSnapshot] = useState(initialBootstrap.shell)
  const [status, setStatus] = useState(initialBootstrap.status)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [command, setCommand] = useState(initialBootstrap.settings.assistant.initializationCommand)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(bootstrapError)
  const [validationMessage, setValidationMessage] = useState<string | null>(null)
  const sessionCounterRef = useRef(0)
  const statusRef = useRef(status)
  const [session, setSession] = useState({
    id: 'assistant-initial',
    transcript: initialBootstrap.transcript
  })
  statusRef.current = status

  const transport = useMemo<TerminalTransport>(() => ({
    subscribeData: (_sessionId, callback) => window.cliLoomAssistant?.onTerminalData(callback),
    subscribeReady: (_sessionId, callback) => window.cliLoomAssistant?.onTerminalStatus((nextStatus) => {
      if (nextStatus.state === 'running') callback()
    }),
    isInputReady: () => statusRef.current.state === 'running',
    write: (_sessionId, input) => window.cliLoomAssistant?.write(input),
    resize: (_sessionId, cols, rows) => window.cliLoomAssistant?.resize(cols, rows)
  }), [])

  useEffect(() => {
    const removeStatus = window.cliLoomAssistant?.onTerminalStatus((nextStatus) => {
      setStatus(nextStatus)
      if (nextStatus.state === 'starting') {
        sessionCounterRef.current += 1
        setSession({ id: `assistant-${sessionCounterRef.current}`, transcript: '' })
      }
    })
    const removeSettings = window.cliLoomAssistant?.onSettingsChanged((nextSettings) => {
      setSettingsSnapshot(nextSettings)
      applySkin(nextSettings.activeSkin)
      syncI18nLanguage(nextSettings.appearance.language)
      if (!settingsOpen) setCommand(nextSettings.assistant.initializationCommand)
    })
    const removeFallback = window.cliLoomAssistant?.onThemeFallback((skin) => {
      applySkin(skin)
    })
    const removeShells = window.cliLoomAssistant?.onShellsChanged((nextShells) => {
      setShellSnapshot(nextShells)
    })
    return () => {
      removeStatus?.()
      removeSettings?.()
      removeFallback?.()
      removeShells?.()
    }
  }, [settingsOpen])

  const configured = Boolean(settingsSnapshot.assistant.initializationCommand)
  const shellUnavailable = !shellSnapshot.effectiveShell
  const statusLabel = getStatusLabel(status)

  async function validateCommand(): Promise<void> {
    setBusy(true)
    setError(null)
    setValidationMessage(null)
    try {
      const resolved = await window.cliLoomAssistant?.validateCommand(command)
      const detail = resolved && typeof resolved === 'object' && 'executablePath' in resolved
        ? String(resolved.executablePath)
        : command
      setValidationMessage(i18n.t('assistant:validation.commandAvailable', { detail }))
    } catch (validationError) {
      setError(getErrorMessage(validationError))
    } finally {
      setBusy(false)
    }
  }

  async function saveCommand(action: 'save' | 'restart'): Promise<void> {
    setBusy(true)
    setError(null)
    setValidationMessage(null)
    try {
      await window.cliLoomAssistant?.saveConfig(command, action)
      setSettingsSnapshot((current) => ({
        ...current,
        assistant: { version: 1, initializationCommand: command.trim() }
      }))
      setSettingsOpen(false)
    } catch (saveError) {
      setError(getErrorMessage(saveError))
    } finally {
      setBusy(false)
    }
  }

  async function restart(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await window.cliLoomAssistant?.restart()
    } catch (restartError) {
      setError(getErrorMessage(restartError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="flex h-screen min-h-0 flex-col overflow-hidden text-foreground"
      style={{ background: 'var(--app-background)' }}
    >
      <header className="assistant-drag-region flex h-11 shrink-0 items-center border-b bg-card pl-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <TerminalSquare className="size-4 text-primary" />
          <span className="truncate text-sm font-medium">{i18n.t('assistant:label.window')}</span>
          {configured && <span className="text-xs text-muted-foreground">{statusLabel}</span>}
        </div>
        <div className="assistant-no-drag flex h-full items-center pr-1">
          <WindowButton label={i18n.t('assistant:action.settings')} onClick={() => {
            setCommand(settingsSnapshot.assistant.initializationCommand)
            setError(null)
            setValidationMessage(null)
            setSettingsOpen(true)
          }}>
            <Settings />
          </WindowButton>
          <WindowButton label={i18n.t('assistant:action.hide')} onClick={() => void window.cliLoomAssistant?.hide()}>
            <Minus />
          </WindowButton>
          <WindowButton label={i18n.t('assistant:action.close')} destructive onClick={() => void window.cliLoomAssistant?.close()}>
            <X />
          </WindowButton>
        </div>
      </header>

      {!configured ? (
        <main className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/20 p-6">
          <Card className="w-full max-w-xl">
            <CardHeader>
              <CardTitle>{i18n.t('assistant:config.title')}</CardTitle>
              <CardDescription>
                {i18n.t('assistant:config.description')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <GlobalShellInfo snapshot={shellSnapshot} />
              <CommandFields
                command={command}
                error={error}
                validationMessage={validationMessage}
                disabled={busy}
                onCommandChange={setCommand}
              />
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <Button disabled={busy || !command.trim()} variant="outline" onClick={() => void validateCommand()}>
                  {i18n.t('assistant:action.detect')}
                </Button>
                <Button disabled={busy || !command.trim() || shellUnavailable} onClick={() => void saveCommand('restart')}>
                  <Play data-icon="inline-start" />
                  {i18n.t('assistant:action.saveAndStart')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </main>
      ) : (
        <main className="relative min-h-0 flex-1 overflow-hidden bg-[var(--terminal)] p-2">
          <XtermTerminal session={session} transport={transport} />
          {(status.state === 'failed' || status.state === 'exited') && (
            <div className="absolute right-4 bottom-4 left-4 flex items-center justify-between gap-3 rounded-lg border bg-card/95 p-3 text-card-foreground shadow-lg backdrop-blur-sm">
              <div className="min-w-0">
                <div className="text-sm font-medium">{statusLabel}</div>
                {status.state === 'failed' && (
                  <div className="truncate text-xs text-destructive" title={status.message}>{status.message}</div>
                )}
                {shellUnavailable && (
                  <div className="text-xs text-destructive">
                    {shellSnapshot.error
                      ? i18n.t('assistant:shell.errorHint', { error: shellSnapshot.error })
                      : i18n.t('assistant:shell.unavailableTitle')}
                  </div>
                )}
              </div>
              <Button disabled={busy || shellUnavailable} size="sm" onClick={() => void restart()}>
                <RotateCcw data-icon="inline-start" />
                {i18n.t('assistant:action.restart')}
              </Button>
            </div>
          )}
          {error && status.state !== 'failed' && (
            <Alert className="absolute right-4 bottom-4 left-4" variant="destructive">
              <CircleAlert />
              <AlertTitle>{i18n.t('assistant:operationFailedTitle')}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </main>
      )}

      <Dialog open={configured && settingsOpen} onOpenChange={(open) => {
        if (!busy) setSettingsOpen(open)
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{i18n.t('assistant:settings.title')}</DialogTitle>
            <DialogDescription>{i18n.t('assistant:settings.description')}</DialogDescription>
          </DialogHeader>
          <GlobalShellInfo snapshot={shellSnapshot} />
          <CommandFields
            command={command}
            error={error}
            validationMessage={validationMessage}
            disabled={busy}
            onCommandChange={setCommand}
          />
          <DialogFooter>
            <Button disabled={busy || !command.trim()} variant="outline" onClick={() => void validateCommand()}>
              {i18n.t('assistant:action.detect')}
            </Button>
            <Button disabled={busy || !command.trim()} variant="secondary" onClick={() => void saveCommand('save')}>
              {i18n.t('assistant:action.saveOnly')}
            </Button>
            <Button disabled={busy || !command.trim() || shellUnavailable} onClick={() => void saveCommand('restart')}>
              {i18n.t('assistant:action.saveAndRestart')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function GlobalShellInfo({ snapshot }: { snapshot: ShellSnapshot }) {
  const shell = snapshot.effectiveShell
  const detail = shell
    ? isWslExecutionTarget(shell)
      ? [shell.distributionName, shell.wslVersion ? `WSL ${shell.wslVersion}` : '', shell.loginShellPath ?? '']
          .filter(Boolean)
          .join(' · ')
      : shell.executablePath
    : ''
  return shell ? (
    <Field className="mb-3">
      <FieldLabel>{i18n.t('assistant:globalShell')}</FieldLabel>
      <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
        <div className="font-medium">{shell.displayName} <span className="text-xs text-muted-foreground">{shell.family}</span></div>
        <div className="truncate text-xs text-muted-foreground" title={detail}>{detail}</div>
      </div>
      <FieldDescription>{i18n.t('assistant:globalShellDescription')}</FieldDescription>
    </Field>
  ) : (
    <Alert className="mb-3" variant="destructive">
      <CircleAlert />
      <AlertTitle>{i18n.t('assistant:shell.unavailableTitle')}</AlertTitle>
      <AlertDescription>
        {snapshot.error ? i18n.t('assistant:shell.errorHint', { error: snapshot.error }) : i18n.t('assistant:shell.redirectOnly')}
      </AlertDescription>
    </Alert>
  )
}

function CommandFields({
  command,
  error,
  validationMessage,
  disabled,
  onCommandChange
}: {
  command: string
  error: string | null
  validationMessage: string | null
  disabled: boolean
  onCommandChange: (value: string) => void
}) {
  return (
    <FieldGroup>
      <Field data-invalid={Boolean(error)}>
        <FieldLabel htmlFor="assistant-command">{i18n.t('assistant:initializationCommand')}</FieldLabel>
        <Input
          id="assistant-command"
          autoComplete="off"
          disabled={disabled}
          placeholder={i18n.t('assistant:command.placeholder')}
          spellCheck={false}
          value={command}
          onChange={(event) => onCommandChange(event.target.value)}
        />
        <FieldDescription>
          {i18n.t('assistant:command.hint')}
        </FieldDescription>
        {validationMessage && <p className="text-sm text-emerald-600 dark:text-emerald-400">{validationMessage}</p>}
        <FieldError>{error}</FieldError>
      </Field>
    </FieldGroup>
  )
}

function WindowButton({
  label,
  destructive = false,
  children,
  onClick
}: {
  label: string
  destructive?: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className={destructive ? 'rounded-none hover:bg-destructive hover:text-white' : 'rounded-none'}
          size="icon-lg"
          variant="ghost"
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function getStatusLabel(status: AssistantTerminalStatus): string {
  if (status.state === 'idle') return i18n.t('assistant:status.idle')
  if (status.state === 'starting') return i18n.t('assistant:status.starting')
  if (status.state === 'running') return i18n.t('assistant:status.running')
  if (status.state === 'failed') return i18n.t('assistant:status.failed')
  return i18n.t('assistant:status.ended', { code: status.exitCode ?? i18n.t('assistant:status.unknownExitCode') })
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
