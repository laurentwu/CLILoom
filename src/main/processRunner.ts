import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import { getTerminalSessionDisplayCommand, type AppDatabase } from './database'
import { spawn as ptySpawn, type IPty } from 'node-pty'
import type {
  DetectedShell,
  ExecutionTargetDescriptor,
  ResolvedExecutionTarget,
  ShellNeutralCommand
} from '../shared/shell'
import {
  isUnsupportedWslExecutionTarget,
  parseExecutionTargetDescriptor,
  parseShellNeutralCommand,
  toExecutionTargetDescriptor
} from '../shared/shell'
import { t } from './i18n'
import { TerminalRetryError } from './errors'
import {
  appendBoundedText,
  MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS,
  MAX_PROCESS_RESULT_CHARS,
  MAX_TERMINAL_IPC_BATCH_CHARS,
  MAX_TERMINAL_TRANSCRIPT_CHARS,
  tailText,
  type TerminalDataEvent,
  type TerminalTranscriptSnapshot
} from '../shared/terminalBuffer'
import { getInteractiveCommandTerminator } from './shellExecution'
import { discoverShells, selectDefaultShell, ShellUnavailableError } from './shellService'
import { terminateProcessTree, type ProcessTerminationResult, type ProcessTreeHandle } from './processTermination'
import {
  prepareExecutionInvocation,
  type PreparedExecutionInvocation
} from './executionInvocation'

const SESSION_PERSIST_INTERVAL_MS = 5000
const TERMINAL_DATA_FLUSH_INTERVAL_MS = 16

type TerminalOutputMapper = {
  map: (content: string) => string
  flush: () => string
}

function createCommandDisplayMapper(
  command: string,
  displayCommand: string
): TerminalOutputMapper | null {
  if (!command || command === displayCommand) return null

  let pending = ''

  return {
    map(content) {
      pending += content
      let mapped = ''
      let commandIndex = pending.indexOf(command)
      while (commandIndex >= 0) {
        mapped += pending.slice(0, commandIndex) + displayCommand
        pending = pending.slice(commandIndex + command.length)
        commandIndex = pending.indexOf(command)
      }

      const maxPrefixLength = Math.min(pending.length, command.length - 1)
      let retainedLength = 0
      for (let length = maxPrefixLength; length > 0; length--) {
        if (command.startsWith(pending.slice(-length))) {
          retainedLength = length
          break
        }
      }
      mapped += pending.slice(0, pending.length - retainedLength)
      pending = retainedLength > 0 ? pending.slice(-retainedLength) : ''
      return mapped
    },
    flush() {
      const mapped = pending
      pending = ''
      return mapped
    }
  }
}

function createInitialCommandEchoFilter(command: string): TerminalOutputMapper | null {
  if (!command) return null

  // Input written before an interactive shell initializes its prompt can be
  // echoed once by the TTY and then drawn again by the shell with its prompt.
  const echoedLines = [`${command}\r\n`, `${command}\n`]
  let heldEcho = ''
  let pending = ''
  let state: 'matching-echo' | 'awaiting-redraw' | 'passthrough' = 'matching-echo'

  const releasePending = (includeHeldEcho: boolean) => {
    const mapped = `${includeHeldEcho ? heldEcho : ''}${pending}`
    heldEcho = ''
    pending = ''
    state = 'passthrough'
    return mapped
  }

  const resolveRedraw = () => {
    const redrawIndex = pending.indexOf(command)
    const nextLineEnd = pending.indexOf('\n')
    if (redrawIndex >= 0 && (nextLineEnd < 0 || redrawIndex <= nextLineEnd)) {
      return releasePending(false)
    }
    if (nextLineEnd >= 0) return releasePending(true)
    return ''
  }

  return {
    map(content) {
      if (state === 'passthrough') return content
      pending += content

      if (state === 'matching-echo') {
        const echoedLine = echoedLines.find((candidate) => pending.startsWith(candidate))
        if (echoedLine) {
          heldEcho = echoedLine
          pending = pending.slice(echoedLine.length)
          state = 'awaiting-redraw'
        } else if (echoedLines.some((candidate) => candidate.startsWith(pending))) {
          return ''
        } else {
          return releasePending(false)
        }
      }

      return resolveRedraw()
    },
    flush() {
      if (state === 'passthrough') return ''
      return releasePending(state === 'awaiting-redraw')
    }
  }
}

export type RunProcessRequest = {
  taskId: string
  nodeId: string
  kind: 'interactive' | 'non-interactive'
  command: string | ShellNeutralCommand
  displayCommand?: string
  cwd: string
  sourceCwd?: string
  executionTarget?: ExecutionTargetDescriptor
  env?: Record<string, string>
  timeoutMs?: number
  cols?: number
  rows?: number
  preparationError?: string
}

export type RunProcessResult = {
  sessionId: string
  stdout: string
  stderr: string
  exitCode: number | null
  status?: 'closed' | 'killed' | 'failed'
}

export type RetriedProcess = {
  sessionId: string
  taskId: string
  nodeId: string
  result: Promise<RunProcessResult>
}

export type RetryProcessTarget = Omit<RetriedProcess, 'result'>

export type RunHookRequest = {
  taskId: string
  nodeId: string
  hookType: 'start' | 'end'
  command: string | ShellNeutralCommand
  cwd: string
  sourceCwd?: string
  executionTarget?: ExecutionTargetDescriptor
  env?: Record<string, string>
  preparationError?: string
}

export type HookRunResult = {
  hookRunId: string
  stdout: string
  stderr: string
  exitCode: number | null
  status?: 'completed' | 'failed' | 'killed'
}

type Session = {
  id: string
  taskId: string
  nodeId: string
  kind: RunProcessRequest['kind']
  child: IPty
  transcript: string
  transcriptCursor: number
  settled: boolean
  finalizing: boolean
  terminationPending: boolean
  finalization?: Promise<boolean>
  inputReady?: boolean
  flushDisplay?: () => void
  finish: (
    status: 'closed' | 'killed' | 'failed',
    exitCode: number | null,
    terminate: boolean
  ) => Promise<boolean>
}

type HookSession = {
  id: string
  taskId: string
  child: ChildProcessWithoutNullStreams
  settled: boolean
  finalizing: boolean
  terminationPending: boolean
  finalization?: Promise<boolean>
  finish: (
    status: 'completed' | 'failed' | 'killed',
    exitCode: number | null,
    terminate: boolean
  ) => Promise<boolean>
}

type PendingLaunch = {
  id: string
  taskId: string
  cancelled: boolean
  completion: Promise<void>
  complete: () => void
}

type PendingTerminalData = TerminalDataEvent
type TerminalDataInput = Omit<TerminalDataEvent, 'cursor'>

