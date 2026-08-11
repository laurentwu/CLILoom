import {
  sortVariableDefinitions,
  type StartNodeConfig,
  type VariableValue,
  type WorkflowDefinition
} from './workflow'

export const MAX_TASK_TITLE_LENGTH = 20

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function truncateTaskTitle(title: string): string {
  const segments = graphemeSegmenter.segment(title)
  let result = ''
  let length = 0

  for (const { segment } of segments) {
    if (length >= MAX_TASK_TITLE_LENGTH) break
    result += segment
    length += 1
  }

  return result
}

export function normalizeTaskTitle(title: string): string {
  return truncateTaskTitle(title.trim())
}

export function getAutomaticTaskTitle(
  workflow: WorkflowDefinition,
  variables: Record<string, VariableValue>,
  fallback: string
): string {
  const startNode = workflow.nodes.find((node) => node.type === 'start')
  const firstVariable = startNode
    ? sortVariableDefinitions((startNode.config as StartNodeConfig).variables)[0]
    : undefined
  const value = firstVariable ? String(variables[firstVariable.key] ?? '').trim() : ''
  return truncateTaskTitle(value || fallback)
}
