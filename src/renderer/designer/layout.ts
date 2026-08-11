type LayoutNode = {
  id: string
  position: {
    x: number
    y: number
  }
  width?: number
  height?: number
  measured?: {
    width?: number
    height?: number
  }
}

type LayoutEdge = {
  source: string
  target: string
}

type ArrangeNodesOptions = {
  firstNodeIds?: string[]
  gap?: number
  horizontalGap?: number
  verticalGap?: number
  defaultNodeWidth?: number
  defaultNodeHeight?: number
}

const DESIGNER_NODE_HORIZONTAL_GAP = 100
const DESIGNER_NODE_VERTICAL_GAP = 100
const DESIGNER_NODE_DEFAULT_WIDTH = 176
const DESIGNER_NODE_DEFAULT_HEIGHT = 50

function getStronglyConnectedComponents(
  nodeIds: string[],
  adjacency: Map<string, string[]>
): string[][] {
  const visitIndexes = new Map<string, number>()
  const lowLinks = new Map<string, number>()
  const stack: string[] = []
  const nodesOnStack = new Set<string>()
  const components: string[][] = []
  let nextVisitIndex = 0

  function visit(nodeId: string) {
    const visitIndex = nextVisitIndex
    nextVisitIndex += 1
    visitIndexes.set(nodeId, visitIndex)
    lowLinks.set(nodeId, visitIndex)
    stack.push(nodeId)
    nodesOnStack.add(nodeId)

    for (const targetId of adjacency.get(nodeId) ?? []) {
      if (!visitIndexes.has(targetId)) {
        visit(targetId)
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId)!, lowLinks.get(targetId)!))
      } else if (nodesOnStack.has(targetId)) {
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId)!, visitIndexes.get(targetId)!))
      }
    }

    if (lowLinks.get(nodeId) !== visitIndexes.get(nodeId)) return

    const component: string[] = []
    let currentNodeId: string
    do {
      currentNodeId = stack.pop()!
      nodesOnStack.delete(currentNodeId)
      component.push(currentNodeId)
    } while (currentNodeId !== nodeId)
    components.push(component)
  }

  for (const nodeId of nodeIds) {
    if (!visitIndexes.has(nodeId)) visit(nodeId)
  }

  return components
}

function getWorkflowNodeOrder(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  firstNodeIds: string[]
): string[] {
  const nodeIndex = new Map(nodes.map((node, index) => [node.id, index]))
  const adjacency = new Map(nodes.map((node) => [node.id, [] as string[]]))
  const validEdges: LayoutEdge[] = []
  const connections = new Set<string>()

  for (const edge of edges) {
    if (!nodeIndex.has(edge.source) || !nodeIndex.has(edge.target)) continue
    const connectionKey = `${edge.source}\0${edge.target}`
    if (connections.has(connectionKey)) continue
    connections.add(connectionKey)
    adjacency.get(edge.source)!.push(edge.target)
    validEdges.push(edge)
  }

  for (const targets of adjacency.values()) {
    targets.sort((left, right) => nodeIndex.get(left)! - nodeIndex.get(right)!)
  }

  const components = getStronglyConnectedComponents(nodes.map((node) => node.id), adjacency)
  const componentByNodeId = new Map<string, number>()
  const componentOrder = components.map((component, componentId) => {
    for (const nodeId of component) componentByNodeId.set(nodeId, componentId)
    return Math.min(...component.map((nodeId) => nodeIndex.get(nodeId)!))
  })
  const componentAdjacency = components.map(() => new Set<number>())
  const componentIncomingCount = components.map(() => 0)

  for (const edge of validEdges) {
    const sourceComponentId = componentByNodeId.get(edge.source)!
    const targetComponentId = componentByNodeId.get(edge.target)!
    if (
      sourceComponentId === targetComponentId
      || componentAdjacency[sourceComponentId].has(targetComponentId)
    ) continue
    componentAdjacency[sourceComponentId].add(targetComponentId)
    componentIncomingCount[targetComponentId] += 1
  }

  const preferredComponentIds = new Set<number>()
  const preferredQueue = firstNodeIds
    .map((nodeId) => componentByNodeId.get(nodeId))
    .filter((componentId): componentId is number => componentId !== undefined)

  for (const componentId of preferredQueue) preferredComponentIds.add(componentId)
  for (let index = 0; index < preferredQueue.length; index += 1) {
    for (const targetComponentId of componentAdjacency[preferredQueue[index]]) {
      if (preferredComponentIds.has(targetComponentId)) continue
      preferredComponentIds.add(targetComponentId)
      preferredQueue.push(targetComponentId)
    }
  }

  function compareComponents(left: number, right: number) {
    const preferredDifference =
      Number(!preferredComponentIds.has(left)) - Number(!preferredComponentIds.has(right))
    return preferredDifference || componentOrder[left] - componentOrder[right]
  }

  const readyComponentIds = componentIncomingCount
    .map((incomingCount, componentId) => ({ componentId, incomingCount }))
    .filter(({ incomingCount }) => incomingCount === 0)
    .map(({ componentId }) => componentId)
    .sort(compareComponents)
  const orderedComponentIds: number[] = []

  while (readyComponentIds.length > 0) {
    const componentId = readyComponentIds.shift()!
    orderedComponentIds.push(componentId)

    for (const targetComponentId of componentAdjacency[componentId]) {
      componentIncomingCount[targetComponentId] -= 1
      if (componentIncomingCount[targetComponentId] === 0) {
        readyComponentIds.push(targetComponentId)
        readyComponentIds.sort(compareComponents)
      }
    }
  }

  const entryNodeIds = new Set(firstNodeIds)
  for (const edge of validEdges) {
    if (componentByNodeId.get(edge.source) === componentByNodeId.get(edge.target)) continue
    entryNodeIds.add(edge.target)
  }

  return orderedComponentIds.flatMap((componentId) => {
    const componentNodeIds = [...components[componentId]]
      .sort((left, right) => nodeIndex.get(left)! - nodeIndex.get(right)!)
    return [
      ...componentNodeIds.filter((nodeId) => entryNodeIds.has(nodeId)),
      ...componentNodeIds.filter((nodeId) => !entryNodeIds.has(nodeId))
    ]
  })
}