type StoredRunRetry = {
  command: ShellNeutralCommand
  sourceCwd?: string
  targetCwd?: string
  target?: ExecutionTargetDescriptor
  env?: Record<string, string>
  timeoutMs?: number
  displayCommand?: string
  cols?: number
  rows?: number
  preparationError?: string
}

type StoredRunEnvelope = {
  version: 3
  retry: StoredRunRetry
  diagnostic?: {
    targetId: string
    kind: 'native'
    family: ResolvedExecutionTarget['family']
    displayName: string
    executablePath: string
  }
}

type RetriableSessionRecord = {
  id: string
  task_id: string
  node_id: string
  kind: RunProcessRequest['kind']
  command: string
  cwd: string
  status: string
  created_at: string
  request_json?: string | null
}

type NormalizedRunRequest = Omit<RunProcessRequest, 'command' | 'env'> & {
  command: ShellNeutralCommand
  env?: Record<string, string>
}

export type EffectiveShellResolver = {
  resolveEffectiveShell: () => DetectedShell
  resolveEffectiveTarget?: () => Promise<ResolvedExecutionTarget>
  resolveTarget?: (target: ExecutionTargetDescriptor) => Promise<ResolvedExecutionTarget>
  resolveTargetPath?: (target: ResolvedExecutionTarget, value: string) => Promise<string>
}

export type ProcessTreeTerminator = (
  handle: ProcessTreeHandle
) => Promise<ProcessTerminationResult>

export class ProcessRunner {
  private readonly sessions = new Map<string, Session>()
  private readonly hookSessions = new Map<string, HookSession>()
  private readonly pendingSessions = new Map<string, PendingLaunch>()
  private readonly pendingHooks = new Map<string, PendingLaunch>()
  private pendingSessionUpdates = new Map<string, { transcript: string; status: string; updatedAt: string }>()
  private flushTimer: NodeJS.Timeout | null = null
  private terminalDataQueue: PendingTerminalData[] = []
  private terminalDataTimer: NodeJS.Timeout | null = null
  private terminalDataCursor = 0
  private readonly shellResolver: EffectiveShellResolver
  private readonly terminateTree: ProcessTreeTerminator

  constructor(
    private readonly db: AppDatabase,
    private readonly getWindow: () => BrowserWindow | null,
    private environment: NodeJS.ProcessEnv = process.env,
    shellResolver?: EffectiveShellResolver,
    terminateTree: ProcessTreeTerminator = terminateProcessTree,
    private readonly hostRunDirectory: string = process.cwd(),
    private readonly platform: NodeJS.Platform = process.platform
  ) {
    this.shellResolver = shellResolver ?? {
      resolveEffectiveShell: () => resolveEnvironmentShell(this.environment)
    }
    this.terminateTree = terminateTree
  }

  setEnvironment(environment: NodeJS.ProcessEnv): void {
    this.environment = environment
  }

  run(request: RunProcessRequest): Promise<RunProcessResult> {
    let normalized: NormalizedRunRequest
    try {
      normalized = normalizeRunRequest(request)
    } catch (error) {
      return this.createRejectedSession(request, error)
    }
    const sessionId = randomUUID()
    const now = new Date().toISOString()
    const displayCommand = getRequestDisplayCommand(normalized)
    const initialTranscript = tailText(
      normalized.kind === 'non-interactive' ? `$ ${displayCommand}\n` : '',
      MAX_TERMINAL_TRANSCRIPT_CHARS
    )

    this.db
      .prepare(
        'insert into terminal_sessions (id, task_id, node_id, kind, command, cwd, status, transcript, created_at, updated_at, request_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        sessionId,
        normalized.taskId,
        normalized.nodeId,
        normalized.kind,
        neutralCommandSource(normalized.command),
        normalized.cwd,
        'running',
        tailText(initialTranscript, MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS),
        now,
        now,
        this.serializeStoredRunRequest(normalized)
      )

    this.getWindow()?.webContents.send('terminal:created', {
      id: sessionId,
      task_id: normalized.taskId,
      node_id: normalized.nodeId,
      kind: normalized.kind,
      command: displayCommand,
      cwd: normalized.cwd,
      status: 'running',
      transcript: initialTranscript,
      transcript_cursor: this.terminalDataCursor,
      created_at: now,
      updated_at: now,
      ...(normalized.executionTarget
        ? { execution_target: executionTargetMetadata(normalized.executionTarget) }
        : {})
    })

    const pending = createPendingLaunch(sessionId, normalized.taskId)
    this.pendingSessions.set(sessionId, pending)
    const result = this.runPty(normalized, sessionId, initialTranscript, 'terminal:created', now)
    void result.then(
      () => this.finishPendingLaunch(this.pendingSessions, pending),
      () => this.finishPendingLaunch(this.pendingSessions, pending)
    )
    return result
  }

  getRetryTarget(sessionId: string): RetryProcessTarget {
    const row = this.getRetriableSession(sessionId)
    return {
      sessionId: row.id,
      taskId: row.task_id,
      nodeId: row.node_id
    }
  }

  retry(sessionId: string): RetriedProcess {
    const row = this.getRetriableSession(sessionId)
    const storedRequest = this.parseStoredRunRequest(row.command, row.request_json)
    const request: NormalizedRunRequest = {
      taskId: row.task_id,
      nodeId: row.node_id,
      kind: row.kind,
      command: storedRequest.command,
      displayCommand: storedRequest.displayCommand
        ?? getTerminalSessionDisplayCommand(row.command, row.request_json),
      cwd: storedRequest.targetCwd ?? row.cwd,
      sourceCwd: storedRequest.sourceCwd ?? row.cwd,
      ...(storedRequest.target ? { executionTarget: storedRequest.target } : {}),
      env: storedRequest.env,
      timeoutMs: storedRequest.timeoutMs,
      cols: storedRequest.cols,
      rows: storedRequest.rows,
      preparationError: storedRequest.preparationError
    }
    const now = new Date().toISOString()
    const displayCommand = getRequestDisplayCommand(request)
    const initialTranscript = tailText(
      request.kind === 'non-interactive' ? `$ ${displayCommand}\n` : '',
      MAX_TERMINAL_TRANSCRIPT_CHARS
    )

    this.flushTerminalData()
    this.flushSessionUpdates()
    this.db.prepare(
      `update terminal_sessions
      set status = ?, transcript = ?, updated_at = ?, request_json = ?
      where id = ?`
    ).run(
      'running',
      tailText(initialTranscript, MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS),
      now,
      this.serializeStoredRunRequest(request),
      sessionId
    )

    this.getWindow()?.webContents.send('terminal:restarted', {
      id: sessionId,
      task_id: request.taskId,
      node_id: request.nodeId,
      kind: request.kind,
      command: displayCommand,
      cwd: request.cwd,
      status: 'running',
      transcript: initialTranscript,
      transcript_cursor: this.terminalDataCursor,
      created_at: row.created_at,
      updated_at: now,
      ...(request.executionTarget
        ? { execution_target: executionTargetMetadata(request.executionTarget) }
        : {})
    })

    const pending = createPendingLaunch(sessionId, request.taskId)
    this.pendingSessions.set(sessionId, pending)
    const runResult = this.runPty(
      request,
      sessionId,
      initialTranscript,
      'terminal:restarted',
      row.created_at
    )
    void runResult.then(
      () => this.finishPendingLaunch(this.pendingSessions, pending),
      () => this.finishPendingLaunch(this.pendingSessions, pending)
    )
    const result = runResult.catch((error: unknown) => {
      console.error('[ProcessRunner] Retried terminal failed:', error)
      return {
        sessionId,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: -1,
        status: 'failed' as const
      }
    })
    return {
      sessionId,
      taskId: request.taskId,
      nodeId: request.nodeId,
      result
    }
  }

