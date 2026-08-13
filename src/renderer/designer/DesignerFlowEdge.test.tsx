// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from '../../shared/i18n'
import { DesignerFlowEdge } from './DesignerFlowEdge'

vi.mock('@xyflow/react', async () => {
  const React = await import('react')
  return {
    BaseEdge: () => null,
    EdgeLabelRenderer: ({ children }: { children?: React.ReactNode }) => React.createElement(
      React.Fragment,
      null,
      children
    ),
    getSmoothStepPath: () => ['', 0, 0]
  }
})

afterEach(cleanup)

describe('DesignerFlowEdge labels', () => {
  it('localizes a default branch without relying on a hardcoded edge label', () => {
    const i18n = createI18n('zh')
    render(
      <I18nextProvider i18n={i18n}>
        <DesignerFlowEdge {...({
          id: 'default-edge',
          sourceX: 0,
          sourceY: 0,
          targetX: 100,
          targetY: 0,
          sourcePosition: 'right',
          targetPosition: 'left',
          selected: false,
          data: {
            workflowEdge: {
              id: 'default-edge',
              from: 'gateway',
              to: 'fallback',
              isDefault: true
            }
          }
        } as Parameters<typeof DesignerFlowEdge>[0])} />
      </I18nextProvider>
    )

    expect(screen.getByText('默认')).toBeTruthy()
    expect(screen.queryByText('default')).toBeNull()
  })

  it('keeps the condition label for a non-default branch', () => {
    const i18n = createI18n('en')
    render(
      <I18nextProvider i18n={i18n}>
        <DesignerFlowEdge {...({
          id: 'conditional-edge',
          sourceX: 0,
          sourceY: 0,
          targetX: 100,
          targetY: 0,
          sourcePosition: 'right',
          targetPosition: 'left',
          selected: false,
          label: 'x > 1',
          data: {
            workflowEdge: {
              id: 'conditional-edge',
              from: 'gateway',
              to: 'matched',
              condition: 'x > 1',
              isDefault: false
            }
          }
        } as Parameters<typeof DesignerFlowEdge>[0])} />
      </I18nextProvider>
    )

    expect(screen.getByText('x > 1')).toBeTruthy()
    expect(screen.queryByText('Default')).toBeNull()
  })
})
