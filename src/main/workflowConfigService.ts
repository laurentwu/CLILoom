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
import { NotFoundError } from './errors'
import { t } from './i18n'
import {
  parseTerminalAutoRetryCommandInput,
  type TerminalAutoRetryConfig
} from '../shared/terminalAutoRetry'
import {
  parseWorkflowDefinition,
  type InteractiveTerminalConfig,
  type NonInteractiveTerminalConfig,
  type WorkflowDefinition
} from '../shared/workflow'

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

  /**
   * Read the stored autoRetry configuration of one terminal node. Returns
   * null for autoRetry when the node has no persisted configuration.
   */
  getTerminalAutoRetry(
    workflowId: string,
    nodeId: string
  ): {
    workflowId: string
    nodeId: string
    nodeType: 'interactive-terminal' | 'non-interactive-terminal'
    revision: number
    autoRetry: TerminalAutoRetryConfig | null
  } {
    const record = this.requireTerminalNode(workflowId, nodeId)
    const config = record.workflow.nodes
      .find((node) => node.id === nodeId)!.config as
      | InteractiveTerminalConfig
      | NonInteractiveTerminalConfig
    return {
      workflowId: record.workflow.id,
      nodeId,
      nodeType: record.node.type as 'interactive-terminal' | 'non-interactive-terminal',
      revision: record.revision,
      autoRetry: config.autoRetry ?? null
    }
  }

  /**
   * Replace or remove the autoRetry configuration of one terminal node using
   * the regular revision-checked save path. `input` is a complete autoRetry
   * object (strictly validated) or JSON null to remove the configuration.
   */
  setTerminalAutoRetry(
    workflowId: string,
    nodeId: string,
    input: unknown,
    expectedRevision: number
  ): SaveWorkflowResult & {
    nodeType: 'interactive-terminal' | 'non-interactive-terminal'
    autoRetry: TerminalAutoRetryConfig | null
  } {
    const record = this.requireTerminalNode(workflowId, nodeId)
    const nodeType = record.node.type as 'interactive-terminal' | 'non-interactive-terminal'
    const autoRetry = parseTerminalAutoRetryCommandInput(input)
    const candidate: WorkflowDefinition = {
      ...record.workflow,
      nodes: record.workflow.nodes.map((node) => {
        if (node.id !== nodeId) return node
        const terminalConfig = { ...(node.config as Record<string, unknown>) }
        if (autoRetry === undefined) delete terminalConfig.autoRetry
        else terminalConfig.autoRetry = autoRetry
        return { ...node, config: terminalConfig } as typeof node
      })
    }
    const saved = this.save(candidate, expectedRevision, 'assistant')
    return { ...saved, nodeType, autoRetry: autoRetry ?? null }
  }

  private requireTerminalNode(
    workflowId: string,
    nodeId: string
  ): WorkflowRecord & {
    node: WorkflowDefinition['nodes'][number]
  } {
    requireId(workflowId, t('errors:workflowConfig.workflowIdLabel'))
    requireId(nodeId, t('errors:workflowConfig.nodeIdLabel'))
    const record = getWorkflowRecord(this.db, workflowId)
    if (!record) throw new NotFoundError(t('errors:assistantCommand.workflowNotFound'))
    const node = record.workflow.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) throw new NotFoundError(t('errors:assistantCommand.nodeNotFound'))
    if (node.type !== 'interactive-terminal' && node.type !== 'non-interactive-terminal') {
      throw new AppError({
        code: 'VALIDATION_ERROR',
        message: t('errors:workflowConfig.autoRetryNodeNotTerminal')
      })
    }
    return { ...record, node }
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