  private getRetriableSession(sessionId: string): RetriableSessionRecord {
    const row = this.db.prepare(
      `select id, task_id, node_id, kind, command, cwd, status, created_at, request_json
      from terminal_sessions where id = ?`
    ).get(sessionId) as RetriableSessionRecord | undefined

    if (!row) throw new Error(t('errors:session.notFound'))
    if (row.status.startsWith('running') || this.hasLiveSession(sessionId)) {
      throw new Error(t('errors:session.stillRunning'))
    }
    return row
  }

  private serializeStoredRunRequest(
    request: NormalizedRunRequest,
    target?: ResolvedExecutionTarget
  ): string {
    const persistedTarget = target
      ? toExecutionTargetDescriptor(target)
      : request.executionTarget
    if (!persistedTarget) {
      const legacyRetry: Record<string, unknown> = { command: request.command }
      if (request.env && Object.keys(request.env).length > 0) legacyRetry.env = request.env
      if (request.timeoutMs !== undefined) legacyRetry.timeoutMs = request.timeoutMs
      if (request.displayCommand !== undefined) legacyRetry.displayCommand = request.displayCommand
      if (request.cols !== undefined) legacyRetry.cols = request.cols
      if (request.rows !== undefined) legacyRetry.rows = request.rows
      if (request.preparationError !== undefined) legacyRetry.preparationError = request.preparationError
      return JSON.stringify({ version: 2, retry: legacyRetry })
    }
    const retry: StoredRunRetry = {
      command: request.command,
      sourceCwd: request.sourceCwd ?? request.cwd,
      targetCwd: request.cwd,
      target: persistedTarget
    }
    if (request.env && Object.keys(request.env).length > 0) retry.env = request.env
    if (request.timeoutMs !== undefined) retry.timeoutMs = request.timeoutMs
    if (request.displayCommand !== undefined) retry.displayCommand = request.displayCommand
    if (request.cols !== undefined) retry.cols = request.cols
    if (request.rows !== undefined) retry.rows = request.rows
    if (request.preparationError !== undefined) retry.preparationError = request.preparationError
    const stored: StoredRunEnvelope = {
      version: 3,
      retry,
      ...(target ? {
        diagnostic: {
          targetId: target.id,
          kind: 'native',
          family: target.family,
          displayName: target.displayName,
          executablePath: target.executablePath
        }
      } : {})
    }
    return JSON.stringify(stored)
  }

  private parseStoredRunRequest(
    storedCommand: string,
    value: string | null | undefined
  ): StoredRunRetry {
    if (!value) return decodeLegacyCommand(storedCommand, undefined)
    try {
      const parsedValue = JSON.parse(value) as unknown
      if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) {
        throw new TerminalRetryError(t('errors:session.historyInvalid'))
      }
      const parsed = parsedValue as Record<string, unknown>
      if (parsed.version === 2 || parsed.version === 3) {
        const retryValue = parsed.retry
        if (!retryValue || typeof retryValue !== 'object' || Array.isArray(retryValue)) {
          throw new TerminalRetryError(t('errors:session.retryDataInvalid'))
        }
        const retry = retryValue as Record<string, unknown>
        const command = parseShellNeutralCommand(retry.command)
        if (!command) throw new TerminalRetryError(t('errors:session.retryCommandInvalid'))
        const target = parsed.version === 3
          ? parseExecutionTargetDescriptor(retry.target)
          : null
        if (parsed.version === 3 && !target) {
          throw new TerminalRetryError(
            isUnsupportedWslExecutionTarget(retry.target)
              ? t('errors:session.executionTargetUnsupported')
              : t('errors:session.retryDataInvalid')
          )
        }
        const sourceCwd = typeof retry.sourceCwd === 'string' && retry.sourceCwd
          ? retry.sourceCwd
          : undefined
        const targetCwd = typeof retry.targetCwd === 'string' && retry.targetCwd
          ? retry.targetCwd
          : undefined
        if (parsed.version === 3 && (!sourceCwd || !targetCwd)) {
          throw new TerminalRetryError(t('errors:session.retryDataInvalid'))
        }
        return {
          command,
          ...(sourceCwd ? { sourceCwd } : {}),
          ...(targetCwd ? { targetCwd } : {}),
          ...(target ? { target } : {}),
          env: parseStoredEnvironment(retry.env),
          timeoutMs: parseStoredNumber(retry.timeoutMs),
          displayCommand: typeof retry.displayCommand === 'string' ? retry.displayCommand : undefined,
          cols: parseStoredNumber(retry.cols),
          rows: parseStoredNumber(retry.rows),
          preparationError: typeof retry.preparationError === 'string'
            ? retry.preparationError
            : undefined
        }
      }

      const env = parsed.env && typeof parsed.env === 'object' && !Array.isArray(parsed.env)
        ? Object.fromEntries(
            Object.entries(parsed.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
          )
        : undefined
      const timeoutMs = typeof parsed.timeoutMs === 'number' && Number.isFinite(parsed.timeoutMs)
        ? parsed.timeoutMs
        : undefined
      const displayCommand = typeof parsed.displayCommand === 'string'
        ? parsed.displayCommand
        : undefined
      const decoded = decodeLegacyCommand(storedCommand, env)
      return {
        command: decoded.command,
        env: decoded.env,
        timeoutMs,
        displayCommand
      }
    } catch (error) {
      if (error instanceof TerminalRetryError) throw error
      throw new TerminalRetryError(t('errors:session.retryReadFailed'))
    }
  }

