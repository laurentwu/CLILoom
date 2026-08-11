import { describe, expect, it } from 'vitest'
import { snapNodePositionHorizontally } from './snapping'

const nodes = [
  {
    id: 'source',
    position: { x: 20, y: 100 },
    measured: { height: 48 }
  },
  {
    id: 'target',
    position: { x: 260, y: 200 },
    measured: { height: 64 }
  },
  {
    id: 'unconnected',
    position: { x: 500, y: 205 },
    measured: { height: 48 }
  }
]

const edges = [{ source: 'source', target: 'target' }]

describe('designer horizontal alignment snapping', () => {
  it('aligns connected node centers when a dragged edge is nearly horizontal', () => {
    expect(snapNodePositionHorizontally({
      nodeId: 'target',
      position: { x: 300, y: 94 },
      nodes,
      edges,
      threshold: 12
    })).toEqual({ x: 300, y: 92 })
  })

  it('does not snap to a nearby node without a connecting edge', () => {
    const position = { x: 480, y: 96 }

    expect(snapNodePositionHorizontally({
      nodeId: 'unconnected',
      position,
      nodes,
      edges,
      threshold: 12
    })).toBe(position)
  })

  it('keeps the free position outside the snapping distance', () => {
    const position = { x: 300, y: 120 }

    expect(snapNodePositionHorizontally({
      nodeId: 'target',
      position,
      nodes,
      edges,
      threshold: 12
    })).toBe(position)
  })
})