function getNodeWidth(node: LayoutNode, defaultNodeWidth: number): number {
  const width = node.measured?.width ?? node.width
  return width && width > 0 ? width : defaultNodeWidth
}

function getNodeHeight(node: LayoutNode, defaultNodeHeight: number): number {
  const height = node.measured?.height ?? node.height
  return height && height > 0 ? height : defaultNodeHeight
}

export function arrangeWorkflowNodesLeftToRight<T extends LayoutNode>(
  nodes: T[],
  edges: LayoutEdge[],
  options: ArrangeNodesOptions = {}
): T[] {
  if (nodes.length === 0) return nodes

  const horizontalGap = options.horizontalGap ?? options.gap ?? DESIGNER_NODE_HORIZONTAL_GAP
  const verticalGap = options.verticalGap ?? options.gap ?? DESIGNER_NODE_VERTICAL_GAP
  const defaultNodeWidth = options.defaultNodeWidth ?? DESIGNER_NODE_DEFAULT_WIDTH
  const defaultNodeHeight = options.defaultNodeHeight ?? DESIGNER_NODE_DEFAULT_HEIGHT
  const originX = Math.min(...nodes.map((node) => node.position.x))
  const originY = Math.min(...nodes.map((node) => node.position.y))
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const orderedNodeIds = getWorkflowNodeOrder(nodes, edges, options.firstNodeIds ?? [])
  const orderByNodeId = new Map(orderedNodeIds.map((nodeId, index) => [nodeId, index]))
  const incomingNodeIds = new Map(nodes.map((node) => [node.id, [] as string[]]))

  for (const edge of edges) {
    const sourceOrder = orderByNodeId.get(edge.source)
    const targetOrder = orderByNodeId.get(edge.target)
    if (sourceOrder === undefined || targetOrder === undefined || sourceOrder >= targetOrder) continue
    incomingNodeIds.get(edge.target)!.push(edge.source)
  }

  const columnByNodeId = new Map<string, number>()
  const columns = new Map<number, string[]>()

  for (const nodeId of orderedNodeIds) {
    const column = (incomingNodeIds.get(nodeId) ?? []).reduce(
      (furthestColumn, sourceNodeId) => Math.max(
        furthestColumn,
        (columnByNodeId.get(sourceNodeId) ?? -1) + 1
      ),
      0
    )
    columnByNodeId.set(nodeId, column)
    columns.set(column, [...(columns.get(column) ?? []), nodeId])
  }

  const positions = new Map<string, LayoutNode['position']>()
  const orderedColumns = [...columns.entries()].sort(([left], [right]) => left - right)
  const columnHeights = orderedColumns.map(([, nodeIds]) => (
    nodeIds.reduce(
      (height, nodeId) => height + getNodeHeight(nodeById.get(nodeId)!, defaultNodeHeight),
      0
    ) + Math.max(0, nodeIds.length - 1) * verticalGap
  ))
  const layoutHeight = Math.max(...columnHeights)
  let nextX = originX

  orderedColumns.forEach(([, nodeIds], columnIndex) => {
    const columnWidth = Math.max(
      ...nodeIds.map((nodeId) => getNodeWidth(nodeById.get(nodeId)!, defaultNodeWidth))
    )
    let nextY = originY + (layoutHeight - columnHeights[columnIndex]) / 2

    for (const nodeId of nodeIds) {
      const node = nodeById.get(nodeId)!
      positions.set(nodeId, { x: nextX, y: nextY })
      nextY += getNodeHeight(node, defaultNodeHeight) + verticalGap
    }

    nextX += columnWidth + horizontalGap
  })

  return nodes.map((node) => {
    const position = positions.get(node.id)
    if (!position) return node
    return {
      ...node,
      position
    }
  })
}