  private async runPty(
    request: NormalizedRunRequest,
    sessionId: string,
    initialTranscript: string,
    resolvedEventChannel: 'terminal:created' | 'terminal:restarted',
    createdAt: string
  ): Promise<RunProcessResult> {
    const isInteractive = request.kind === 'interactive'
    let shell: ResolvedExecutionTarget | null = null
    const launchRequest = request
    let invocation: PreparedExecutionInvocation
    if (this.isPendingCancelled(this.pendingSessions, sessionId)) {
      return this.cancelUnstartedSession(request, sessionId, initialTranscript)
    }
    try {
      if (request.preparationError) throw new Error(request.preparationError)
    } catch (error) {
      if (this.isPendingCancelled(this.pendingSessions, sessionId)) {
        return this.cancelUnstartedSession(request, sessionId, initialTranscript)
      }
      return this.failUnstartedSession(request, sessionId, initialTranscript, t('errors:shell.stageParse'), error, shell)
    }
    try {
      const resolved = this.resolveRequestTarget(request.executionTarget)
      shell = isPromiseLike(resolved) ? await resolved : resolved
    } catch (error) {
      if (this.isPendingCancelled(this.pendingSessions, sessionId)) {
        return this.cancelUnstartedSession(request, sessionId, initialTranscript)
      }
      return this.failUnstartedSession(request, sessionId, initialTranscript, t('errors:shell.stageDetect'), error, shell)
    }
    if (this.isPendingCancelled(this.pendingSessions, sessionId)) {
      return this.cancelUnstartedSession(request, sessionId, initialTranscript)
    }
    try {
      if (this.isPendingCancelled(this.pendingSessions, sessionId)) {
        return this.cancelUnstartedSession(request, sessionId, initialTranscript)
      }
      invocation = prepareExecutionInvocation({
        target: shell,
        mode: isInteractive ? 'interactive' : 'non-interactive',
        command: launchRequest.command,
        targetCwd: launchRequest.cwd,
        hostCwd: this.hostRunDirectory,
        baseEnvironment: this.environment,
        requestEnvironment: launchRequest.env,
        platform: this.platform
      })
      const resolvedAt = new Date().toISOString()
      this.db.prepare(
        'update terminal_sessions set command = ?, cwd = ?, request_json = ?, updated_at = ? where id = ?'
      ).run(
        invocation.command,
        invocation.targetCwd,
        this.serializeStoredRunRequest(launchRequest, shell),
        resolvedAt,
        sessionId
      )
      this.getWindow()?.webContents.send(resolvedEventChannel, {
        id: sessionId,
        task_id: launchRequest.taskId,
        node_id: launchRequest.nodeId,
        kind: launchRequest.kind,
        command: getRequestDisplayCommand(launchRequest),
        cwd: invocation.targetCwd,
        status: 'running',
        transcript: initialTranscript,
        transcript_cursor: this.terminalDataCursor,
        created_at: createdAt,
        updated_at: resolvedAt,
        execution_target: executionTargetMetadata(shell)
      })
    } catch (error) {
      if (this.isPendingCancelled(this.pendingSessions, sessionId)) {
        return this.cancelUnstartedSession(request, sessionId, initialTranscript)
      }
      return this.failUnstartedSession(request, sessionId, initialTranscript, t('errors:shell.stageParse'), error, shell)
    }
    if (this.isPendingCancelled(this.pendingSessions, sessionId)) {
      return this.cancelUnstartedSession(request, sessionId, initialTranscript)
    }
    const displayCommand = getRequestDisplayCommand(request)
    const initialCommandEchoFilter = isInteractive
      ? createInitialCommandEchoFilter(invocation.command)
      : null
    const displayMapper = isInteractive
      ? createCommandDisplayMapper(invocation.command, displayCommand)
      : null
    let stdout = ''
    let stderr = ''

    let term: IPty
    try {
      term = ptySpawn(invocation.executable, invocation.args, {
        name: 'xterm-256color',
        cols: request.cols ?? 100,
        rows: request.rows ?? 40,
        cwd: invocation.hostCwd,
        env: invocation.env
      })
    } catch (err) {
      return this.failUnstartedSession(request, sessionId, initialTranscript, t('errors:shell.stageStart'), err, shell)
    }

    let resolveResult: (result: RunProcessResult) => void = () => undefined
    const result = new Promise<RunProcessResult>((resolve) => {
      resolveResult = resolve
    })
    const session: Session = {
      id: sessionId,
      taskId: request.taskId,
      nodeId: request.nodeId,
      kind: request.kind,
      child: term,
      transcript: initialTranscript,
      transcriptCursor: this.terminalDataCursor,
      settled: false,
      finalizing: false,
      terminationPending: false,
      finish: async () => false
    }
    this.sessions.set(sessionId, session)
    this.finishPendingLaunch(this.pendingSessions, this.pendingSessions.get(sessionId))

    const appendTerminalContent = (stream: 'stdout' | 'stderr', content: string) => {
      if (!content) return
      session.transcript = appendBoundedText(
        session.transcript,
        content,
        MAX_TERMINAL_TRANSCRIPT_CHARS
      )
      this.persistOutput(sessionId, session.transcript, 'running')
      session.transcriptCursor = this.queueTerminalData({
        sessionId,
        taskId: request.taskId,
        nodeId: request.nodeId,
        stream,
        content
      })
    }

    const append = (stream: 'stdout' | 'stderr', content: string) => {
      if (session.settled || session.finalizing) return
      if (stream === 'stdout') {
        stdout = appendBoundedText(stdout, content, MAX_PROCESS_RESULT_CHARS)
      } else {
        stderr = appendBoundedText(stderr, content, MAX_PROCESS_RESULT_CHARS)
      }
      let terminalContent = content
      if (stream === 'stdout') {
        if (initialCommandEchoFilter) terminalContent = initialCommandEchoFilter.map(terminalContent)
        if (displayMapper) terminalContent = displayMapper.map(terminalContent)
      }
      appendTerminalContent(stream, terminalContent)
    }
    session.flushDisplay = () => {
      let content = initialCommandEchoFilter?.flush() ?? ''
      if (displayMapper) content = displayMapper.map(content) + displayMapper.flush()
      appendTerminalContent('stdout', content)
    }

    term.onData((data: string) => append('stdout', data))
    let timeout: NodeJS.Timeout | undefined
    session.finish = (status, exitCode, terminate) => {
      if (session.settled) {
        if (!terminate || !session.terminationPending) return Promise.resolve(false)
        if (session.finalizing) return session.finalization ?? Promise.resolve(false)
        const retryTermination = (async () => {
          session.finalizing = true
          try {
            const result = await this.terminateTree(term)
            if (result.terminated) {
              session.terminationPending = false
              this.sessions.delete(sessionId)
            }
            return result.terminated
          } catch {
            return false
          } finally {
            session.finalizing = false
            session.finalization = undefined
          }
        })()
        session.finalization = retryTermination
        return retryTermination
      }
      if (session.finalizing) return session.finalization ?? Promise.resolve(false)
      if (session.finalization) return session.finalization
      const finalization = (async () => {
        session.finalizing = true
        if (timeout) clearTimeout(timeout)
        let terminationSucceeded = true
        if (terminate) {
          let terminationError: string | undefined
          try {
            const termination = await this.terminateTree(term)
            terminationSucceeded = termination.terminated
            terminationError = termination.error
          } catch (error) {
            terminationSucceeded = false
            terminationError = error instanceof Error ? error.message : String(error)
          }
          if (terminationError) {
            const content = `\n${t('terminal:transcript.errorPrefix', { message: t('terminal:transcript.treeKillFailed', { detail: terminationError }) })}\n`
            stderr = appendBoundedText(stderr, content, MAX_PROCESS_RESULT_CHARS)
            appendTerminalContent('stderr', content)
          }
        }
        session.terminationPending = terminate && !terminationSucceeded
        session.settled = true
        session.finalizing = false
        session.flushDisplay?.()
        if (!session.terminationPending) this.sessions.delete(sessionId)
        this.persistSession(sessionId, session.transcript, status)
        this.getWindow()?.webContents.send('terminal:closed', {
          sessionId,
          taskId: request.taskId,
          nodeId: request.nodeId,
          exitCode,
          status
        })
        resolveResult({
          sessionId,
          stdout,
          stderr,
          exitCode: status === 'killed' ? null : (exitCode ?? -1),
          status
        })
        return terminationSucceeded
      })()
      session.finalization = finalization
      return finalization
    }
    term.onExit(({ exitCode }) => {
      void session.finish('closed', exitCode ?? -1, false)
    })

    if (!isInteractive && request.timeoutMs) {
      timeout = setTimeout(() => {
        append('stderr', `\n${t('terminal:transcript.errorPrefix', { message: t('terminal:transcript.timeout', { ms: request.timeoutMs }) })}\n`)
        void session.finish('failed', -1, true)
      }, request.timeoutMs)
    }

    if (isInteractive) {
      try {
        term.write(invocation.command + getInteractiveCommandTerminator(this.platform))
      } catch (err) {
        const message = formatShellError(t('errors:shell.stageWrite'), err, shell)
        append('stderr', `\n${t('terminal:transcript.errorPrefix', { message })}\n`)
        void session.finish('failed', -1, true)
        return result
      }
      session.inputReady = true
      this.getWindow()?.webContents.send('terminal:attached', {
        sessionId,
        taskId: request.taskId,
        nodeId: request.nodeId
      })
    }

    return result
  }

