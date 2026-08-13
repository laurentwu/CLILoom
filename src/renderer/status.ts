import type { NodeRunStatus } from '../shared/workflow'
import type { TranslationKey } from '../shared/i18n/types'

export type StatusSource = 'task' | 'node' | 'terminal'

export type StatusTone =
  | 'neutral'
  | 'running'
  | 'waiting-input'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'interrupted'

export type StatusPresentation = {
  labelKey?: TranslationKey
  label?: string
  tone: StatusTone
}

type WorkflowDisplayStatus = NodeRunStatus | 'draft'

const workflowStatusPresentations = {
  draft: { labelKey: 'status:task.draft', tone: 'neutral' },
  pending: { labelKey: 'status:task.pending', tone: 'neutral' },
  running: { labelKey: 'status:task.running', tone: 'running' },
  'waiting-input': { labelKey: 'status:task.waitingInput', tone: 'waiting-input' },
  completed: { labelKey: 'status:task.completed', tone: 'completed' },
  failed: { labelKey: 'status:task.failed', tone: 'failed' },
  stopped: { labelKey: 'status:task.stopped', tone: 'stopped' },
  interrupted: { labelKey: 'status:task.interrupted', tone: 'interrupted' }
} as const satisfies Record<WorkflowDisplayStatus, StatusPresentation>

function getWorkflowStatusPresentation(status: string): StatusPresentation {
  if (status in workflowStatusPresentations) {
    return workflowStatusPresentations[status as keyof typeof workflowStatusPresentations]
  }
  return { label: status, tone: 'neutral' }
}

function getTerminalStatusPresentation(status: string): StatusPresentation {
  if (status === 'running') return workflowStatusPresentations.running
  if (status === 'closed') return { labelKey: 'status:terminal.closed', tone: 'completed' }
  if (status === 'failed') return workflowStatusPresentations.failed
  if (status === 'killed') return workflowStatusPresentations.stopped
  if (status === 'interrupted') return workflowStatusPresentations.interrupted
  return { label: status, tone: 'neutral' }
}

export function getStatusPresentation(
  status: string,
  source: StatusSource = 'task'
): StatusPresentation {
  return source === 'terminal'
    ? getTerminalStatusPresentation(status)
    : getWorkflowStatusPresentation(status)
}
