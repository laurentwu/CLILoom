import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WorkflowNode } from '../../shared/workflow'

vi.mock('lucide-react', () => ({
  Check: () => <i data-icon="check" />,
  Circle: () => <i data-icon="circle" />,
  Plus: () => <i data-icon="plus" />,
  SquareTerminal: () => <i data-icon="square-terminal" />,
  X: () => <i data-icon="x" />
}))

const { NodeIcon } = await import('./NodeIcon')

function nodeOf(type: WorkflowNode['type']): WorkflowNode {
  return { id: type, type, name: type, config: {} } as unknown as WorkflowNode
}

function markup(type: WorkflowNode['type']): string {
  return renderToStaticMarkup(<NodeIcon node={nodeOf(type)} />)
}

describe('NodeIcon', () => {
  it('renders Plus for parallel gateway', () => {
    expect(markup('parallel-gateway')).toContain('data-icon="plus"')
  })

  it('renders X for exclusive gateway', () => {
    expect(markup('exclusive-gateway')).toContain('data-icon="x"')
  })

  it('renders SquareTerminal for terminal nodes', () => {
    expect(markup('interactive-terminal')).toContain('data-icon="square-terminal"')
    expect(markup('non-interactive-terminal')).toContain('data-icon="square-terminal"')
  })

  it('renders Circle for start and end nodes', () => {
    expect(markup('start')).toContain('data-icon="circle"')
    expect(markup('end')).toContain('data-icon="circle"')
  })

  it('falls back to Check for other node types', () => {
    expect(markup('input')).toContain('data-icon="check"')
  })
})
