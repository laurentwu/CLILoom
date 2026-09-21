import { describe, expect, it, vi } from 'vitest'
import { TerminalAutoRetryScheduler, type AutoRetryTicket } from './terminalAutoRetryScheduler'
import type { WorkflowRuntimeState, WorkflowRuntimeNodeRun } from '../shared/workflowRuntime'
import type { TerminalAutoRetryPhase } from '../shared/terminalAutoRetry'

type MutableClock = { now: () => number; advance: (ms: number) => void }

function createFakeClock(startMs: number): MutableClock {
  let current = startMs
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    }
  }
}

function createState(args: {
  taskId?: string
  runId?: string
  nodes?: Array<{ nodeId: string; sessionId?: string; phase?: TerminalAutoRetryPhase; scheduleId?: string; nextRetryAt?: number }>
}): WorkflowRuntimeState {
  const taskId = args.taskId ?? 'task-1'
  return {
    taskId,
    projectId: 'project-1',
    projectDir: '/repo',
    ...(args.runId ? { autoRetryContext: { runId: args.runId, timeZone: 'UTC' } } : {}),
    workflowId: 'wf-1',
    status: 'failed',
    currentNodeId: 'node-1',
    variables: {},
    nodeRuns: Object.fromEntries((args.nodes ?? [{ nodeId: 'node-1' }]).map((node) => [
      node.nodeId,
      {
        nodeId: node.nodeId,
        status: 'failed',
        ...(node.sessionId === undefined ? {} : { sessionId: node.sessionId }),
        autoRetry: {
          version: 1 as const,
          cycleId: 'cycle-1',
          phase: node.phase ?? ('waiting' as const),
          attemptsStarted: 0,
          scheduleId: node.scheduleId ?? 'sched-1',
          nextRetryAt: node.nextRetryAt ?? 0
        }
      } satisfies WorkflowRuntimeNodeRun
    ])),
    executionOrder: [],
    activeBranches: [],
    branchRuns: {},
    parallelResults: {},
    workflowCompleted: false
  }
}

function advanceTimers(ms: number): void {
  vi.advanceTimersByTime(ms)
}

/** Advance wall clock and fake timers together, in max-sleep sized steps. */
function elapse(clock: MutableClock, ms: number): void {
  let remaining = ms
  while (remaining > 0) {
    const step = Math.min(remaining, 60_000)
    clock.advance(step)
    advanceTimers(step)
    remaining -= step
  }
}

