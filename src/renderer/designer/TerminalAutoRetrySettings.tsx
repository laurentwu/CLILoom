import { useEffect, useMemo, useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { validateRetryCron, getCronPreview, getSystemTimeZone } from '../../shared/cronSchedule'
import type { TerminalAutoRetryConfig } from '../../shared/terminalAutoRetry'
import {
  AUTO_RETRY_DEFAULT_MAX_RETRIES,
  AUTO_RETRY_MAX_MAX_RETRIES,
  AUTO_RETRY_MIN_MAX_RETRIES
} from '../../shared/terminalAutoRetry'
import { formatScheduleTime } from './cronAssistant'
import { CronExpressionAssistantDialog } from './CronExpressionAssistantDialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

const CRON_VALIDATION_DEBOUNCE_MS = 250
const PREVIEW_COUNT = 5

export function TerminalAutoRetrySettings({
  nodeId,
  config,
  onChange
}: {
  nodeId: string
  config: TerminalAutoRetryConfig | undefined
  onChange: (next: TerminalAutoRetryConfig) => void
}) {
  const { t } = useTranslation()
  const timeZone = useMemo(() => getSystemTimeZone(), [])
  const locale = useMemo(() => Intl.DateTimeFormat().resolvedOptions().locale, [])
  const enabled = config?.enabled === true
  const mode = config?.mode ?? 'recommended'
  // undefined means the object predates the field (normalize to the default);
  // null is the explicit "unlimited" choice and must survive edits.
  const maxRetries = config?.maxRetries === undefined
    ? AUTO_RETRY_DEFAULT_MAX_RETRIES
    : config.maxRetries
  const [unlimitedPreviousMax, setUnlimitedPreviousMax] = useState<number>(AUTO_RETRY_DEFAULT_MAX_RETRIES)
  const [cronDraft, setCronDraft] = useState(() => (config?.mode === 'cron' ? config.cron : ''))
  const [debouncedCron, setDebouncedCron] = useState(() => (config?.mode === 'cron' ? config.cron : ''))
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null)

  // Clear any pending debounce when the component unmounts (including the
  // remount caused by switching the selected node in the designer).
  useEffect(() => () => {
    if (debounceTimer) clearTimeout(debounceTimer)
  }, [debounceTimer])

  const update = (patch: {
    enabled?: boolean
    maxRetries?: number | null
    mode?: 'recommended' | 'cron'
    cron?: string
  }) => {
    const nextMode = patch.mode ?? mode
    const nextMaxRetries = patch.maxRetries === undefined ? maxRetries : patch.maxRetries
    const base: TerminalAutoRetryConfig = nextMode === 'cron'
      ? {
          enabled: patch.enabled ?? enabled,
          maxRetries: nextMaxRetries,
          mode: 'cron',
          cron: patch.cron === undefined ? cronDraft : patch.cron
        }
      : {
          enabled: patch.enabled ?? enabled,
          maxRetries: nextMaxRetries,
          mode: 'recommended'
        }
    onChange(base)
  }

  const enable = (nextEnabled: boolean) => {
    if (!nextEnabled) {
      // Disabling the feature closes the assistant and discards its local
      // draft so a later re-enable cannot apply a stale expression.
      setAssistantOpen(false)
    }
    update({ enabled: nextEnabled })
  }

  const switchMode = (nextMode: 'recommended' | 'cron') => {
    update({ mode: nextMode })
  }

  const setMaxRetries = (value: number | null) => {
    if (value !== null && Number.isInteger(value) &&
      value >= AUTO_RETRY_MIN_MAX_RETRIES && value <= AUTO_RETRY_MAX_MAX_RETRIES) {
      setUnlimitedPreviousMax(value)
    }
    update({ maxRetries: value })
  }

  const handleCronDraftChange = (value: string) => {
    setCronDraft(value)
    if (debounceTimer) clearTimeout(debounceTimer)
    setDebounceTimer(setTimeout(() => setDebouncedCron(value), CRON_VALIDATION_DEBOUNCE_MS))
    if (mode === 'cron') update({ cron: value })
  }

  const cronValidation = useMemo(() => {
    if (!enabled || mode !== 'cron') return null
    if (debouncedCron !== cronDraft) return null
    return validateRetryCron(debouncedCron, timeZone, Date.now())
  }, [cronDraft, debouncedCron, enabled, mode, timeZone])

  const cronPreview = useMemo(() => {
    if (!enabled || mode !== 'cron' || !cronValidation?.valid) return null
    try {
      return getCronPreview(debouncedCron, timeZone, Date.now(), PREVIEW_COUNT)
    } catch {
      return null
    }
  }, [cronValidation, debouncedCron, enabled, mode, timeZone])

  const maxRetriesInputValid = maxRetries !== null && Number.isInteger(maxRetries) &&
    maxRetries >= AUTO_RETRY_MIN_MAX_RETRIES && maxRetries <= AUTO_RETRY_MAX_MAX_RETRIES

  return (
    <FieldSet>
      <FieldLegend variant="label">{t('designer:nodeConfig.autoRetryTitle')}</FieldLegend>
      <FieldGroup>
        <Field orientation="horizontal">
          <Checkbox
            id={`auto-retry-enabled-${nodeId}`}
            checked={enabled}
            onCheckedChange={(checked) => enable(checked === true)}
          />
          <FieldLabel htmlFor={`auto-retry-enabled-${nodeId}`}>
            {t('designer:nodeConfig.autoRetryEnable')}
          </FieldLabel>
        </Field>

        {enabled && (
          <>
            <Field>
              <FieldLabel htmlFor={`auto-retry-mode-${nodeId}`}>
                {t('designer:nodeConfig.autoRetryMode')}
              </FieldLabel>
              <Select value={mode} onValueChange={(value) => switchMode(value as 'recommended' | 'cron')}>
                <SelectTrigger id={`auto-retry-mode-${nodeId}`} className="w-full" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="recommended">{t('designer:nodeConfig.autoRetryModeRecommended')}</SelectItem>
                    <SelectItem value="cron">{t('designer:nodeConfig.autoRetryModeCron')}</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              {mode === 'recommended' && (
                <FieldDescription>
                  {t('designer:nodeConfig.autoRetryRecommendedHint')}
                </FieldDescription>
              )}
            </Field>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] sm:items-center">
              <Field data-invalid={!maxRetriesInputValid}>
                <FieldLabel htmlFor={`auto-retry-max-${nodeId}`}>
                  {t('designer:nodeConfig.autoRetryMaxRetries')}
                </FieldLabel>
                <Input
                  id={`auto-retry-max-${nodeId}`}
                  className="w-full"
                  disabled={maxRetries === null}
                  max={AUTO_RETRY_MAX_MAX_RETRIES}
                  min={AUTO_RETRY_MIN_MAX_RETRIES}
                  type="number"
                  value={maxRetries ?? ''}
                  onChange={(event) => {
                    const raw = event.target.value
                    setMaxRetries(raw === '' ? AUTO_RETRY_DEFAULT_MAX_RETRIES : Number(raw))
                  }}
                />
                {!maxRetriesInputValid && (
                  <FieldError>{t('errors:workflowValidation.autoRetryMaxRetriesInvalid', { name: '' })}</FieldError>
                )}
              </Field>
              <Field orientation="horizontal" className="pt-0 sm:pt-6">
                <Checkbox
                  id={`auto-retry-unlimited-${nodeId}`}
                  checked={maxRetries === null}
                  onCheckedChange={(checked) => (
                    setMaxRetries(checked === true ? null : unlimitedPreviousMax)
                  )}
                />
                <FieldLabel htmlFor={`auto-retry-unlimited-${nodeId}`}>
                  {t('designer:nodeConfig.autoRetryUnlimited')}
                </FieldLabel>
              </Field>
            </div>
            <FieldDescription>{t('designer:nodeConfig.autoRetryCountHint')}</FieldDescription>

            {mode === 'cron' && (
              <Field data-invalid={Boolean(cronValidation && !cronValidation.valid)}>
                <FieldLabel htmlFor={`auto-retry-cron-${nodeId}`}>
                  {t('designer:nodeConfig.autoRetryCronLabel')}
                </FieldLabel>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Input
                    id={`auto-retry-cron-${nodeId}`}
                    className={cn('min-w-0 flex-1 font-mono', 'basis-40')}
                    placeholder="*/5 * * * *"
                    value={cronDraft}
                    onChange={(event) => handleCronDraftChange(event.target.value)}
                  />
                  <Button
                    onClick={() => setAssistantOpen(true)}
                    size="sm"
                    title={t('designer:nodeConfig.autoRetryCronAssistantAria')}
                    variant="outline"
                  >
                    <CalendarClock data-icon="inline-start" />
                    {t('designer:nodeConfig.autoRetryCronAssistant')}
                  </Button>
                </div>
                <FieldDescription>{t('designer:nodeConfig.autoRetryCronFieldsHint')}</FieldDescription>
                {cronValidation && !cronValidation.valid && (
                  <FieldError>
                    {t(cronValidation.issue?.key ?? 'errors:cronSchedule.invalid', cronValidation.issue?.params)}
                  </FieldError>
                )}
                {cronPreview && (
                  <div className="w-full min-w-0 rounded-lg border bg-muted/30 p-3 text-xs">
                    <div className="flex min-w-0 items-center gap-1 font-medium">
                      <CalendarClock className="size-3.5 shrink-0" />
                      <span className="truncate">{t('designer:nodeConfig.autoRetryCronPreviewTitle')}</span>
                    </div>
                    <ol className="mt-1.5 space-y-1 break-all">
                      {cronPreview.map((time) => (
                        <li key={time} className="font-mono">
                          {formatScheduleTime(time, timeZone, locale)}
                        </li>
                      ))}
                    </ol>
                    <p className="text-muted-foreground mt-1.5">
                      {t('designer:nodeConfig.autoRetryCronPreviewTimezone', { timezone: timeZone })}
                      {' '}
                      {t('designer:nodeConfig.autoRetryCronPreviewHint')}
                    </p>
                  </div>
                )}
              </Field>
            )}
          </>
        )}
      </FieldGroup>

      <CronExpressionAssistantDialog
        open={assistantOpen}
        initialExpression={mode === 'cron' ? cronDraft : undefined}
        timeZone={timeZone}
        onClose={() => setAssistantOpen(false)}
        onApply={(expression) => {
          handleCronDraftChange(expression)
          if (mode !== 'cron') {
            update({ mode: 'cron', cron: expression })
          }
          setAssistantOpen(false)
        }}
      />
    </FieldSet>
  )
}
