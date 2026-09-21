import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getCronPreview, validateRetryCron } from '../../shared/cronSchedule'
import {
  buildCronExpression,
  DEFAULT_CRON_ASSISTANT_DRAFT,
  EVERY_N_MINUTES_CHOICES,
  formatScheduleTime,
  matchAssistantExpression,
  type CronAssistantDraft,
  type CronAssistantMode
} from './cronAssistant'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const
type WeekdayShortKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'
const WEEKDAY_KEYS: Record<number, WeekdayShortKey> = {
  0: 'sun',
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
  6: 'sat'
}
const PREVIEW_COUNT = 5

export function CronExpressionAssistantDialog({
  open,
  initialExpression,
  timeZone,
  onClose,
  onApply
}: {
  open: boolean
  initialExpression?: string
  timeZone: string
  onClose: () => void
  onApply: (expression: string) => void
}) {
  const { t } = useTranslation()
  const locale = useMemo(() => Intl.DateTimeFormat().resolvedOptions().locale, [])
  const [draft, setDraft] = useState<CronAssistantDraft>(DEFAULT_CRON_ASSISTANT_DRAFT)
  const [unconvertible, setUnconvertible] = useState(false)
  const applyButtonRef = useRef<HTMLButtonElement>(null)

  // A fresh local draft is created each time the dialog opens; cancelling
  // (Esc, overlay, close button) discards it without touching the workflow.
  useEffect(() => {
    if (!open) return
    const matched = initialExpression ? matchAssistantExpression(initialExpression) : null
    setUnconvertible(Boolean(initialExpression?.trim()) && matched === null)
    setDraft(matched ?? DEFAULT_CRON_ASSISTANT_DRAFT)
  }, [initialExpression, open])

  useEffect(() => {
    if (open) applyButtonRef.current?.focus()
  }, [open])

  const expression = useMemo(() => buildCronExpression(draft), [draft])
  const validation = useMemo(
    () => validateRetryCron(expression, timeZone, Date.now()),
    [expression, timeZone]
  )
  const preview = useMemo(() => {
    if (!validation.valid) return null
    try {
      return getCronPreview(expression, timeZone, Date.now(), PREVIEW_COUNT)
    } catch {
      return null
    }
  }, [expression, timeZone, validation])
  const canApply = validation.valid && preview !== null

  const setMode = (mode: CronAssistantMode) => setDraft((current) => ({ ...current, mode }))
  const toggleWeekday = (day: number, checked: boolean) => {
    setDraft((current) => {
      const next = checked
        ? [...current.weekdays, day]
        : current.weekdays.filter((item) => item !== day)
      return { ...current, weekdays: next.length > 0 ? next : current.weekdays }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] max-w-[calc(100%-2rem)] flex-col overflow-hidden sm:max-w-[min(34rem,calc(100%-2rem))]"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
        }}
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{t('designer:cronAssistant.title')}</DialogTitle>
          <DialogDescription>{t('designer:cronAssistant.description')}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
          <Field>
            <FieldLabel htmlFor="cron-assistant-mode">{t('designer:cronAssistant.mode')}</FieldLabel>
            <Select value={draft.mode} onValueChange={(value) => setMode(value as CronAssistantMode)}>
              <SelectTrigger id="cron-assistant-mode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="every-n-minutes">{t('designer:cronAssistant.modeEveryNMinutes')}</SelectItem>
                  <SelectItem value="hourly">{t('designer:cronAssistant.modeHourly')}</SelectItem>
                  <SelectItem value="daily">{t('designer:cronAssistant.modeDaily')}</SelectItem>
                  <SelectItem value="weekly">{t('designer:cronAssistant.modeWeekly')}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            {unconvertible && (
              <FieldDescription>{t('designer:cronAssistant.unconvertible')}</FieldDescription>
            )}
          </Field>

          <FieldGroup>
            {draft.mode === 'every-n-minutes' && (
              <Field>
                <FieldLabel htmlFor="cron-assistant-interval">
                  {t('designer:cronAssistant.everyNMinutes')}
                </FieldLabel>
                <Select
                  value={String(draft.intervalMinutes)}
                  onValueChange={(value) => setDraft((current) => ({
                    ...current,
                    intervalMinutes: Number(value)
                  }))}
                >
                  <SelectTrigger id="cron-assistant-interval" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {EVERY_N_MINUTES_CHOICES.map((choice) => (
                        <SelectItem key={choice} value={String(choice)}>{choice}</SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            )}

            {draft.mode === 'hourly' && (
              <Field>
                <FieldLabel htmlFor="cron-assistant-minute">
                  {t('designer:cronAssistant.minuteOfHour')}
                </FieldLabel>
                <Input
                  id="cron-assistant-minute"
                  className="w-24"
                  max={59}
                  min={0}
                  type="number"
                  value={draft.minuteOfHour}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    minuteOfHour: clampNumber(event.target.value, 0, 59, current.minuteOfHour)
                  }))}
                />
              </Field>
            )}

            {(draft.mode === 'daily' || draft.mode === 'weekly') && (
              <Field>
                <FieldLabel htmlFor="cron-assistant-time">{t('designer:cronAssistant.timeOfDay')}</FieldLabel>
                <Input
                  id="cron-assistant-time"
                  className="w-28"
                  type="time"
                  value={`${String(draft.timeHour).padStart(2, '0')}:${String(draft.timeMinute).padStart(2, '0')}`}
                  onChange={(event) => setDraft((current) => {
                    const [hour = '', minute = ''] = event.target.value.split(':')
                    return {
                      ...current,
                      timeHour: clampNumber(hour, 0, 23, current.timeHour),
                      timeMinute: clampNumber(minute, 0, 59, current.timeMinute)
                    }
                  })}
                />
              </Field>
            )}

            {draft.mode === 'weekly' && (
              <Field>
                <FieldLabel>{t('designer:cronAssistant.weekdays')}</FieldLabel>
                <div className="flex flex-wrap gap-3">
                  {WEEKDAY_ORDER.map((day) => {
                    const checkboxId = `cron-assistant-weekday-${day}`
                    return (
                      <Field key={day} orientation="horizontal">
                        <Checkbox
                          id={checkboxId}
                          checked={draft.weekdays.includes(day)}
                          onCheckedChange={(checked) => toggleWeekday(day, checked === true)}
                        />
                        <FieldLabel htmlFor={checkboxId} className="font-normal">
                          {t(`designer:cronAssistant.weekdayShort.${WEEKDAY_KEYS[day]}`)}
                        </FieldLabel>
                      </Field>
                    )
                  })}
                </div>
              </Field>
            )}
          </FieldGroup>

          <div className="w-full min-w-0 rounded-lg border bg-muted/30 p-3 text-xs">
            <dl className="space-y-2">
              <div className="flex min-w-0 items-baseline gap-2">
                <dt className="shrink-0 font-medium">{t('designer:cronAssistant.generated')}</dt>
                <dd className="min-w-0 break-all font-mono select-text">{expression}</dd>
              </div>
              <div className="flex min-w-0 items-baseline gap-2">
                <dt className="shrink-0 font-medium">{t('designer:cronAssistant.scheduleDescription')}</dt>
                <dd className="min-w-0">{describeDraft(draft, t)}</dd>
              </div>            </dl>
            <div className="mt-2 flex min-w-0 items-center gap-1 font-medium">
              <CalendarClock className="size-3.5 shrink-0" />
              <span className="truncate">{t('designer:cronAssistant.preview')}</span>
            </div>
            {preview ? (
              <ol className="mt-1.5 space-y-1 break-all">
                {preview.map((time) => (
                  <li key={time} className="font-mono">{formatScheduleTime(time, timeZone, locale)}</li>
                ))}
              </ol>
            ) : (
              <p className="text-muted-foreground mt-1.5">{t('designer:cronAssistant.noPreview')}</p>
            )}
            <p className="text-muted-foreground mt-1.5">
              {t('designer:cronAssistant.previewTimezone', { timezone: timeZone })}
            </p>
          </div>
          {!validation.valid && (
            <FieldError>
              {t(validation.issue?.key ?? 'errors:cronSchedule.invalid', validation.issue?.params)}
            </FieldError>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <Button onClick={onClose} variant="outline">{t('common:action.cancel')}</Button>
          <Button
            ref={applyButtonRef}
            disabled={!canApply}
            title={canApply ? undefined : t('designer:cronAssistant.applyUnavailable')}
            onClick={() => {
              if (!canApply) return
              onApply(validation.expression ?? expression)
            }}
          >
            {t('designer:cronAssistant.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function clampNumber(raw: string, min: number, max: number, fallback: number): number {
  if (raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < min || value > max) return fallback
  return value
}

type DescribeTranslator = (key: 'designer:cronAssistant.modeEveryNMinutes' | 'designer:cronAssistant.modeHourly' | 'designer:cronAssistant.modeDaily' | 'designer:cronAssistant.modeWeekly' | `designer:cronAssistant.weekdayShort.${'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'}`, params?: Record<string, unknown>) => string

function describeDraft(draft: CronAssistantDraft, t: DescribeTranslator): string {
  const weekdayRank = (day: number) => WEEKDAY_ORDER.indexOf(day as (typeof WEEKDAY_ORDER)[number])
  const weekdayNames = draft.weekdays
    .slice()
    .sort((left, right) => weekdayRank(left) - weekdayRank(right))
    .map((day) => t(`designer:cronAssistant.weekdayShort.${WEEKDAY_KEYS[day]}`))
    .join(', ')
  const time = `${String(draft.timeHour).padStart(2, '0')}:${String(draft.timeMinute).padStart(2, '0')}`
  switch (draft.mode) {
    case 'every-n-minutes':
      return `${t('designer:cronAssistant.modeEveryNMinutes')} · */${draft.intervalMinutes} * * * *`
    case 'hourly':
      return `${t('designer:cronAssistant.modeHourly')} · ${draft.minuteOfHour} * * * *`
    case 'daily':
      return `${t('designer:cronAssistant.modeDaily')} ${time} · ${draft.timeMinute} ${draft.timeHour} * * *`
    case 'weekly':
      return `${t('designer:cronAssistant.modeWeekly')} ${weekdayNames} ${time}`
  }
}
