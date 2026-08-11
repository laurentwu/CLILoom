import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import type { WorkflowNode } from '../../shared/workflow'
import { NodeIcon } from '../components/NodeIcon'
import { StatusBadge } from '../components/StatusBadge'
import { getNodeTypeLabel } from '../utils'
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

type FlowNodeData = {
  workflowNode: WorkflowNode
  status?: string
}
type FlowNodeType = Node<FlowNodeData, 'workflowNode'>

export function DesignerFlowNode({ data, selected }: NodeProps<FlowNodeType>) {
  const { t } = useTranslation()
  const node = data.workflowNode
  const status = data.status

  return (
    <Card
      className={cn('w-44 gap-0 py-0 shadow-sm transition-shadow hover:shadow-md', selected && 'ring-2 ring-primary')}
      size="sm"
    >
      {node.type !== 'start' && (
        <Handle className="!size-3 !border-2 !border-background !bg-primary" type="target" position={Position.Left} />
      )}
      <CardHeader className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 py-2 [&_[data-slot=card-action]]:col-start-3">
        <div className="flex size-8 items-center justify-center rounded-lg bg-muted [&_svg]:size-4">
          <NodeIcon node={node} />
        </div>
        <div className="min-w-0">
          <CardTitle className="truncate">{node.name}</CardTitle>
          <CardDescription className="truncate text-xs">{t(getNodeTypeLabel(node.type))}</CardDescription>
        </div>
        {status && status !== 'pending' && (
          <CardAction>
            <StatusBadge source="node" status={status} />
          </CardAction>
        )}
      </CardHeader>
      {node.type !== 'end' && (
        <Handle className="!size-3 !border-2 !border-background !bg-primary" type="source" position={Position.Right} />
      )}
    </Card>
  )
}
