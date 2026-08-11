import type { XYPosition } from '@xyflow/react'

export const HORIZONTAL_ALIGNMENT_SNAP_DISTANCE = 12

type SnappableNode = {
  id: string
  position: XYPosition
  height?: number
  measured?: {
    height?: number
  }
}

type SnappableEdge = {
  source: string
  target: string
}

type SnapNodePositionOptions = {
  nodeId: string
  position: XYPosition
  nodes: SnappableNode[]
  edges: SnappableEdge[]
  threshold: number
}

function getNodeCenterY(node: SnappableNode, position = node.position): number {
  return position.y + (node.measured?.height ?? node.height ?? 0) / 2
}

export function snapNodePositionHorizontally({
  nodeId,
  position,
  nodes,
  edges,
  threshold
}: SnapNodePositionOptions): XYPosition {
  const draggedNode = nodes.find((node) => node.id === nodeId)
  if (!draggedNode) return position

  const connectedNodeIds = new Set<string>()
  for (const edge of edges) {
    if (edge.source === nodeId) connectedNodeIds.add(edge.target)
    if (edge.target === nodeId) connectedNodeIds.add(edge.source)
  }

  const draggedCenterY = getNodeCenterY(draggedNode, position)
  let closestDistance = threshold
  let snappedCenterY: number | null = null

  for (const node of nodes) {
    if (!connectedNodeIds.has(node.id)) continue

    const centerY = getNodeCenterY(node)
    const distance = Math.abs(centerY - draggedCenterY)
    if (distance <= closestDistance) {
      closestDistance = distance
      snappedCenterY = centerY
    }
  }

  if (snappedCenterY === null) return position

  const draggedNodeHeight = draggedNode.measured?.height ?? draggedNode.height ?? 0
  return {
    x: position.x,
    y: snappedCenterY - draggedNodeHeight / 2
  }
}
