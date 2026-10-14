import { useEffect, useMemo, useState } from 'react'
import { AlarmClock, Ban, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { isValidTimeZone } from '../../shared/cronSchedule'
import { parseLastRetryStartedAt, type TerminalAutoRetryReason, type TerminalAutoRetryState } from '../../shared/terminalAutoRetry'
import { formatCountdown, formatScheduleTime } from '../designer/cronAssistant'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const COUNTDOWN_TICK_MS = 1_000

type BlockedReasonKey = `node:autoRetry.blockedReason.${TerminalAutoRetryReason}`

export function TerminalAutoRetryBanner({
  autoRetry,
  timeZone,
  maxRetries,
  disabled = false,
  onRetryNow,
  onCancel
}: {
  autoRetry: TerminalAutoRetryState
  timeZone: string | undefined
  maxRetries: number | null | undefined
  disabled?: boolean
  onRetryNow: () => void
  onCancel: (autoRetry: TerminalAutoRetryState) => void
}) {
  const { t } = useTranslation()
  const locale = useMemo(() => Intl.DateTimeFormat().resolvedOptions().locale, [])
  const [now, setNow] = useState(() => Date.now())
  const [cancelling, setCancelling] = useState(false)
  const waiting = autoRetry.phase === 'waiting' && autoRetry.nextRetryAt !== undefined

  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS)
    return () => clearInterval(timer)
  }, [waiting])

  const nextAttempt = autoRetry.attemptsStarted + 1
  const remainingMs = waiting ? Math.max(0, autoRetry.nextRetryAt! - now) : 0

  const cancel = async () => {
    if (cancelling || disabled) return
    setCancelling(true)
    try {
      await onCancel(autoRetry)
    } finally {
      setCancelling(false)
    }
  }

  const zone = timeZone !== undefined && isValidTimeZone(timeZone) ? timeZone : 'UTC'
  const withoutZone = { showTimeZone: false } as const

  const title = waiting
    ? t('node:autoRetry.nextRetry', {
      attempt: nextAttempt,
      time: formatScheduleTime(autoRetry.nextRetryAt!, zone, locale, withoutZone)
    })
    : autoRetry.phase === 'running'
      ? t('node:autoRetry.running', { attempt: autoRetry.attemptsStarted })
      : t('node:autoRetry.outcomeTitle')

  const detail = waiting || autoRetry.phase === 'running' ? undefined : describeTerminalOutcome(autoRetry, t)

  const statsLine = () => {
    if (waiting) {
      if (remainingMs <= 0) return t('node:autoRetry.preparing')
      if (maxRetries === undefined) {
        return `${t('node:autoRetry.attemptsOnly', { started: autoRetry.attemptsStarted })} · ${formatCountdown(remainingMs)}`
      }
      return maxRetries === null
        ? t('node:autoRetry.statsUnlimited', {
          started: autoRetry.attemptsStarted
        })
        : t('node:autoRetry.statsLimited', {
          started: autoRetry.attemptsStarted,
          max: maxRetries,
          remaining: formatCountdown(remainingMs)
        })
    }
    if (autoRetry.phase === 'running') {
      return t('node:autoRetry.attemptsOnly', { started: autoRetry.attemptsStarted })
    }
    return undefined
  }

  const lastRetryStartedAt = parseLastRetryStartedAt(
    autoRetry.lastRetryStartedAt,
    autoRetry.attemptsStarted
  )
  const lastRetryLine = autoRetry.attemptsStarted > 0
    ? lastRetryStartedAt !== undefined
      ? t('node:autoRetry.lastRetryStartedAt', {
        time: formatScheduleTime(lastRetryStartedAt, zone, locale, withoutZone)
      })
      : t('node:autoRetry.lastRetryStartedAtUnknown')
    : undefined

  return (
    <Alert
      className={cn('shrink-0 border-primary/40 bg-primary/5')}
      data-auto-retry-phase={autoRetry.phase}
      role="status"
    >
      <AlarmClock />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <span className="flex min-w-0 flex-col gap-1">
          <span className="min-w-0 break-words">{detail ?? statsLine()}</span>
          {lastRetryLine && <span className="min-w-0 break-words">{lastRetryLine}</span>}
        </span>
        {waiting && (
          <span className="flex shrink-0 flex-wrap items-center gap-2">
            <Button disabled={disabled} onClick={onRetryNow} size="sm" variant="outline">
              <RotateCcw data-icon="inline-start" />
              {t('node:autoRetry.retryNow')}
            </Button>
            <Button
              disabled={disabled || cancelling}
              onClick={() => void cancel()}
              size="sm"
              variant="outline"
            >
              <Ban data-icon="inline-start" />
              {cancelling ? t('node:autoRetry.cancelling') : t('node:autoRetry.cancel')}
            </Button>
          </span>
        )}
      </AlertDescription>
    </Alert>
  )
}

type BannerTranslator = (
  key: BlockedReasonKey | 'node:autoRetry.exhausted' | 'node:autoRetry.cancelledTitle',
  params?: Record<string, unknown>
) => string

function describeTerminalOutcome(autoRetry: TerminalAutoRetryState, t: BannerTranslator): string {
  if (autoRetry.phase === 'exhausted') {
    return t('node:autoRetry.exhausted', { count: autoRetry.attemptsStarted })
  }
  if (autoRetry.phase === 'cancelled') {
    return t('node:autoRetry.cancelledTitle')
  }
  if (autoRetry.phase === 'blocked' && autoRetry.reason) {
    return t(`node:autoRetry.blockedReason.${autoRetry.reason}`)
  }
  return t('node:autoRetry.blockedReason.invalid-state')
}
