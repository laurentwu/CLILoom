import { describe, expect, it } from 'vitest'
import { arrangeWorkflowNodesLeftToRight } from './layout'

const DEFAULT_COLUMN_STEP = 276
const DEFAULT_ROW_STEP = 150

describe('designer workflow node layout', () => {
  it('places a linear workflow from left to right in connection order', () => {
    const nodes = [
      { id: 'end', position: { x: 500, y: 80 }, measured: { width: 40 } },
      { id: 'start', position: { x: 20, y: 120 }, measured: { width: 50 } },
      { id: 'middle', position: { x: 200, y: 40 }, measured: { width: 60 } }
    ]
    const arranged = arrangeWorkflowNodesLeftToRight(
      nodes,
      [
        { source: 'start', target: 'middle' },
        { source: 'middle', target: 'end' }
      ],
      { firstNodeIds: ['start'] }
    )
    const positions = Object.fromEntries(arranged.map((node) => [node.id, node.position]))

    expect(positions).toEqual({
      end: { x: 330, y: 40 },
      start: { x: 20, y: 40 },
      middle: { x: 170, y: 40 }
    })
  })

  it('places parallel branches in the same column and puts their join in the next column', () => {
    const nodes = ['start', 'split', 'branch-b', 'branch-a', 'join', 'end'].map((id) => ({
      id,
      position: { x: 0, y: 0 }
    }))
    const arranged = arrangeWorkflowNodesLeftToRight(
      nodes,
      [
        { source: 'start', target: 'split' },
        { source: 'split', target: 'branch-a' },
        { source: 'split', target: 'branch-b' },
        { source: 'branch-a', target: 'join' },
        { source: 'branch-b', target: 'join' },
        { source: 'join', target: 'end' }
      ],
      { firstNodeIds: ['start'] }
    )
    const positions = Object.fromEntries(arranged.map((node) => [node.id, node.position]))
    expect(positions['branch-b'].x).toBe(2 * DEFAULT_COLUMN_STEP)
    expect(positions['branch-a'].x).toBe(2 * DEFAULT_COLUMN_STEP)
    expect(positions['branch-a'].y - positions['branch-b'].y).toBe(DEFAULT_ROW_STEP)
    expect(positions.join.x).toBe(3 * DEFAULT_COLUMN_STEP)
    expect(positions.start.y).toBe(positions.join.y)
  })

  it('places a join after the longest parallel branch', () => {
    const nodes = ['start', 'split', 'short', 'long-1', 'long-2', 'join', 'end'].map((id) => ({
      id,
      position: { x: 0, y: 0 }
    }))
    const arranged = arrangeWorkflowNodesLeftToRight(
      nodes,
      [
        { source: 'start', target: 'split' },
        { source: 'split', target: 'short' },
        { source: 'split', target: 'long-1' },
        { source: 'short', target: 'join' },
        { source: 'long-1', target: 'long-2' },
        { source: 'long-2', target: 'join' },
        { source: 'join', target: 'end' }
      ],
      { firstNodeIds: ['start'] }
    )
    const positions = Object.fromEntries(arranged.map((node) => [node.id, node.position]))

    expect(positions.short.x).toBe(positions['long-1'].x)
    expect(positions['long-2'].x).toBeLessThan(positions.join.x)
  })

  it('uses the workflow entry to order loops and leaves exactly 100px between cards', () => {
    const nodes = ['cycle-b', 'end', 'start', 'cycle-a'].map((id) => ({
      id,
      position: { x: 10, y: 30 }
    }))
    const arranged = arrangeWorkflowNodesLeftToRight(
      nodes,
      [
        { source: 'start', target: 'cycle-a' },
        { source: 'cycle-a', target: 'cycle-b' },
        { source: 'cycle-b', target: 'cycle-a' },
        { source: 'cycle-b', target: 'end' }
      ],
      { firstNodeIds: ['start'] }
    )
    const orderedNodes = [...arranged].sort((left, right) => left.position.x - right.position.x)

    expect(orderedNodes.map((node) => node.id)).toEqual(['start', 'cycle-a', 'cycle-b', 'end'])
    expect(orderedNodes.map((node) => node.position.x)).toEqual([
      10,
      10 + DEFAULT_COLUMN_STEP,
      10 + DEFAULT_COLUMN_STEP * 2,
      10 + DEFAULT_COLUMN_STEP * 3
    ])
  })
})
