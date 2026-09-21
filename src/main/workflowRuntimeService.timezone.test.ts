import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openDatabase, type AppDatabase } from './database'
import { WorkflowRuntimeService } from './workflowRuntimeService'
import type { WorkflowDefinition } from '../shared/workflow'

const timeZoneState = { value: 'Europe/Berlin' }

vi.mock('../shared/cronSchedule', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/cronSchedule')>()
  return {
    ...actual,
    getSystemTimeZone: () => timeZoneState.value
  }
})

const dbs: Array<{ db: AppDatabase; dir: string }> = []

const workflow: WorkflowDefinition = {
  id: 'timezone-workflow',
  name: 'Timezone workflow',
  nodes: [
    { id: 'start', type: 'start', name: 'Start', config: { variables: [] } },
    {
      id: 'cmd',
      type: 'non-interactive-terminal',
      name: 'Command',
      config: {
        command: 'true',
        cwd: '/repo',
        successExitCodes: [0],
        autoRetry: { enabled: true, mode: 'recommended', maxRetries: 10 }
      }
    },
    { id: 'end', type: 'end', name: 'End', config: {} }
  ],
  edges: [
    { id: 'start-cmd', from: 'start', to: 'cmd' },
    { id: 'cmd-end', from: 'cmd', to: 'end' }
  ]
}

afterEach(() => {
  while (dbs.length > 0) {
    const item = dbs.pop()!
    item.db.close()
    rmSync(item.dir, { recursive: true, force: true })
  }
})

describe('WorkflowRuntimeService task time zone capture', () => {
  it('reads the system time zone when a task launches, not when the service is built', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cliloom-tz-'))
    const db = openDatabase(dir)
    dbs.push({ db, dir })
    const runner = {
      run: async () => ({ sessionId: 's', stdout: '', stderr: '', exitCode: 0 }),
      runHook: async () => ({ hookRunId: 'h', stdout: '', stderr: '', exitCode: 0 }),
      killByTask: () => 0,
      hasLiveSession: () => false
    }

    timeZoneState.value = 'Europe/Berlin'
    const service = new WorkflowRuntimeService(db, runner as never, () => null)

    // The system time zone changes between service construction and launch.
    timeZoneState.value = 'Asia/Tokyo'
    const launched = await service.start({
      taskId: 'task-tz',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: {},
      startNodeId: 'start'
    })
    expect(launched.autoRetryContext?.timeZone).toBe('Asia/Tokyo')

    timeZoneState.value = 'America/New_York'
    const relaunched = await service.start({
      taskId: 'task-tz-2',
      projectId: 'project-1',
      projectDir: '/repo',
      workflow,
      variables: {},
      startNodeId: 'start'
    })
    expect(relaunched.autoRetryContext?.timeZone).toBe('America/New_York')
  })
})
