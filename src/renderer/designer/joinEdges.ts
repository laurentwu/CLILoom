import type { ParallelGatewayConfig, WorkflowNode } from '../../shared/workflow'

export function pruneJoinIncomingEdgeIds(
  nodes: readonly WorkflowNode[],
  removedEdgeIds: ReadonlySet<string>
): readonly WorkflowNode[] {
  if (removedEdgeIds.size === 0) return nodes
  let changed = false
  const next = nodes.map((node) => {
    const config = node.config
    if (!('mode' in config) || !config.joinIncomingEdgeIds) {
      return node
    }
    const filtered = config.joinIncomingEdgeIds.filter((id) => !removedEdgeIds.has(id))
    if (filtered.length === config.joinIncomingEdgeIds.length) return node
    changed = true
    const nextConfig: ParallelGatewayConfig = filtered.length > 0
      ? { mode: config.mode, joinIncomingEdgeIds: filtered }
      : { mode: config.mode }
    return { ...node, config: nextConfig }
  })
  return changed ? next : nodes
}
