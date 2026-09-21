import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { WorkflowDefinition } from '../shared/workflow'
import { NotFoundError } from './errors'
import { openDatabase, type AppDatabase } from './database'
import { WorkflowConfigService, type WorkflowChangeEvent } from './workflowConfigService'

const databases: Array<{ db: AppDatabase; directory: string }> = []

afterEach(() => {
  for (const item of databases.splice(0)) {
    item.db.close()
    rmSync(item.directory, { recursive: true, force: true })
  }
})

const workflow: WorkflowDefinition = {
  id: 'workflow-config-service',
  name: 'Workflow config service',
  nodes: [
    { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
    { id: 'end', type: 'end', name: 'End', config: {} }
  ],
  edges: [{ id: 'start-end', from: 'start', to: 'end' }]
}

const retryWorkflow: WorkflowDefinition = {
  id: 'auto-retry-service',
  name: 'Auto retry service',
  nodes: [
    { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
    {
      id: 'term',
      type: 'non-interactive-terminal',
      name: 'Terminal',
      config: {
        command: 'sync',
        retryCommand: 'sync --retry',
        cwd: '/tmp',
        successExitCodes: [0],
        autoRetry: { enabled: true, mode: 'recommended', maxRetries: 3 }
      }
    },
    { id: 'end', type: 'end', name: 'End', config: {} }
  ],
  edges: [
    { id: 'start-term', from: 'start', to: 'term' },
    { id: 'term-end', from: 'term', to: 'end' }
  ]
}

function createService(): WorkflowConfigService {
  const directory = mkdtempSync(path.join(tmpdir(), 'cliloom-workflow-service-'))
  const db = openDatabase(directory)
  databases.push({ db, directory })
  return new WorkflowConfigService(db)
}

describe('WorkflowConfigService designer conflicts', () => {
  it('identifies the source of workflow change events', async () => {
    const service = createService()
    const events: WorkflowChangeEvent[] = []
    service.onWorkflowChanged((event) => events.push(event))

    const created = service.save(workflow, undefined, 'renderer')
    service.save({ ...workflow, name: 'Assistant update' }, created.revision, 'assistant')
    const deleted = await service.confirmAndDelete(workflow.id, async () => true)

    expect(events).toEqual([
      {
        operation: 'created',
        id: workflow.id,
        revision: created.revision,
        source: 'renderer'
      },
      {
        operation: 'updated',
        id: workflow.id,
        revision: created.revision + 1,
        source: 'assistant'
      },
      {
        operation: 'deleted',
        id: workflow.id,
        revision: created.revision + 1,
        source: 'assistant'
      }
    ])
    expect(deleted).toEqual(events[2])
  })

  it('blocks assistant writes to the workflow with an unsaved renderer draft', () => {
    const service = createService()
    const created = service.save(workflow, undefined, 'renderer')
    service.setDesignerState({ workflowId: workflow.id, open: true, dirty: true })

    expect(() => service.save(
      { ...workflow, name: 'Assistant update' },
      created.revision,
      'assistant'
    )).toThrow('This workflow is being edited in the designer with unsaved changes')
    expect(service.get(workflow.id)?.workflow.name).toBe(workflow.name)
  })
})

describe('WorkflowConfigService terminal auto-retry', () => {
  it('reads the stored configuration and reports missing targets', () => {
    const service = createService()
    service.save(retryWorkflow, undefined, 'renderer')

    expect(service.getTerminalAutoRetry('auto-retry-service', 'term')).toMatchObject({
      workflowId: 'auto-retry-service',
      nodeId: 'term',
      nodeType: 'non-interactive-terminal',
      revision: 1,
      autoRetry: { enabled: true, mode: 'recommended', maxRetries: 3 }
    })
    expect(() => service.getTerminalAutoRetry('missing', 'term')).toThrow(NotFoundError)
    expect(() => service.getTerminalAutoRetry('auto-retry-service', 'missing')).toThrow(NotFoundError)
    expect(() => service.getTerminalAutoRetry('auto-retry-service', 'term')).not.toThrow()
    expect(() => service.getTerminalAutoRetry('auto-retry-service', '')).toThrow('Invalid Node ID')
    expect(() => service.setTerminalAutoRetry('auto-retry-service', 'bad\u0000id', null, 1))
      .toThrow('Invalid Node ID')
    expect(() => service.getTerminalAutoRetry('auto-retry-service', 'end')).toThrow(
      /interactive-terminal/
    )
  })

  it('replaces and removes configurations through the revision-checked save path', () => {
    const service = createService()
    const events: WorkflowChangeEvent[] = []
    service.onWorkflowChanged((event) => events.push(event))
    service.save(retryWorkflow, undefined, 'renderer')

    const updated = service.setTerminalAutoRetry(
      'auto-retry-service',
      'term',
      { enabled: true, mode: 'cron', cron: '*/10 * * * *', maxRetries: null },
      1
    )
    expect(updated.revision).toBe(2)
    expect(updated.nodeType).toBe('non-interactive-terminal')
    expect(updated.autoRetry).toEqual({ enabled: true, mode: 'cron', cron: '*/10 * * * *', maxRetries: null })
    expect(events).toEqual([
      expect.objectContaining({ operation: 'created', source: 'renderer', revision: 1 }),
      expect.objectContaining({ operation: 'updated', source: 'assistant', revision: 2 })
    ])

    const removed = service.setTerminalAutoRetry('auto-retry-service', 'term', null, 2)
    expect(removed.revision).toBe(3)
    const saved = service.get('auto-retry-service')!
    expect((saved.workflow.nodes[1].config as Record<string, unknown>).autoRetry).toBeUndefined()
    expect((saved.workflow.nodes[1].config as Record<string, unknown>).retryCommand).toBe('sync --retry')
    expect(saved.workflow.edges).toEqual(retryWorkflow.edges)
  })

  it('keeps the stored revision and definition unchanged when validation fails', () => {
    const service = createService()
    service.save(retryWorkflow, undefined, 'renderer')

    expect(() => service.setTerminalAutoRetry(
      'auto-retry-service',
      'term',
      { enabled: true, mode: 'recommended', maxRetries: 0 },
      1
    )).toThrow()
    expect(() => service.setTerminalAutoRetry(
      'auto-retry-service',
      'term',
      { enabled: true, mode: 'recommended' },
      99
    )).toThrow(/modified by another operation|revision/i)

    const saved = service.get('auto-retry-service')!
    expect(saved.revision).toBe(1)
    expect((saved.workflow.nodes[1].config as Record<string, unknown>).autoRetry).toEqual({
      enabled: true,
      mode: 'recommended',
      maxRetries: 3
    })
  })
})
