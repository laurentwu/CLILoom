import type { WorkflowRuntimeState } from '../shared/workflowRuntime'
import { parseTerminalAutoRetryState } from '../shared/terminalAutoRetry'

export type AutoRetryTicket = {
  taskId: string
  runId: string
  nodeId: string
  branchId?: string
  cycleId: string
  scheduleId: string
  sessionId: string
  dueAt: number
}

export type AutoRetrySchedulerOptions = {
  dispatch: (ticket: AutoRetryTicket) => void
  now?: () => number
  maxSleepMs?: number
}

const DEFAULT_MAX_SLEEP_MS = 60_000

function ticketKey(ticket: Pick<AutoRetryTicket, 'taskId' | 'nodeId' | 'cycleId' | 'scheduleId'>): string {
  return `${ticket.taskId}\0${ticket.nodeId}\0${ticket.cycleId}\0${ticket.scheduleId}`
}

export class TerminalAutoRetryScheduler {
  private readonly tasks = new Map<string, Map<string, AutoRetryTicket>>()
  private readonly dispatched = new Set<string>()
  private readonly dispatch: (ticket: AutoRetryTicket) => void
  private readonly now: () => number
  private readonly maxSleepMs: number
  private timer: NodeJS.Timeout | null = null
  private disposed = false

  constructor(options: AutoRetrySchedulerOptions) {
    this.dispatch = options.dispatch
    this.now = options.now ?? (() => Date.now())
    this.maxSleepMs = options.maxSleepMs ?? DEFAULT_MAX_SLEEP_MS
  }

  reconcileTask(state: WorkflowRuntimeState): void {
    if (this.disposed) return
    const tickets = new Map<string, AutoRetryTicket>()
    const context = state.autoRetryContext
    if (context) {
      for (const run of Object.values(state.nodeRuns)) {
        const autoRetry = parseTerminalAutoRetryState(run.autoRetry)
        if (!autoRetry || autoRetry.phase !== 'waiting') continue
        if (!run.sessionId || autoRetry.nextRetryAt === undefined) continue
        const branch = Object.values(state.branchRuns).find(
          (item) => item.currentNodeId === run.nodeId &&
            (item.status === 'running' || item.status === 'waiting-input' || item.status === 'failed')
        )
        const ticket: AutoRetryTicket = {
          taskId: state.taskId,
          runId: context.runId,
          nodeId: run.nodeId,
          ...(branch ? { branchId: branch.branchId } : {}),
          cycleId: autoRetry.cycleId,
          scheduleId: autoRetry.scheduleId!,
          sessionId: run.sessionId,
          dueAt: autoRetry.nextRetryAt
        }
        tickets.set(ticketKey(ticket), ticket)
      }
    }
    this.tasks.set(state.taskId, tickets)
    const taskPrefix = `${state.taskId}\0`
    for (const key of this.dispatched) {
      if (key.startsWith(taskPrefix) && !tickets.has(key)) this.dispatched.delete(key)
    }
    this.scheduleNextTick()
  }

  removeTask(taskId: string): void {
    this.tasks.delete(taskId)
    if (this.tasks.size === 0) this.clearTimer()
    else this.scheduleNextTick()
  }

  hasWaitingTickets(): boolean {
    for (const tickets of this.tasks.values()) {
      if (tickets.size > 0) return true
    }
    return false
  }

  resume(): void {
    if (this.disposed) return
    this.tick()
  }

  dispose(): void {
    this.disposed = true
    this.clearTimer()
    this.tasks.clear()
    this.dispatched.clear()
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private scheduleNextTick(): void {
    const nextDue = this.nextDueAt()
    if (nextDue === null) {
      this.clearTimer()
      return
    }
    const delay = Math.min(Math.max(nextDue - this.now(), 0), this.maxSleepMs)
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.timer = setTimeout(() => {
      this.timer = null
      this.tick()
    }, delay)
  }

  private nextDueAt(): number | null {
    let next: number | null = null
    for (const tickets of this.tasks.values()) {
      for (const ticket of tickets.values()) {
        if (next === null || ticket.dueAt < next) next = ticket.dueAt
      }
    }
    return next
  }

  private tick(): void {
    if (this.disposed) return
    const now = this.now()
    for (const [taskId, tickets] of this.tasks) {
      for (const [key, ticket] of [...tickets]) {
        if (ticket.dueAt > now) continue
        tickets.delete(key)
        const dispatchedKey = ticketKey(ticket)
        if (this.dispatched.has(dispatchedKey)) continue
        this.dispatched.add(dispatchedKey)
        this.dispatch(ticket)
        if (this.tasks.get(taskId) !== tickets) break
      }
    }
    this.scheduleNextTick()
  }
}