  write(sessionId: string, input: string): boolean {
    const session = this.sessions.get(sessionId)
    if (
      !session || session.kind !== 'interactive' || !session.inputReady ||
      session.settled || session.finalizing
    ) return false
    try {
      session.child.write(input)
    } catch {
      return false
    }
    return true
  }

  resize(sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(sessionId)
    if (!session || session.settled || session.finalizing) return false
    const c = Math.max(1, Math.floor(cols))
    const r = Math.max(1, Math.floor(rows))
    try {
      session.child.resize(c, r)
    } catch {
      return false
    }
    return true
  }

  isInputReady(sessionId: string): boolean {
    const session = this.sessions.get(sessionId)
    return !!session && !session.settled && !session.finalizing &&
      session.kind === 'interactive' && session.inputReady === true
  }

  async runHook(request: RunHookRequest): Promise<HookRunResult> {
    const hookRunId = randomUUID()
    const pending = createPendingLaunch(hookRunId, request.taskId)
    this.pendingHooks.set(hookRunId, pending)
    try {
    const now = new Date().toISOString()
    let stdout = ''
    let stderr = ''

    this.db
      .prepare(
        'insert into hook_runs (id, task_id, node_id, hook_type, status, stdout, stderr, exit_code, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(hookRunId, request.taskId, request.nodeId, request.hookType, 'running', '', '', null, now)

    const failUnstarted = (stage: string, error: unknown): HookRunResult => {
      const message = formatShellError(stage, error, shell)
      stderr = tailText(`${t('terminal:transcript.errorPrefix', { message })}\n`, MAX_PROCESS_RESULT_CHARS)
      this.db.prepare(
        'update hook_runs set status = ?, stdout = ?, stderr = ?, exit_code = ? where id = ?'
      ).run('failed', stdout, stderr, -1, hookRunId)
      return { hookRunId, stdout, stderr, exitCode: -1, status: 'failed' }
    }

    let child: ChildProcessWithoutNullStreams | undefined
    let shell: ResolvedExecutionTarget | null = null
    if (pending.cancelled) return this.cancelUnstartedHook(hookRunId)
    try {
      if (request.preparationError) throw new Error(request.preparationError)
    } catch (error) {
      if (pending.cancelled) return this.cancelUnstartedHook(hookRunId)
      return failUnstarted(t('errors:shell.stageParse'), error)
    }
    let normalized: ReturnType<typeof normalizeCommandAndEnvironment>
    try {
      normalized = normalizeCommandAndEnvironment(request.command, request.env)
    } catch (error) {
      if (pending.cancelled) return this.cancelUnstartedHook(hookRunId)
      return failUnstarted(t('errors:shell.stageParse'), error)
    }
    try {
      const resolved = this.resolveRequestTarget(request.executionTarget)
      shell = isPromiseLike(resolved) ? await resolved : resolved
    } catch (error) {
      if (pending.cancelled) return this.cancelUnstartedHook(hookRunId)
      return failUnstarted(t('errors:shell.stageDetect'), error)
    }
    if (pending.cancelled) return this.cancelUnstartedHook(hookRunId)
    let invocation: PreparedExecutionInvocation
    try {
      if (pending.cancelled) return this.cancelUnstartedHook(hookRunId)
      invocation = prepareExecutionInvocation({
        target: shell,
        mode: 'non-interactive',
        command: normalized.command,
        targetCwd: request.cwd,
        hostCwd: this.hostRunDirectory,
        baseEnvironment: this.environment,
        requestEnvironment: normalized.env,
        platform: this.platform
      })
    } catch (error) {
      if (pending.cancelled) return this.cancelUnstartedHook(hookRunId)
      return failUnstarted(t('errors:shell.stageParse'), error)
    }
    if (pending.cancelled) return this.cancelUnstartedHook(hookRunId)
    try {
      child = spawn(invocation.executable, invocation.args, {
        cwd: invocation.hostCwd,
        env: invocation.env,
        shell: false,
        detached: this.platform !== 'win32',
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      child.stdin.end()
    } catch (error) {
      if (child) {
        try {
          await this.terminateTree(child)
        } catch {
          // The launch error remains the primary actionable failure.
        }
      }
      if (pending.cancelled) return this.cancelUnstartedHook(hookRunId)
      return failUnstarted(t('errors:shell.stageStart'), error)
    }

    const activeChild = child
    activeChild.stdout.setEncoding('utf8')
    activeChild.stderr.setEncoding('utf8')
    activeChild.stdout.on('data', (chunk: string) => {
      stdout = appendBoundedText(stdout, chunk, MAX_PROCESS_RESULT_CHARS)
    })
    activeChild.stderr.on('data', (chunk: string) => {
      stderr = appendBoundedText(stderr, chunk, MAX_PROCESS_RESULT_CHARS)
    })

    let resolveResult: (result: HookRunResult) => void = () => undefined
    const result = new Promise<HookRunResult>((resolve) => {
      resolveResult = resolve
    })
    const hookSession: HookSession = {
      id: hookRunId,
      taskId: request.taskId,
      child: activeChild,
      settled: false,
      finalizing: false,
      terminationPending: false,
      finish: async () => false
    }
    this.hookSessions.set(hookRunId, hookSession)
    this.finishPendingLaunch(this.pendingHooks, pending)
    hookSession.finish = (status, exitCode, terminate) => {
      if (hookSession.settled) {
        if (!terminate || !hookSession.terminationPending) return Promise.resolve(false)
        if (hookSession.finalizing) return hookSession.finalization ?? Promise.resolve(false)
        const retryTermination = (async () => {
          hookSession.finalizing = true
          try {
            const result = await this.terminateTree(activeChild)
            if (result.terminated) {
              hookSession.terminationPending = false
              this.hookSessions.delete(hookRunId)
            }
            return result.terminated
          } catch {
            return false
          } finally {
            hookSession.finalizing = false
            hookSession.finalization = undefined
          }
        })()
        hookSession.finalization = retryTermination
        return retryTermination
      }
      if (hookSession.finalizing) return hookSession.finalization ?? Promise.resolve(false)
      if (hookSession.finalization) return hookSession.finalization
      const finalization = (async () => {
        hookSession.finalizing = true
        let terminationSucceeded = true
        if (terminate) {
          let terminationError: string | undefined
          try {
            const termination = await this.terminateTree(activeChild)
            terminationSucceeded = termination.terminated
            terminationError = termination.error
          } catch (error) {
            terminationSucceeded = false
            terminationError = error instanceof Error ? error.message : String(error)
          }
          if (terminationError) {
            stderr = appendBoundedText(
              stderr,
              `\n${t('terminal:transcript.errorPrefix', { message: t('terminal:transcript.treeKillFailed', { detail: terminationError }) })}\n`,
              MAX_PROCESS_RESULT_CHARS
            )
          }
        }
        hookSession.terminationPending = terminate && !terminationSucceeded
        hookSession.settled = true
        hookSession.finalizing = false
        if (!hookSession.terminationPending) this.hookSessions.delete(hookRunId)
        const persistedStatus = status === 'completed' ? 'completed' : status
        this.db
          .prepare('update hook_runs set status = ?, stdout = ?, stderr = ?, exit_code = ? where id = ?')
          .run(persistedStatus, stdout, stderr, exitCode, hookRunId)
        resolveResult({
          hookRunId,
          stdout,
          stderr,
          exitCode,
          status
        })
        return terminationSucceeded
      })()
      hookSession.finalization = finalization
      return finalization
    }
    activeChild.on('error', (err) => {
      stderr = appendBoundedText(
        stderr,
        `\n${t('terminal:transcript.errorPrefix', { message: formatShellError(t('errors:shell.stageStart'), err, shell) })}\n`,
        MAX_PROCESS_RESULT_CHARS
      )
      void hookSession.finish('failed', -1, true)
    })

    activeChild.on('close', (exitCode) => {
      void hookSession.finish(
        exitCode === 0 ? 'completed' : 'failed',
        exitCode,
        false
      )
    })
    return result
    } finally {
      this.finishPendingLaunch(this.pendingHooks, pending)
    }
  }

  async kill(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (session) return session.finish('killed', null, true)
    const pending = this.pendingSessions.get(sessionId)
    return pending ? this.cancelPendingLaunch(pending) : false
  }

  async killByTask(taskId: string): Promise<number> {
    const terminalKills = [...this.sessions.values()]
      .filter((session) => session.taskId === taskId)
      .map((session) => session.finish('killed', null, true))
    const hookKills = [...this.hookSessions.values()]
      .filter((session) => session.taskId === taskId)
      .map((session) => session.finish('killed', null, true))
    const pendingTerminalKills = [...this.pendingSessions.values()]
      .filter((pending) => pending.taskId === taskId)
      .map((pending) => this.cancelPendingLaunch(pending))
    const pendingHookKills = [...this.pendingHooks.values()]
      .filter((pending) => pending.taskId === taskId)
      .map((pending) => this.cancelPendingLaunch(pending))
    const results = await Promise.all([
      ...terminalKills,
      ...hookKills,
      ...pendingTerminalKills,
      ...pendingHookKills
    ])
    const failed = results.filter((terminated) => !terminated).length
    if (failed > 0) throw new Error(t('errors:exit.treesNotTerminated', { count: failed }))
    return results.length
  }

  async killAll(): Promise<number> {
    const terminalKills = [...this.sessions.values()]
      .map((session) => session.finish('killed', null, true))
    const hookKills = [...this.hookSessions.values()]
      .map((session) => session.finish('killed', null, true))
    const pendingTerminalKills = [...this.pendingSessions.values()]
      .map((pending) => this.cancelPendingLaunch(pending))
    const pendingHookKills = [...this.pendingHooks.values()]
      .map((pending) => this.cancelPendingLaunch(pending))
    const results = await Promise.all([
      ...terminalKills,
      ...hookKills,
      ...pendingTerminalKills,
      ...pendingHookKills
    ])
    const failed = results.filter((terminated) => !terminated).length
    if (failed > 0) throw new Error(t('errors:exit.treesNotTerminated', { count: failed }))
    return results.length
  }

  hasLiveSession(sessionId: string): boolean {
    return this.sessions.has(sessionId) || this.pendingSessions.has(sessionId)
  }

  getLiveTranscript(sessionId: string, taskId?: string): string | null {
    const session = this.sessions.get(sessionId)
    if (!session || (taskId !== undefined && session.taskId !== taskId)) return null
    return session.transcript
  }

  getLiveTranscriptSnapshot(
    sessionId: string,
    taskId?: string
  ): TerminalTranscriptSnapshot | null {
    const session = this.sessions.get(sessionId)
    if (!session || (taskId !== undefined && session.taskId !== taskId)) return null
    this.flushTerminalData()
    return {
      transcript: session.transcript,
      cursor: session.transcriptCursor
    }
  }

  hasActiveProcesses(): boolean {
    return this.sessions.size > 0 || this.hookSessions.size > 0 ||
      this.pendingSessions.size > 0 || this.pendingHooks.size > 0
  }

  private createRejectedSession(
    request: RunProcessRequest,
    error: unknown
  ): Promise<RunProcessResult> {
    const sessionId = randomUUID()
    const now = new Date().toISOString()
    const displayCommand = sanitizeDisplayCommand(
      request.displayCommand ?? (typeof request.command === 'string' ? request.command : t('terminal:transcript.invalidCommand'))
    )
    const message = formatShellError(t('errors:shell.stageParse'), error, null)
    const errorContent = `${t('terminal:transcript.errorPrefix', { message })}\n`
    const transcript = tailText(
      `${request.kind === 'non-interactive' ? `$ ${displayCommand}\n` : ''}${errorContent}`,
      MAX_TERMINAL_TRANSCRIPT_CHARS
    )
    this.db.prepare(
      'insert into terminal_sessions (id, task_id, node_id, kind, command, cwd, status, transcript, created_at, updated_at, request_json) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      sessionId,
      request.taskId,
      request.nodeId,
      request.kind,
      displayCommand,
      request.cwd,
      'failed',
      tailText(transcript, MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS),
      now,
      now,
      null
    )
    const transcriptCursor = this.queueTerminalData({
      sessionId,
      taskId: request.taskId,
      nodeId: request.nodeId,
      stream: 'stderr',
      content: errorContent
    })
    this.getWindow()?.webContents.send('terminal:created', {
      id: sessionId,
      task_id: request.taskId,
      node_id: request.nodeId,
      kind: request.kind,
      command: displayCommand,
      cwd: request.cwd,
      status: 'failed',
      transcript,
      transcript_cursor: transcriptCursor,
      created_at: now,
      updated_at: now
    })
    this.flushTerminalData()
    this.getWindow()?.webContents.send('terminal:closed', {
      sessionId,
      taskId: request.taskId,
      nodeId: request.nodeId,
      exitCode: -1,
      status: 'failed'
    })
    return Promise.resolve({
      sessionId,
      stdout: '',
      stderr: message,
      exitCode: -1,
      status: 'failed'
    })
  }

  private failUnstartedSession(
    request: NormalizedRunRequest,
    sessionId: string,
    initialTranscript: string,
    stage: string,
    error: unknown,
    shell: ResolvedExecutionTarget | null
  ): Promise<RunProcessResult> {
    const message = formatShellError(stage, error, shell)
    const content = `${t('terminal:transcript.errorPrefix', { message })}\n`
    this.queueTerminalData({
      sessionId,
      taskId: request.taskId,
      nodeId: request.nodeId,
      stream: 'stderr',
      content
    })
    this.persistSession(
      sessionId,
      appendBoundedText(initialTranscript, content, MAX_TERMINAL_TRANSCRIPT_CHARS),
      'failed'
    )
    this.getWindow()?.webContents.send('terminal:closed', {
      sessionId,
      taskId: request.taskId,
      nodeId: request.nodeId,
      exitCode: -1,
      status: 'failed'
    })
    return Promise.resolve({
      sessionId,
      stdout: '',
      stderr: message,
      exitCode: -1,
      status: 'failed'
    })
  }

  private cancelUnstartedSession(
    request: NormalizedRunRequest,
    sessionId: string,
    initialTranscript: string
  ): RunProcessResult {
    this.persistSession(sessionId, initialTranscript, 'killed')
    this.getWindow()?.webContents.send('terminal:closed', {
      sessionId,
      taskId: request.taskId,
      nodeId: request.nodeId,
      exitCode: null,
      status: 'killed'
    })
    return {
      sessionId,
      stdout: '',
      stderr: '',
      exitCode: null,
      status: 'killed'
    }
  }

  private cancelUnstartedHook(hookRunId: string): HookRunResult {
    this.db.prepare(
      'update hook_runs set status = ?, stdout = ?, stderr = ?, exit_code = ? where id = ?'
    ).run('killed', '', '', null, hookRunId)
    return {
      hookRunId,
      stdout: '',
      stderr: '',
      exitCode: null,
      status: 'killed'
    }
  }

  private persistOutput(
    sessionId: string,
    transcript: string,
    status: string
  ): void {
    const now = new Date().toISOString()
    this.pendingSessionUpdates.set(sessionId, {
      transcript: tailText(transcript, MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS),
      status,
      updatedAt: now
    })
    this.scheduleFlush()
  }

  private persistSession(sessionId: string, transcript: string, status: string): void {
    this.pendingSessionUpdates.set(sessionId, {
      transcript: tailText(transcript, MAX_PERSISTED_TERMINAL_TRANSCRIPT_CHARS),
      status,
      updatedAt: new Date().toISOString()
    })
    this.flushTerminalData()
    this.flushSessionUpdates()
  }

  private flushSessionUpdates(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.pendingSessionUpdates.size === 0) return

    const updates = new Map(this.pendingSessionUpdates)

    const updateSession = this.db.prepare(
      'update terminal_sessions set transcript = ?, status = ?, updated_at = ? where id = ?'
    )

    try {
      const tx = this.db.transaction(() => {
        for (const [id, update] of updates.entries()) {
          updateSession.run(update.transcript, update.status, update.updatedAt, id)
        }
      })
      tx()
      this.pendingSessionUpdates.clear()
    } catch (err) {
      console.error('[ProcessRunner] flush failed, retaining queue for retry:', err)
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flushSessionUpdates()
    }, SESSION_PERSIST_INTERVAL_MS)
  }

  private queueTerminalData(event: TerminalDataInput): number {
    this.terminalDataCursor += 1
    const cursor = this.terminalDataCursor
    const last = this.terminalDataQueue.at(-1)
    if (
      last &&
      last.sessionId === event.sessionId &&
      last.stream === event.stream
    ) {
      last.content = appendBoundedText(
        last.content,
        event.content,
        MAX_TERMINAL_IPC_BATCH_CHARS
      )
      last.cursor = cursor
    } else {
      this.terminalDataQueue.push({
        ...event,
        content: tailText(event.content, MAX_TERMINAL_IPC_BATCH_CHARS),
        cursor
      })
    }
    if (!this.terminalDataTimer) {
      this.terminalDataTimer = setTimeout(() => {
        this.terminalDataTimer = null
        this.flushTerminalData()
      }, TERMINAL_DATA_FLUSH_INTERVAL_MS)
    }
    return cursor
  }

  private flushTerminalData(): void {
    if (this.terminalDataTimer) {
      clearTimeout(this.terminalDataTimer)
      this.terminalDataTimer = null
    }
    if (this.terminalDataQueue.length === 0) return
    const events = this.terminalDataQueue
    this.terminalDataQueue = []
    const window = this.getWindow()
    if (!window) return
    for (const event of events) {
      window.webContents.send('terminal:data', event)
    }
  }

  private resolveRequestTarget(
    target: ExecutionTargetDescriptor | undefined
  ): ResolvedExecutionTarget | Promise<ResolvedExecutionTarget> {
    if (target) {
      if (this.shellResolver.resolveTarget) return this.shellResolver.resolveTarget(target)
      const shell = this.shellResolver.resolveEffectiveShell()
      if (shell.id !== target.id) throw new Error(t('errors:shell.mustBeDetected'))
      return shell
    }
    return this.shellResolver.resolveEffectiveTarget
      ? this.shellResolver.resolveEffectiveTarget()
      : this.shellResolver.resolveEffectiveShell()
  }

  private isPendingCancelled(
    launches: Map<string, PendingLaunch>,
    id: string
  ): boolean {
    return launches.get(id)?.cancelled === true
  }

  private finishPendingLaunch(
    launches: Map<string, PendingLaunch>,
    pending: PendingLaunch | undefined
  ): void {
    if (!pending) return
    if (launches.get(pending.id) === pending) launches.delete(pending.id)
    pending.complete()
  }

  private async cancelPendingLaunch(pending: PendingLaunch): Promise<boolean> {
    pending.cancelled = true
    await pending.completion
    return true
  }

}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as Promise<T>)?.then === 'function'
}

