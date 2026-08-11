import { describe, expect, it } from 'vitest'
import { getStatusPresentation } from './status'

describe('status presentations', () => {
  it.each([
    ['running', 'status:task.running', 'running'],
    ['waiting-input', 'status:task.waitingInput', 'waiting-input'],
    ['completed', 'status:task.completed', 'completed'],
    ['failed', 'status:task.failed', 'failed'],
    ['stopped', 'status:task.stopped', 'stopped'],
    ['interrupted', 'status:task.interrupted', 'interrupted']
  ] as const)('maps task status %s to its label key and tone', (status, labelKey, tone) => {
    expect(getStatusPresentation(status, 'task')).toEqual({ labelKey, tone })
  })

  it('uses neutral presentations for draft and pending states', () => {
    expect(getStatusPresentation('draft', 'task')).toEqual({
      labelKey: 'status:task.draft',
      tone: 'neutral'
    })
    expect(getStatusPresentation('pending', 'node')).toEqual({
      labelKey: 'status:task.pending',
      tone: 'neutral'
    })
  })

  it.each([
    ['running', 'status:task.running', 'running'],
    ['running (attached)', 'status:task.running', 'running'],
    ['closed', 'status:terminal.closed', 'completed'],
    ['closed (0)', 'status:terminal.closed', 'completed'],
    ['failed', 'status:task.failed', 'failed'],
    ['killed', 'status:task.stopped', 'stopped'],
    ['interrupted', 'status:task.interrupted', 'interrupted']
  ] as const)('normalizes terminal status %s', (status, labelKey, tone) => {
    expect(getStatusPresentation(status, 'terminal')).toEqual({ labelKey, tone })
  })

  it('preserves unknown status text with a neutral tone', () => {
    expect(getStatusPresentation('legacy-status', 'task')).toEqual({
      label: 'legacy-status',
      tone: 'neutral'
    })
    expect(getStatusPresentation('detached', 'terminal')).toEqual({
      label: 'detached',
      tone: 'neutral'
    })
  })
})
