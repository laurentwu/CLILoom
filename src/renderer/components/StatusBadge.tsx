import type { ComponentProps, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { getStatusPresentation, type StatusSource } from '../status'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type StatusBadgeProps = Omit<ComponentProps<typeof Badge>, 'children' | 'variant'> & {
  status: string
  source?: StatusSource
  label?: ReactNode
}

export function StatusBadge({
  status,
  source = 'task',
  label,
  className,
  ...props
}: StatusBadgeProps) {
  const { t } = useTranslation()
  const presentation = getStatusPresentation(status, source)
  const resolvedLabel = label ?? (presentation.labelKey ? t(presentation.labelKey) : presentation.label)

  return (
    <Badge
      {...props}
      className={cn('status-badge', className)}
      data-status-source={source}
      data-status-tone={presentation.tone}
      variant="outline"
    >
      {resolvedLabel}
    </Badge>
  )
}
