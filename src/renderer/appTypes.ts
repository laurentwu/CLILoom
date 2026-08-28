import type { WorkflowDefinition } from '../shared/workflow'
import type { LastOpenedWorkspace } from '../shared/appState'
import type { AppSettingsSnapshot } from '../shared/appSettings'
import type { TerminalSession } from './utils'
import type { ShellSnapshot } from '../shared/shell'
import type { WorkflowRuntimeStatus } from '../shared/workflowRuntime'
export type { TaskDraftPayload, TaskDraftRecord } from '../shared/taskDraft'

export type ProjectRecord = {
  id: string
  name: string
  path: string
  sort_order: number
  default_workflow_id?: string | null
  created_at: string
}

export type TaskRecord = {
  id: string
  project_id: string
  title: string
  status: WorkflowRuntimeStatus
  created_at: string
  updated_at: string
}

export type Bootstrap = {
  workflows: WorkflowDefinition[]
  workflowRecords: WorkflowRecord[]
  settings: AppSettingsSnapshot
  shell: ShellSnapshot
  projects: ProjectRecord[]
  terminalSessions: TerminalSession[]
  lastOpenedWorkspace: LastOpenedWorkspace | null
}

export type WorkflowRecord = {
  workflow: WorkflowDefinition
  revision: number
  createdAt: string
  updatedAt: string
}

export type WorkflowSaveResult = {
  workflow: WorkflowDefinition
  revision: number
  created: boolean
}