async function waitForTimer(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('TerminalAutoRetryScheduler', () => {
  it('dispatches a ticket exactly once when it becomes due', () => {
    vi.useFakeTimers()
    try {
      const clock = createFakeClock(1_000_000)
      const dispatch = vi.fn()
      const scheduler = new TerminalAutoRetryScheduler({
        dispatch,
        now: clock.now,
        maxSleepMs: 60_000
      })
      scheduler.reconcileTask(createState({
        runId: 'run-1',
        nodes: [{ nodeId: 'node-1', sessionId: 'session-1', scheduleId: 'sched-1', nextRetryAt: 1_000_000 + 60_000 }]
      }))

      elapse(clock, 59_000)
      expect(dispatch).not.toHaveBeenCalled()

      elapse(clock, 2_000)
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(dispatch.mock.calls[0][0]).toMatchObject({
        taskId: 'task-1',
        runId: 'run-1',
        nodeId: 'node-1',
        cycleId: 'cycle-1',
        scheduleId: 'sched-1',
        sessionId: 'session-1'
      })

      // Repeated ticks while the service processes the ticket do not duplicate it.
      elapse(clock, 120_000)
      expect(dispatch).toHaveBeenCalledTimes(1)
      scheduler.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('fires overdue plans immediately on resume', async () => {
    const dispatch = vi.fn()
    const scheduler = new TerminalAutoRetryScheduler({ dispatch, now: () => 5_000_000 })
    scheduler.reconcileTask(createState({
      runId: 'run-1',
      nodes: [{ nodeId: 'node-1', sessionId: 'session-1', scheduleId: 'sched-1', nextRetryAt: 1_000_000 }]
    }))
    expect(scheduler.hasWaitingTickets()).toBe(true)
    await waitForTimer()
    expect(dispatch).toHaveBeenCalledTimes(1)
    scheduler.dispose()
  })

  it('replaces tickets when the state is reconciled again', () => {
    vi.useFakeTimers()
    try {
      const clock = createFakeClock(0)
      const dispatch = vi.fn()
      const scheduler = new TerminalAutoRetryScheduler({ dispatch, now: clock.now })
      scheduler.reconcileTask(createState({
        runId: 'run-1',
        nodes: [{ nodeId: 'node-1', sessionId: 'session-1', scheduleId: 'sched-1', nextRetryAt: 120_000 }]
      }))
      // The node re-failed with a new schedule; the old ticket must die.
      scheduler.reconcileTask(createState({
        runId: 'run-1',
        nodes: [{ nodeId: 'node-1', sessionId: 'session-1', scheduleId: 'sched-2', nextRetryAt: 300_000 }]
      }))
      elapse(clock, 299_000)
      expect(dispatch).not.toHaveBeenCalled()
      elapse(clock, 1_000)
      expect(dispatch).toHaveBeenCalledTimes(1)
      expect(dispatch.mock.calls[0][0].scheduleId).toBe('sched-2')
      scheduler.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores nodes without a run context or session', () => {
    const dispatch = vi.fn()
    const scheduler = new TerminalAutoRetryScheduler({ dispatch, now: () => 0 })
    scheduler.reconcileTask(createState({ runId: undefined }))
    expect(scheduler.hasWaitingTickets()).toBe(false)
    scheduler.reconcileTask(createState({
      runId: 'run-1',
      nodes: [{ nodeId: 'node-1', sessionId: undefined, scheduleId: 's', nextRetryAt: 0 }]
    }))
    expect(scheduler.hasWaitingTickets()).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
    scheduler.dispose()
  })

  it('keeps waiting plans for other tasks when one task is removed', async () => {
    const dispatch = vi.fn()
    const scheduler = new TerminalAutoRetryScheduler({ dispatch, now: () => 10_000_000 })
    scheduler.reconcileTask(createState({
      taskId: 'task-a',
      runId: 'run-a',
      nodes: [{ nodeId: 'node-1', sessionId: 'session-a', scheduleId: 'sched-a', nextRetryAt: 5_000_000 }]
    }))
    scheduler.reconcileTask(createState({
      taskId: 'task-b',
      runId: 'run-b',
      nodes: [{ nodeId: 'node-1', sessionId: 'session-b', scheduleId: 'sched-b', nextRetryAt: 9_000_000 }]
    }))
    scheduler.removeTask('task-a')
    expect(scheduler.hasWaitingTickets()).toBe(true)
    await waitForTimer()
    expect(dispatch).toHaveBeenCalledTimes(1)
    const ticket: AutoRetryTicket = dispatch.mock.calls[0][0]
    expect(ticket.taskId).toBe('task-b')
    scheduler.removeTask('task-b')
    expect(scheduler.hasWaitingTickets()).toBe(false)
    scheduler.dispose()
  })

  it('uses short sleeps so long plans survive clock jumps', () => {
    vi.useFakeTimers()
    try {
      const clock = createFakeClock(0)
      const dispatch = vi.fn()
      const scheduler = new TerminalAutoRetryScheduler({
        dispatch,
        now: clock.now,
        maxSleepMs: 60_000
      })
      // A due date far in the future must not overflow a single timer.
      scheduler.reconcileTask(createState({
        runId: 'run-1',
        nodes: [{ nodeId: 'node-1', sessionId: 'session-1', scheduleId: 'sched-1', nextRetryAt: 2_147_483_647_000 }]
      }))
      expect(scheduler.hasWaitingTickets()).toBe(true)
      expect(dispatch).not.toHaveBeenCalled()
      // A big forward clock jump fires the plan exactly once: the next short
      // tick re-checks the real time and dispatches without a backlog.
      clock.advance(2_147_483_647_000)
      advanceTimers(60_000)
      expect(dispatch).toHaveBeenCalledTimes(1)
      advanceTimers(120_000)
      expect(dispatch).toHaveBeenCalledTimes(1)
      scheduler.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops dispatching after dispose', () => {
    const dispatch = vi.fn()
    const scheduler = new TerminalAutoRetryScheduler({ dispatch, now: () => 0 })
    scheduler.dispose()
    scheduler.reconcileTask(createState({
      runId: 'run-1',
      nodes: [{ nodeId: 'node-1', sessionId: 'session-1', scheduleId: 'sched-1', nextRetryAt: -1 }]
    }))
    scheduler.resume()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('does not dispatch cancelled or non-waiting states', () => {
    const dispatch = vi.fn()
    const scheduler = new TerminalAutoRetryScheduler({ dispatch, now: () => 0 })
    scheduler.reconcileTask({
      ...createState({
        runId: 'run-1',
        nodes: [{ nodeId: 'node-1', sessionId: 'session-1', phase: 'cancelled' }]
      }),
      nodeRuns: {
        'node-1': {
          nodeId: 'node-1',
          status: 'failed',
          sessionId: 'session-1',
          autoRetry: {
            version: 1,
            cycleId: 'cycle-1',
            phase: 'cancelled',
            attemptsStarted: 1,
            reason: 'user-cancelled'
          }
        }
      }
    })
    expect(scheduler.hasWaitingTickets()).toBe(false)
    expect(dispatch).not.toHaveBeenCalled()
    scheduler.dispose()
  })
})
