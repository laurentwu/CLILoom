import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Maximize2, Play, Plus, Square, SquareTerminal, X } from 'lucide-react'
import type { VariableDefinition, VariableValue, WorkflowNode } from '../../shared/workflow'
import { NodeIcon } from './NodeIcon'
import { StatusBadge } from './StatusBadge'
import { TerminalOutputPane, TerminalPane } from './TerminalPane'
import { VariableField } from './VariableField'
import { canAcceptTerminalInput, type NodeRun, type TerminalSession } from '../utils'
import { getStatusPresentation, type StatusSource } from '../status'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { FieldGroup } from '@/components/ui/field'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

type NodeDetailPanelProps = {
  node: WorkflowNode
  run?: NodeRun
  sessions: TerminalSession[]
  variables: Record<string, VariableValue>
  editableVariables: VariableDefinition[]
  canOperate: boolean
  isRunning: boolean
  isWaitingForInput: boolean
  onVariableChange: (key: string, value: VariableValue) => void
  onRun: () => void
  onContinue: () => void
  onStop: () => void
  onShowGraph: () => void
  onLoadTerminalTranscript: (session: TerminalSession) => Promise<void>
  onSendTerminalInput: (sessionId: string, input: string) => void
  onRetryTerminal: (sessionId: string) => Promise<void>
  zoomTitle?: string
  className?: string
}

export function NodeDetailPanel({
  node,
  run,
  sessions,
  variables,
  editableVariables,
  canOperate,
  isRunning,
  isWaitingForInput,
  onVariableChange,
  onRun,
  onContinue,
  onStop,
  onShowGraph,
  onLoadTerminalTranscript,
  onSendTerminalInput,
  onRetryTerminal,
  zoomTitle,
  className
}: NodeDetailPanelProps) {
  const status = run?.status ?? 'pending'
  const { t } = useTranslation()
  const resolvedZoomTitle = zoomTitle ?? t('node:zoom.flowGraph')
  const renderStatus = (statusValue: string, source: StatusSource): string => {
    const presentation = getStatusPresentation(statusValue, source)
    return presentation.labelKey ? t(presentation.labelKey) : (presentation.label ?? statusValue)
  }
  const resolvedStatusLabel = renderStatus(status, 'node')
  const isTerminalNode = node.type.includes('terminal')
  const canEditVariables = canOperate && (node.type === 'start' || (node.type === 'input' && isWaitingForInput))
  const showStopAction = canOperate && isRunning
  const latestSessionId = sessions.at(-1)?.id ?? null
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(latestSessionId)
  const selectedSession = sessions.find((session) => session.id === selectedSessionId) ?? sessions.at(-1)
  const statusText =
    run?.exitCode === undefined || run.exitCode === null
      ? resolvedStatusLabel
      : t('node:status.withExitCode', { label: resolvedStatusLabel, code: run.exitCode })

  useEffect(() => {
    setSelectedSessionId(latestSessionId)
  }, [latestSessionId, node.id])

  return (
    <Card
      className={cn('node-detail-panel h-full w-full min-h-0 min-w-0 max-w-full gap-0 py-0', className)}
      data-node-type={node.type}
      data-node-id={node.id}
    >
      <CardHeader className="node-detail-panel__header min-w-0 border-b py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
            <NodeIcon node={node} />
          </div>
          <div className="min-w-0">
            <CardTitle className="truncate" title={node.name}>{node.name}</CardTitle>
          </div>
        </div>
        <CardAction className="node-detail-panel__actions flex items-center gap-2">
          <StatusBadge label={statusText} source="node" status={status} />
          {showStopAction && (
            <Button size="sm" variant="destructive" onClick={onStop}>
              <Square data-icon="inline-start" />
              {t('common:action.stop')}
            </Button>
          )}
          {canOperate && !isRunning && isWaitingForInput && (
            <Button size="sm" onClick={onContinue}>
              <Play data-icon="inline-start" />
              {t('common:action.continue')}
            </Button>
          )}
          {canOperate && !isRunning && !isWaitingForInput && status !== 'completed' && (
            <Button size="sm" onClick={onRun}>
              <Play data-icon="inline-start" />
              {t('common:action.run')}
            </Button>
          )}
          <Button aria-label={resolvedZoomTitle} size="icon-sm" title={resolvedZoomTitle} variant="outline" onClick={onShowGraph}>
            <Maximize2 />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="min-h-0 min-w-0 max-w-full flex-1 overflow-hidden p-0">
        {isTerminalNode ? (
          <div className="flex h-full w-full min-h-0 min-w-0 max-w-full flex-col gap-3 overflow-hidden p-4">
            {sessions.length > 1 && selectedSession && (
              <Select value={selectedSession.id} onValueChange={setSelectedSessionId}>
                <SelectTrigger aria-label={t('node:terminal.selectSession')} className="max-w-72 shrink-0" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sessions.map((session, index) => (
                    <SelectItem key={session.id} value={session.id}>
                      {t('node:terminal.sessionLabel', {
                        index: index + 1,
                        status: renderStatus(session.status, 'terminal')
                      })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {selectedSession ? (
              <TerminalPane
                className="w-full min-h-0 min-w-0 max-w-full flex-1"
                key={selectedSession.id}
                session={selectedSession}
                onLoadTranscript={onLoadTerminalTranscript}
                onSendInput={onSendTerminalInput}
                onRetry={onRetryTerminal}
                disabled={!canAcceptTerminalInput(selectedSession)}
              />
            ) : (
              <TerminalOutputPane
                className="w-full min-h-0 min-w-0 max-w-full flex-1"
                id={`node-output:${node.id}:${run?.sessionId ?? 'pending'}`}
                text={run?.stdout || run?.stderr || t('node:output.empty')}
              />
            )}
          </div>
        ) : (
          <ScrollArea className="h-full" data-independent-scroll-region>
            <div className="flex flex-col gap-4 p-4">
              {(node.type === 'start' || node.type === 'input') && (
                <section>
                  {editableVariables.length === 0 ? (
                    <Empty className="border">
                      <EmptyHeader>
                        <EmptyTitle>{t('node:variable.emptyTitle')}</EmptyTitle>
                        <EmptyDescription>{t('node:variable.emptyDescription')}</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <FieldGroup className="grid gap-3 md:grid-cols-2">
                      {editableVariables.map((variable) => (
                        <VariableField
                          key={variable.key}
                          variable={variable}
                          value={variables[variable.key]}
                          onChange={(value) => onVariableChange(variable.key, value)}
                          disabled={!canEditVariables}
                        />
                      ))}
                    </FieldGroup>
                  )}
                </section>
              )}

              {node.type === 'exclusive-gateway' && (
                <section>
                  <div className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm">
                    <X />
                    <span>{run?.stdout || (status === 'completed' ? t('node:gateway.decisionCompleted') : t('node:gateway.decisionPending'))}</span>
                  </div>
                </section>
              )}

              {node.type === 'parallel-gateway' && (
                <section>
                  <div className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm">
                    <Plus />
                    <span>{run?.stdout || (status === 'completed' ? t('status:task.completed') : t('node:gateway.branchPending'))}</span>
                  </div>
                </section>
              )}

              {node.type === 'end' && (
                <Empty className="border bg-muted/30">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <SquareTerminal />
                    </EmptyMedia>
                    <EmptyTitle>{status === 'completed' ? t('node:end.completedTitle') : t('node:end.pendingTitle')}</EmptyTitle>
                    <EmptyDescription>
                      {status === 'completed' ? t('node:end.completedDescription') : t('node:end.pendingDescription')}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