function createPendingLaunch(id: string, taskId: string): PendingLaunch {
  let settled = false
  let resolveCompletion: () => void = () => undefined
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve
  })
  return {
    id,
    taskId,
    cancelled: false,
    completion,
    complete: () => {
      if (settled) return
      settled = true
      resolveCompletion()
    }
  }
}

function executionTargetMetadata(target: ExecutionTargetDescriptor | ResolvedExecutionTarget) {
  return {
    kind: 'native' as const,
    displayName: target.displayName
  }
}

const INTERNAL_BINDING_PATTERN = /^CLILOOM_INTERNAL_VALUE_\d+$/
const LEGACY_BINDING_REFERENCE = /\$\{(CLILOOM_INTERNAL_VALUE_\d+)\}/g

function normalizeRunRequest(request: RunProcessRequest): NormalizedRunRequest {
  const normalized = normalizeCommandAndEnvironment(request.command, request.env)
  return { ...request, command: normalized.command, env: normalized.env }
}

function normalizeCommandAndEnvironment(
  commandValue: string | ShellNeutralCommand,
  environment: Record<string, string> | undefined
): { command: ShellNeutralCommand; env?: Record<string, string> } {
  if (typeof commandValue === 'string') return decodeLegacyCommand(commandValue, environment)
  const command = parseShellNeutralCommand(commandValue)
  if (!command) throw new Error(t('errors:session.neutralCommandInvalid'))
  const env = environment ? { ...environment } : undefined
  return { command, env }
}

