import {
  deleteWorkflowWithRevision,
  getWorkflowDeleteImpact,
  getWorkflowRecord,
  listWorkflowRecords,
  saveWorkflowWithRevision,
  setProjectDefaultWorkflow,
  type AppDatabase,
  type SaveWorkflowResult,
  type WorkflowDeleteImpact,
  type WorkflowRecord
} from './database'
import { AppError } from '../shared/appError'
import { t } from './i18n'
import { parseWorkflowDefinition, type WorkflowDefinition } from '../shared/workflow'

export type WorkflowChangeEvent = {
  operation: 'created' | 'updated' | 'deleted'
  id: string
  revision: number
  source: 'renderer' | 'assistant'
}

export type ProjectChangeEvent = {
  operation: 'default-workflow-updated'
  projectId: string
  workflowId: string
}

export type DesignerState = {
  workflowId: string | null
  open: boolean
  dirty: boolean
}

export class UserCancelledError extends AppError {
  constructor(message = t('errors:workflowConfig.cancelled')) {
    super({ code: 'USER_CANCELLED', message })
    this.name = 'UserCancelledError'
  }
}

export class WorkflowConfigService {
  private designerState: DesignerState = { workflowId: null, open: false, dirty: false }
  private readonly workflowListeners = new Set<(event: WorkflowChangeEvent) => void>()
  private readonly projectListeners = new Set<(event: ProjectChangeEvent) => void>()

  constructor(private readonly db: AppDatabase) {}

  list(): WorkflowRecord[] {
    return listWorkflowRecords(this.db)
  }

  get(id: string): WorkflowRecord | null {
    requireId(id, t('errors:workflowConfig.workflowIdLabel'))
    return getWorkflowRecord(this.db, id)
  }

  validate(input: unknown): WorkflowDefinition {
    return parseWorkflowDefinition(input)
  }

  save(
    input: unknown,
    expectedRevision: number | undefined,
    source: 'renderer' | 'assistant'
  ): SaveWorkflowResult {
    const workflow = parseWorkflowDefinition(input)
    if (source === 'assistant') this.assertNoDirtyConflict(workflow.id)
    const result = saveWorkflowWithRevision(this.db, workflow, expectedRevision)
    this.emitWorkflow({
      operation: result.created ? 'created' : 'updated',
      id: result.workflow.id,
      revision: result.revision,
      source
    })
    return result
  }

  getDeleteImpact(workflowId: string, source: 'renderer' | 'assistant'): WorkflowDeleteImpact {
    requireId(workflowId, t('errors:workflowConfig.workflowIdLabel'))
    if (source === 'assistant') this.assertNoDirtyConflict(workflowId)
    return getWorkflowDeleteImpact(this.db, workflowId)
  }

  delete(
    workflowId: string,
    expectedRevision: number,
    source: 'renderer' | 'assistant'
  ): void {
    requireId(workflowId, t('errors:workflowConfig.workflowIdLabel'))
    if (source === 'assistant') this.assertNoDirtyConflict(workflowId)
    deleteWorkflowWithRevision(this.db, workflowId, expectedRevision)
    this.emitWorkflow({ operation: 'deleted', id: workflowId, revision: expectedRevision, source })
  }

  async confirmAndDelete(
    workflowId: string,
    confirm: (impact: WorkflowDeleteImpact) => Promise<boolean>
  ): Promise<WorkflowChangeEvent> {
    const impact = this.getDeleteImpact(workflowId, 'assistant')
    if (!await confirm(impact)) throw new UserCancelledError()
    // Re-run all checks after the confirmation dialog. The revision is the CAS
    // token and deleteWorkflowWithRevision rechecks runtime constraints.
    this.assertNoDirtyConflict(workflowId)
    this.delete(workflowId, impact.revision, 'assistant')
    return { operation: 'deleted', id: workflowId, revision: impact.revision, source: 'assistant' }
  }

  setProjectDefault(projectId: string, workflowId: string): void {
    requireId(projectId, t('errors:workflowConfig.projectIdLabel'))
    requireId(workflowId, t('errors:workflowConfig.workflowIdLabel'))
    setProjectDefaultWorkflow(this.db, projectId, workflowId)
    this.emitProject({
      operation: 'default-workflow-updated',
      projectId,
      workflowId
    })
  }

  setDesignerState(value: unknown): DesignerState {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(t('errors:workflowConfig.invalidDesignerState'))
    }
    const candidate = value as Record<string, unknown>
    if (typeof candidate.open !== 'boolean' || typeof candidate.dirty !== 'boolean') {
      throw new Error(t('errors:workflowConfig.invalidDesignerState'))
    }
    if (candidate.workflowId !== null && typeof candidate.workflowId !== 'string') {
      throw new Error(t('errors:workflowConfig.invalidDesignerWorkflowId'))
    }
    if (typeof candidate.workflowId === 'string') requireId(candidate.workflowId, t('errors:workflowConfig.designerWorkflowIdLabel'))
    this.designerState = {
      workflowId: candidate.workflowId as string | null,
      open: candidate.open,
      dirty: candidate.dirty
    }
    return this.designerState
  }

  onWorkflowChanged(listener: (event: WorkflowChangeEvent) => void): () => void {
    this.workflowListeners.add(listener)
    return () => this.workflowListeners.delete(listener)
  }

  onProjectChanged(listener: (event: ProjectChangeEvent) => void): () => void {
    this.projectListeners.add(listener)
    return () => this.projectListeners.delete(listener)
  }

  private assertNoDirtyConflict(workflowId: string): void {
    if (
      this.designerState.open &&
      this.designerState.dirty &&
      this.designerState.workflowId === workflowId
    ) {
      throw new Error(t('errors:workflowConfig.dirtyInDesigner'))
    }
  }

  private emitWorkflow(event: WorkflowChangeEvent): void {
    for (const listener of this.workflowListeners) listener(event)
  }

  private emitProject(event: ProjectChangeEvent): void {
    for (const listener of this.projectListeners) listener(event)
  }
}

function requireId(value: string, label: string): void {
  if (typeof value !== 'string' || !value || value.length > 512 || value.includes('\0')) {
    throw new Error(t('errors:workflowConfig.labelInvalid', { label }))
  }
}
