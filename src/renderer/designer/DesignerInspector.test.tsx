// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../i18n'
import { DesignerInspector } from './DesignerInspector'

afterEach(cleanup)

describe('DesignerInspector hooks wiring', () => {
  const node = {
    id: 'end-1',
    type: 'end' as const,
    name: 'End',
    config: {},
    x: 0,
    y: 0
  }

  it('renders both start and end hook editors for a node', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <DesignerInspector
          selection={{ kind: 'node', id: 'end-1' }}
          nodes={[node]}
          edges={[]}
          onUpdateNode={vi.fn()}
          onUpdateEdge={vi.fn()}
          onDeleteSelection={vi.fn()}
        />
      </I18nextProvider>
    )

    expect(screen.getByText('Start hook')).toBeTruthy()
    expect(screen.getByText('End hook')).toBeTruthy()
  })

  it('writes the start hook through onUpdateNode', () => {
    const onUpdateNode = vi.fn()
    render(
      <I18nextProvider i18n={i18n}>
        <DesignerInspector
          selection={{ kind: 'node', id: 'end-1' }}
          nodes={[node]}
          edges={[]}
          onUpdateNode={onUpdateNode}
          onUpdateEdge={vi.fn()}
          onDeleteSelection={vi.fn()}
        />
      </I18nextProvider>
    )

    fireEvent.click(screen.getAllByRole('checkbox')[0])

    expect(onUpdateNode).toHaveBeenCalledWith('end-1', {
      startHook: { enabled: true, command: '', failPolicy: 'continue' }
    })
  })

  it('disables the end hook through onUpdateNode while keeping configuration', () => {
    const onUpdateNode = vi.fn()
    render(
      <I18nextProvider i18n={i18n}>
        <DesignerInspector
          selection={{ kind: 'node', id: 'end-1' }}
          nodes={[{ ...node, endHook: { enabled: true, command: 'echo done', failPolicy: 'continue' } }]}
          edges={[]}
          onUpdateNode={onUpdateNode}
          onUpdateEdge={vi.fn()}
          onDeleteSelection={vi.fn()}
        />
      </I18nextProvider>
    )

    fireEvent.click(screen.getAllByRole('checkbox')[1])

    expect(onUpdateNode).toHaveBeenCalledWith('end-1', {
      endHook: { enabled: false, command: 'echo done', failPolicy: 'continue' }
    })
  })
})
