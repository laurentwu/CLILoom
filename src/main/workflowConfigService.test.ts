import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { WorkflowDefinition } from '../shared/workflow'
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
