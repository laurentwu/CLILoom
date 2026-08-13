import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react'
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WorkflowDefinition } from '../../shared/workflow'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type FlowEdgeData = {
  workflowEdge: WorkflowDefinition['edges'][number]
  onDelete?: (edgeId: string) => void
}
type FlowEdgeType = Edge<FlowEdgeData, 'designerEdge'>

export function DesignerFlowEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  selected,
  label,
  data
}: EdgeProps<FlowEdgeType>) {
  const { t } = useTranslation()
  const displayLabel = data?.workflowEdge.isDefault
    ? t('designer:edge.defaultLabel')
    : label
  const isBackwardEdge = targetX < sourceX
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 8,
    centerY: isBackwardEdge ? Math.max(sourceY, targetY) + 150 : undefined
  })

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: selected ? 'var(--primary)' : 'var(--muted-foreground)',
          strokeWidth: selected ? 2 : 1.5,
          ...style
        }}
      />
      {displayLabel && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-auto absolute flex items-center gap-1"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            <Badge variant="outline">{displayLabel}</Badge>
            {selected && data?.onDelete && (
              <Button
                aria-label={t('designer:edge.delete.aria')}
                size="icon-xs"
                title={t('designer:edge.delete.tooltip')}
                variant="destructive"
                onClick={(event) => {
                  event.stopPropagation()
                  data.onDelete?.(id)
                }}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