export function decodeLegacyCommand(
  command: string,
  environment: Record<string, string> | undefined
): { command: ShellNeutralCommand; env?: Record<string, string> } {
  if (command.includes('\0')) throw new Error(t('errors:session.commandContainsNul'))
  const sourceEnvironment = environment ? { ...environment } : {}
  const internalNames = Object.keys(sourceEnvironment).filter((name) => INTERNAL_BINDING_PATTERN.test(name))
  if (internalNames.length === 0) {
    LEGACY_BINDING_REFERENCE.lastIndex = 0
    const hasLegacyReference = LEGACY_BINDING_REFERENCE.test(command)
    LEGACY_BINDING_REFERENCE.lastIndex = 0
    if (hasLegacyReference) {
      throw new TerminalRetryError(t('errors:session.retryBindingMissing'))
    }
    return {
      command: literalCommand(command),
      env: Object.keys(sourceEnvironment).length > 0 ? sourceEnvironment : undefined
    }
  }

  const bindings: Record<string, string> = {}
  const referencedNames = new Set<string>()
  const segments: ShellNeutralCommand['segments'] = []
  let literalStart = 0
  LEGACY_BINDING_REFERENCE.lastIndex = 0
  for (let match = LEGACY_BINDING_REFERENCE.exec(command); match; match = LEGACY_BINDING_REFERENCE.exec(command)) {
    const name = match[1]
    if (!Object.hasOwn(sourceEnvironment, name)) {
      throw new TerminalRetryError(t('errors:session.retryBindingIncomplete'))
    }
    if (match.index > literalStart) {
      segments.push({ type: 'literal', value: command.slice(literalStart, match.index) })
    }
    segments.push({ type: 'binding', name })
    bindings[name] = sourceEnvironment[name]
    referencedNames.add(name)
    literalStart = match.index + match[0].length
  }
  if (literalStart < command.length || segments.length === 0) {
    segments.push({ type: 'literal', value: command.slice(literalStart) })
  }
  if (internalNames.some((name) => !referencedNames.has(name))) {
    throw new TerminalRetryError(t('errors:session.retryBindingUnmatched'))
  }
  for (const name of internalNames) delete sourceEnvironment[name]
  return {
    command: { version: 1, segments, bindings },
    env: Object.keys(sourceEnvironment).length > 0 ? sourceEnvironment : undefined
  }
}

