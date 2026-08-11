import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from 'lucide-react'
import type { WorkflowEdge, WorkflowNode } from '../../shared/workflow'
import { SYSTEM_VARIABLES, SYSTEM_VARIABLE_DESCRIPTIONS, getAvailableUserVariables } from '../../shared/workflow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

type AvailableVariablesProps = {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  nodeId: string
  format: 'interpolation' | 'identifier'
}

export function AvailableVariables({ nodes, edges, nodeId, format }: AvailableVariablesProps) {
  const { t } = useTranslation()
  const userVariables = useMemo(() => getAvailableUserVariables({ nodes, edges }, nodeId), [nodes, edges, nodeId])
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) {
        clearTimeout(copyTimer.current)
      }
    }
  }, [])

  async function copy(value: string, key: string) {
    if (!navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(value)
      setCopiedKey(key)
      if (copyTimer.current !== null) {
        clearTimeout(copyTimer.current)
      }
      copyTimer.current = setTimeout(() => {
        copyTimer.current = null
        setCopiedKey((current) => (current === key ? null : current))
      }, 1200)
    } catch {
      // clipboard unavailable in this context; ignore silently
    }
  }

  const renderValue = (key: string) => (format === 'interpolation' ? `\${${key}}` : key)

  return (
    <section className="flex flex-col gap-3">
      <Separator />
      <div>
        <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{t('designer:variables.title')}</h4>
        <p className="mt-1 text-xs text-muted-foreground">{t('designer:variables.clickHint')}</p>
      </div>
      <div className="flex flex-col gap-1">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium">{t('designer:variables.userVariables')}</span>
          <Badge variant="outline">{userVariables.length}</Badge>
        </div>
        {userVariables.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">{t('designer:variables.empty')}</p>
        ) : (
          userVariables.map((variable) => (
            <Button
              key={variable.key}
              type="button"
              className="h-auto w-full justify-start px-2 py-1.5"
              size="sm"
              variant={copiedKey === variable.key ? 'secondary' : 'ghost'}
              onClick={() => copy(renderValue(variable.key), variable.key)}
              title={t('designer:variables.copyTitle', { value: renderValue(variable.key) })}
            >
              <code className="truncate rounded bg-muted px-1.5 py-0.5 text-xs">{renderValue(variable.key)}</code>
              <span className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground">
                {variable.label || variable.key}
              </span>
              {copiedKey === variable.key ? <Check data-icon="inline-end" /> : <Copy data-icon="inline-end" />}
            </Button>
          ))
        )}
      </div>
      <div className="flex flex-col gap-1">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium">{t('designer:variables.systemVariables')}</span>
          <Badge variant="outline">{SYSTEM_VARIABLES.length}</Badge>
        </div>
        {SYSTEM_VARIABLES.map((key) => (
          <Button
            key={key}
            type="button"
            className="h-auto w-full justify-start px-2 py-1.5"
            size="sm"
            variant={copiedKey === key ? 'secondary' : 'ghost'}
            onClick={() => copy(renderValue(key), key)}
            title={t('designer:variables.copyTitle', { value: renderValue(key) })}
          >
            <code className="truncate rounded bg-muted px-1.5 py-0.5 text-xs">{renderValue(key)}</code>
            <span className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground">
              {t(SYSTEM_VARIABLE_DESCRIPTIONS[key])}
            </span>
            {copiedKey === key ? <Check data-icon="inline-end" /> : <Copy data-icon="inline-end" />}
          </Button>
        ))}
      </div>
    </section>
  )
}
