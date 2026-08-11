import { describe, expect, it } from 'vitest'
import type { VariableDefinition, WorkflowDefinition } from './workflow'
import {
  getAutomaticTaskTitle,
  MAX_TASK_TITLE_LENGTH,
  normalizeTaskTitle,
  truncateTaskTitle
} from './taskTitle'

function workflowWithVariables(variables: VariableDefinition[]): WorkflowDefinition {
  return {
    id: 'workflow-1',
    name: 'Workflow',
    nodes: [
      { id: 'start', type: 'start', name: 'Start', config: { variables } },
      { id: 'end', type: 'end', name: 'End', config: {} }
    ],
    edges: [{ id: 'start-end', from: 'start', to: 'end' }]
  }
}

describe('task titles', () => {
  it('uses the first start variable in configured display order', () => {
    const workflow = workflowWithVariables([
      { key: 'prompt', label: 'Prompt', type: 'text', required: false, order: 2 },
      { key: 'summary', label: 'Summary', type: 'text', required: false, order: 1 },
      { key: 'unpositioned', label: 'Unpositioned', type: 'text', required: false }
    ])

    expect(getAutomaticTaskTitle(workflow, {
      prompt: 'Prompt value',
      summary: '  First variable value  ',
      unpositioned: 'Unpositioned value'
    }, 'New task')).toBe('First variable value')
  })

  it('uses the fallback when the first variable is empty or absent', () => {
    const workflow = workflowWithVariables([
      { key: 'first', label: 'First', type: 'text', required: false, order: 1 },
      { key: 'second', label: 'Second', type: 'text', required: false, order: 2 }
    ])

    expect(getAutomaticTaskTitle(workflow, {
      first: '   ',
      second: 'Do not use this value'
    }, 'New task')).toBe('New task')
    expect(getAutomaticTaskTitle(workflowWithVariables([]), {}, 'New task')).toBe('New task')
  })

  it('limits titles to twenty visible characters without splitting graphemes', () => {
    const grapheme = '👩🏽‍💻'
    const longTitle = grapheme.repeat(MAX_TASK_TITLE_LENGTH + 1)

    expect(truncateTaskTitle(longTitle)).toBe(grapheme.repeat(MAX_TASK_TITLE_LENGTH))
    expect(normalizeTaskTitle(`  ${longTitle}  `)).toBe(grapheme.repeat(MAX_TASK_TITLE_LENGTH))
  })
})
