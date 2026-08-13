export type TerminalSessionKind = 'interactive' | 'non-interactive'

export type TerminalSessionStatus =
  | 'running'
  | 'closed'
  | 'failed'
  | 'killed'
  | 'interrupted'

export type TerminalRetryMode = 'workflow' | 'standalone'

export type TerminalClosedEvent = {
  sessionId: string
  taskId: string
  nodeId: string
  exitCode: number | null
  status: Extract<TerminalSessionStatus, 'closed' | 'failed' | 'killed'>
}

export function isTerminalSessionRunning(status: TerminalSessionStatus): boolean {
  return status === 'running'
}

export function isTerminalSessionEnded(status: TerminalSessionStatus): boolean {
  return status !== 'running'
}