function literalCommand(command: string): ShellNeutralCommand {
  if (command.includes('\0')) throw new Error(t('errors:session.commandContainsNul'))
  return { version: 1, segments: [{ type: 'literal', value: command }], bindings: {} }
}

function neutralCommandSource(command: ShellNeutralCommand): string {
  return command.segments.map((segment) => (
    segment.type === 'literal' ? segment.value : `\${${segment.name}}`
  )).join('')
}

function getRequestDisplayCommand(request: NormalizedRunRequest): string {
  if (request.displayCommand !== undefined) return request.displayCommand
  return request.command.segments.map((segment) => (
    segment.type === 'literal' ? segment.value : request.command.bindings[segment.name]
  )).join('')
}

function parseStoredEnvironment(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TerminalRetryError(t('errors:session.retryEnvInvalid'))
  }
  const entries = Object.entries(value)
  if (!entries.every((entry): entry is [string, string] => typeof entry[1] === 'string')) {
    throw new TerminalRetryError(t('errors:session.retryEnvInvalid'))
  }
  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function parseStoredNumber(value: unknown): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TerminalRetryError(t('errors:session.retryParamsInvalid'))
  }
  return value
}

function resolveEnvironmentShell(environment: NodeJS.ProcessEnv): DetectedShell {
  const candidates = discoverShells({ environment })
  const shell = selectDefaultShell(candidates, process.platform, environment)
  if (shell) return shell
  throw new ShellUnavailableError(
    t('errors:shell.noneDetectedPlatform', { platform: process.platform }),
    null
  )
}

function formatShellError(
  stage: string,
  error: unknown,
  shell: ResolvedExecutionTarget | null
): string {
  const detail = error instanceof Error ? error.message : String(error)
  const shellDescription = shell
    ? `${shell.displayName} (${shell.executablePath}, ${shell.family})`
    : error instanceof ShellUnavailableError && error.shell
      ? `${error.shell.displayName} (${error.shell.executablePath}, ${error.shell.family})`
      : t('errors:shell.unparsed')
  return t('errors:shell.stageFailed', { platform: process.platform, shell: shellDescription, stage, detail })
}

function sanitizeDisplayCommand(value: string): string {
  return value.replaceAll('\0', '�')
}
