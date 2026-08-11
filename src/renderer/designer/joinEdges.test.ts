import { describe, expect, it } from 'vitest'
import { pruneJoinIncomingEdgeIds } from './joinEdges'
import { validateWorkflow, type WorkflowDefinition, type WorkflowNode } from '../../shared/workflow'

function workflow(nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes
}

function baseWorkflow(joinConfig: WorkflowNode['config']): WorkflowDefinition {
  return {
    id: 'wf',
    name: 'WF',
    nodes: [
      { id: 'start', type: 'start', name: 'Start', config: { variables: [{ key: 'prompt', label: 'Prompt', type: 'text', required: true }] } },
      { id: 'a', type: 'non-interactive-terminal', name: 'A', config: { command: 'echo a', cwd: '${sys_project_dir}', successExitCodes: [0] } },
      { id: 'join', type: 'parallel-gateway', name: 'Join', config: joinConfig },
      { id: 'end', type: 'end', name: 'End', config: {} }
    ],
    edges: [
      { id: 'e-start-a', from: 'start', to: 'a' },
      { id: 'e-a-join', from: 'a', to: 'join' },
      { id: 'e-join-end', from: 'join', to: 'end' }
    ]
  }
}

const missingEdge = 'errors:workflowValidation.joinIncomingEdgeIdsMissingEdge'
const needsEdgeIds = 'errors:workflowValidation.joinNeedsIncomingEdgeIds'

describe('pruneJoinIncomingEdgeIds', () => {
  it('returns the same array reference when no edges are removed', () => {
    const nodes = workflow([
      { id: 'join', type: 'parallel-gateway', name: 'Join', config: { mode: 'join', joinIncomingEdgeIds: ['e1'] } }
    ])

    expect(pruneJoinIncomingEdgeIds(nodes, new Set())).toBe(nodes)
  })

  it('removes stale edge references from join nodes', () => {
    const nodes = workflow([
      { id: 'join', type: 'parallel-gateway', name: 'Join', config: { mode: 'join', joinIncomingEdgeIds: ['e1', 'e2', 'e3'] } }
    ])

    const pruned = pruneJoinIncomingEdgeIds(nodes, new Set(['e2']))

    expect(pruned[0].config).toEqual({ mode: 'join', joinIncomingEdgeIds: ['e1', 'e3'] })
  })

  it('drops joinIncomingEdgeIds entirely when every referenced edge is removed', () => {
    const nodes = workflow([
      { id: 'join', type: 'parallel-gateway', name: 'Join', config: { mode: 'join', joinIncomingEdgeIds: ['e1', 'e2'] } }
    ])

    const pruned = pruneJoinIncomingEdgeIds(nodes, new Set(['e1', 'e2']))

    expect(pruned[0].config).toEqual({ mode: 'join' })
    expect('joinIncomingEdgeIds' in pruned[0].config).toBe(false)
  })

  it('keeps joinIncomingEdgeIds untouched when none of its edges were removed', () => {
    const nodes = workflow([
      { id: 'join', type: 'parallel-gateway', name: 'Join', config: { mode: 'join', joinIncomingEdgeIds: ['e1', 'e2'] } }
    ])

    const pruned = pruneJoinIncomingEdgeIds(nodes, new Set(['other']))

    expect(pruned[0].config).toEqual({ mode: 'join', joinIncomingEdgeIds: ['e1', 'e2'] })
  })

  it('leaves split gateways and other node types unchanged when they have no joinIncomingEdgeIds', () => {
    const nodes = workflow([
      { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split' } },
      { id: 'start', type: 'start', name: 'Start', config: {} },
      { id: 'join', type: 'parallel-gateway', name: 'Join', config: { mode: 'join', joinIncomingEdgeIds: ['e1'] } }
    ])

    const pruned = pruneJoinIncomingEdgeIds(nodes, new Set(['e1']))

    expect(pruned[0]).toBe(nodes[0])
    expect(pruned[1]).toBe(nodes[1])
    expect(pruned[2].config).toEqual({ mode: 'join' })
  })

  it('prunes stale joinIncomingEdgeIds from split gateways too', () => {
    const nodes = workflow([
      { id: 'split', type: 'parallel-gateway', name: 'Split', config: { mode: 'split', joinIncomingEdgeIds: ['e1', 'e2'] } }
    ])

    const pruned = pruneJoinIncomingEdgeIds(nodes, new Set(['e1']))

    expect(pruned[0].config).toEqual({ mode: 'split', joinIncomingEdgeIds: ['e2'] })

    const emptied = pruneJoinIncomingEdgeIds(nodes, new Set(['e1', 'e2']))

    expect(emptied[0].config).toEqual({ mode: 'split' })
    expect('joinIncomingEdgeIds' in emptied[0].config).toBe(false)
  })

  it('preserves join nodes that have no joinIncomingEdgeIds configured', () => {
    const nodes = workflow([
      { id: 'join', type: 'parallel-gateway', name: 'Join', config: { mode: 'join' } }
    ])

    expect(pruneJoinIncomingEdgeIds(nodes, new Set(['e1']))).toBe(nodes)
  })

  it('clears joinIncomingEdgeIdsMissingEdge after pruning stale references', () => {
    const wf = baseWorkflow({ mode: 'join', joinIncomingEdgeIds: ['e-a-join', 'e-gone'] })

    const prunedNodes = pruneJoinIncomingEdgeIds(wf.nodes, new Set(['e-gone']))
    const keys = validateWorkflow({ ...wf, nodes: [...prunedNodes] }).map((issue) => issue.key)

    expect(keys).not.toContain(missingEdge)
  })

  it('reports joinNeedsIncomingEdgeIds once every incoming reference is pruned', () => {
    const wf = baseWorkflow({ mode: 'join', joinIncomingEdgeIds: ['e-gone'] })

    const prunedNodes = pruneJoinIncomingEdgeIds(wf.nodes, new Set(['e-gone']))
    const keys = validateWorkflow({ ...wf, nodes: [...prunedNodes] }).map((issue) => issue.key)

    expect(keys).not.toContain(missingEdge)
    expect(keys).toContain(needsEdgeIds)
  })

  it('clears join refs when deleting a node cascades to its connected edges', () => {
    const wf = baseWorkflow({ mode: 'join', joinIncomingEdgeIds: ['e-a-join'] })
    const removedNodeIds = new Set(['a'])
    const removedEdgeIds = new Set(
      wf.edges.filter((edge) => removedNodeIds.has(edge.from) || removedNodeIds.has(edge.to)).map((edge) => edge.id)
    )
    const remainingNodes = wf.nodes.filter((node) => !removedNodeIds.has(node.id))
    const remainingEdges = wf.edges.filter((edge) => !removedNodeIds.has(edge.from) && !removedNodeIds.has(edge.to))
    const prunedNodes = pruneJoinIncomingEdgeIds(remainingNodes, removedEdgeIds)

    const keys = validateWorkflow({ ...wf, nodes: [...prunedNodes], edges: remainingEdges }).map((issue) => issue.key)

    expect(keys).not.toContain(missingEdge)
    expect(keys).toContain(needsEdgeIds)
  })
})
