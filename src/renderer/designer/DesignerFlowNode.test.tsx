// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowNode } from '../../shared/workflow'
import { i18n } from '../i18n'
import { DesignerFlowNode } from './DesignerFlowNode'

vi.mock('@xyflow/react', async () => {
  const React = await import('react')
  return {
    Handle: ({ position, type }: { position: string; type: 'source' | 'target' }) => React.createElement('span', {
      'data-position': position,
      'data-testid': `${type}-handle`
    }),
    Position: { Left: 'left', Right: 'right' }
  }
})

afterEach(cleanup)

function renderFlowNode(workflowNode: WorkflowNode) {
  render(
    <I18nextProvider i18n={i18n}>
      <DesignerFlowNode {...({
        data: { workflowNode },
        selected: false
      } as Parameters<typeof DesignerFlowNode>[0])} />
    </I18nextProvider>
  )
}

describe('DesignerFlowNode handles', () => {
  it('only exposes an outgoing handle for start nodes', () => {
    renderFlowNode({ id: 'start', type: 'start', name: 'Start', config: { variables: [] } })

    expect(screen.queryByTestId('target-handle')).toBeNull()
    expect(screen.getByTestId('source-handle').dataset.position).toBe('right')
  })

  it('exposes incoming and outgoing handles for terminal nodes', () => {
    renderFlowNode({
      id: 'terminal',
      type: 'interactive-terminal',
      name: 'Terminal',
      config: { command: 'bash', cwd: '${sys_project_dir}', autoStart: true }
    })

    expect(screen.getByTestId('target-handle').dataset.position).toBe('left')
    expect(screen.getByTestId('source-handle').dataset.position).toBe('right')
  })

  it('only exposes an incoming handle for end nodes', () => {
    renderFlowNode({ id: 'end', type: 'end', name: 'End', config: {} })

    expect(screen.getByTestId('target-handle').dataset.position).toBe('left')
    expect(screen.queryByTestId('source-handle')).toBeNull()
  })
})
