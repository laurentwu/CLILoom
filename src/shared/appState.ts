export const LAST_OPENED_WORKSPACE_SETTING_KEY = 'last_opened_workspace'

export type LastOpenedWorkspace = {
  projectId: string
  taskId: string | null
}

export function parseLastOpenedWorkspace(value: unknown): LastOpenedWorkspace | null {
  if (typeof value !== 'object' || value === null) return null

  const candidate = value as { projectId?: unknown; taskId?: unknown }
  if (typeof candidate.projectId !== 'string' || candidate.projectId.length === 0) return null
  if (candidate.taskId !== null && typeof candidate.taskId !== 'string') return null
  if (typeof candidate.taskId === 'string' && candidate.taskId.length === 0) return null

  return {
    projectId: candidate.projectId,
    taskId: candidate.taskId
  }
}
