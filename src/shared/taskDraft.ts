import { AppError } from './appError'
import type { VariableValue, WorkflowDefinition } from './workflow'
import { parseWorkflowDefinitionStructure } from './workflow'

export const TASK_DRAFT_VERSION = 1 as const
export const MAX_TASK_DRAFT_VARIABLES = 1_000
export const MAX_TASK_DRAFT_VALUE_LENGTH = 100_000

export type TaskDraftPayload = {
  version: typeof TASK_DRAFT_VERSION
  workflow: WorkflowDefinition
  variables: Record<string, VariableValue>
  revision: number
}

export type TaskDraftRecord = TaskDraftPayload & {
  projectId: string
  createdAt: string
  updatedAt: string
}

/**
 * Parse the renderer-facing draft payload at the privileged process boundary.
 * Drafts intentionally use the structural workflow parser so a snapshot can
 * still be displayed if its catalog entry was removed or is temporarily
 * incomplete while the user decides how to replace it.
 */
export function parseTaskDraftPayload(value: unknown): TaskDraftPayload {
  if (!isRecord(value)) {
    throw invalidTaskDraft('Task draft must be an object')
  }

  if (value.version !== TASK_DRAFT_VERSION) {
    throw invalidTaskDraft('Task draft version is unsupported')
  }

  const workflow = parseWorkflowDefinitionStructure(value.workflow)
  const variables = parseTaskDraftVariables(value.variables)
  const revision = parseTaskDraftRevision(value.revision)

  return {
    version: TASK_DRAFT_VERSION,
    workflow,
    variables,
    revision
  }
}

export function parseTaskDraftVariables(value: unknown): Record<string, VariableValue> {
  if (!isRecord(value)) {
    throw invalidTaskDraft('Task draft variables must be an object')
  }

  const entries = Object.entries(value)
  if (entries.length > MAX_TASK_DRAFT_VARIABLES) {
    throw invalidTaskDraft('Task draft contains too many variables')
  }

  const variables: Record<string, VariableValue> = {}
  for (const [key, item] of entries) {
    if (!key || key.length > 512 || key.includes('\0')) {
      throw invalidTaskDraft('Task draft contains an invalid variable key')
    }
    if (!isTaskDraftVariableValue(item)) {
      throw invalidTaskDraft(`Task draft variable ${key} has an invalid value`)
    }
    Object.defineProperty(variables, key, {
      configurable: true,
      enumerable: true,
      value: item,
      writable: true
    })
  }
  return variables
}

export function parseTaskDraftRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw invalidTaskDraft('Task draft revision must be a positive integer')
  }
  return value as number
}

function isTaskDraftVariableValue(value: unknown): value is VariableValue {
  if (value === null || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  return typeof value === 'string' && value.length <= MAX_TASK_DRAFT_VALUE_LENGTH && !value.includes('\0')
}

function invalidTaskDraft(message: string): AppError {
  return new AppError({
    code: 'TASK_DRAFT_INVALID',
    message,
    i18nKey: 'errors:database.taskDraftInvalid'
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
