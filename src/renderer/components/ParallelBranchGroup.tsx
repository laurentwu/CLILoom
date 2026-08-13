import { Maximize2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { VariableValue, WorkflowNode } from '../../shared/workflow'
import type { WorkflowRuntimeBranchRun, WorkflowRuntimeNodeRun } from '../../shared/workflowRuntime'
import type { TerminalRetryMode } from '../../shared/terminalSession'
import { getBranchRouteNodeIds, getCurrentInputVariables, type TerminalSession } from '../utils'
import { NodeDetailPanel } from './NodeDetailPanel'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type ParallelBranchGroupProps = {
  branches: WorkflowRuntimeBranchRun[]
  gatewayNode?: WorkflowNode
  workflowNodes: WorkflowNode[]
  nodeRuns: Record<string, WorkflowRuntimeNodeRun>
  sessions: TerminalSession[]
  onBranchVariableChange: (branchId: string, key: string, value: VariableValue) => void
  onBranchContinue: (branchId: string) => void
  onRetryNode: (branchId: string, nodeId: string) => void
  onStopTerminal: (sessionId: string) => Promise<void>
  onShowGraph: () => void
  onToggleZoomNode: (nodeId: string) => void
  zoomedNodeId?: string | null
  onLoadTerminalTranscript: (session: TerminalSession) => Promise<void>
  onSendTerminalInput: (sessionId: string, input: string) => void
  onRetryTerminal: (sessionId: string, mode: TerminalRetryMode) => Promise<void>
}

export function ParallelBranchGroup({
  branches,
  gatewayNode,
  workflowNodes,
  nodeRuns,
  sessions,
  onBranchVariableChange,
  onBranchContinue,
  onRetryNode,
  onStopTerminal,
  onShowGraph,
  onToggleZoomNode,
  zoomedNodeId = null,
  onLoadTerminalTranscript,
  onSendTerminalInput,
  onRetryTerminal
}: ParallelBranchGroupProps) {
  const { t } = useTranslation()
  const branchNodes = branches.map((branch) => {
    const routeNodes = getBranchRouteNodeIds(branch)
      .map((nodeId) => workflowNodes.find((item) => item.id === nodeId))
      .filter((node): node is WorkflowNode => Boolean(node))
    const displayNodes =
      routeNodes.length > 0
        ? routeNodes
        : workflowNodes.filter((item) => item.id === branch.currentNodeId || item.id === branch.entryNodeId)
    return { branch, displayNodes }
  })
  const zoomedNodePresent =
    Boolean(zoomedNodeId) &&
    branchNodes.some(({ displayNodes }) => displayNodes.some((node) => node.id === zoomedNodeId))
  const effectiveZoomedNodeId = zoomedNodePresent ? zoomedNodeId : null
  const visibleBranches = effectiveZoomedNodeId
    ? branchNodes.filter(({ displayNodes }) => displayNodes.some((node) => node.id === effectiveZoomedNodeId))
    : branchNodes
  const visibleNodes = visibleBranches.flatMap(({ branch, displayNodes }) =>
    displayNodes
      .filter((node) => !effectiveZoomedNodeId || node.id === effectiveZoomedNodeId)
      .map((node) => ({ branch, node }))
  )

  return (
    <Card className="h-full w-full min-h-0 min-w-0 max-w-full gap-0 py-0">
      <CardHeader className="min-w-0 border-b py-3">
        <CardTitle>{gatewayNode?.name ?? t('node:gateway.parallelDefault')}</CardTitle>
        <CardDescription>
          {effectiveZoomedNodeId ? t('node:parallel.viewingSingle') : t('node:parallel.routesCount', { count: branches.length })}
        </CardDescription>
        <CardAction>
          <Button aria-label={t('node:parallel.viewFullGraphAria')} size="icon-sm" title={t('node:zoom.flowGraph')} variant="outline" onClick={onShowGraph}>
            <Maximize2 />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="min-h-0 min-w-0 max-w-full flex-1 overflow-x-auto overflow-y-hidden p-3">
        <div
          className="grid h-full min-h-0 min-w-full gap-3"
          style={{
            gridTemplateColumns: effectiveZoomedNodeId
              ? 'minmax(0, 1fr)'
              : `repeat(${Math.max(visibleNodes.length, 1)}, minmax(min(380px, 100%), 1fr))`
          }}
        >
          {visibleNodes.map(({ branch, node }) => {
            const nodeSessions = sessions.filter((session) => session.node_id === node.id)
            const isCurrentBranchNode = branch.currentNodeId === node.id
            const isZoomed = effectiveZoomedNodeId === node.id
            return (
              <NodeDetailPanel
                key={`${branch.branchId}:${node.id}`}
                node={node}
                run={nodeRuns[node.id]}
                sessions={nodeSessions}
                variables={branch.variables}
                editableVariables={getCurrentInputVariables(node)}
                canOperate={isCurrentBranchNode && branch.status !== 'completed'}
                isWaitingForInput={isCurrentBranchNode && branch.status === 'waiting-input'}
                onVariableChange={(key, value) => onBranchVariableChange(branch.branchId, key, value)}
                onRetryNode={() => onRetryNode(branch.branchId, node.id)}
                onContinue={() => onBranchContinue(branch.branchId)}
                onStopTerminal={onStopTerminal}
                onShowGraph={() => onToggleZoomNode(node.id)}
                onLoadTerminalTranscript={onLoadTerminalTranscript}
                onSendTerminalInput={onSendTerminalInput}
                onRetryTerminal={onRetryTerminal}
                zoomTitle={isZoomed ? t('node:zoom.backToGateway') : t('node:zoom.zoomIn')}
              />
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
