import path from 'node:path'
import { spawn as ptySpawn, type IPty } from 'node-pty'
import {
  ASSISTANT_BRIDGE_PORT_ENV,
  ASSISTANT_BRIDGE_TOKEN_ENV,
  MAX_ASSISTANT_TRANSCRIPT_CHARS,
  StreamingSecretRedactor,
  buildAssistantBootstrapCommand,
  type AssistantTerminalStatus,
  type ResolvedAssistantCommand
} from '../shared/assistant'
import {
  type ExecutionTargetDescriptor,
  type ResolvedExecutionTarget
} from '../shared/shell'
import { tailText } from '../shared/terminalBuffer'
import { resolveAssistantCommand } from './assistantCommand'
import {
  startAssistantCommandBridge,
  type AssistantBridgeSession
} from './assistantCommandBridge'
import type { AssistantCommandHandler } from './assistantCommandHandler'
import type { AssistantWorkspace } from './assistantWorkspace'
import { t } from './i18n'
import type { ShellService } from './shellService'
import { buildNonInteractiveInvocation, buildShellEnvironment } from './shellExecution'
import { terminateProcessTree, type ProcessTerminationResult } from './processTermination'

export class AssistantTerminalService {
  private terminal: IPty | null = null
  private bridge: AssistantBridgeSession | null = null
  private cleanupTerminal: IPty | null = null
  private cleanupBridge: AssistantBridgeSession | null = null
  private redactor: StreamingSecretRedactor | null = null
  private transcript = ''
  private status: AssistantTerminalStatus = { state: 'idle' }
  private generation = 0
  private lifecycle: Promise<void> = Promise.resolve()
  private readonly dataListeners = new Set<(content: string) => void>()
  private readonly statusListeners = new Set<(status: AssistantTerminalStatus) => void>()

  constructor(private readonly options: {
    workspace: AssistantWorkspace
    environment: NodeJS.ProcessEnv
    commandHandler: AssistantCommandHandler
    shellService: ShellService
    platform?: NodeJS.Platform
  }) {}

  async start(command: unknown, cols = 100, rows = 30): Promise<ResolvedAssistantCommand> {
    return this.enqueue(() => this.performStart(command, cols, rows))
  }

  async validate(command: unknown): Promise<ResolvedAssistantCommand> {
    await this.resolveEffectiveTarget()
    return resolveAssistantCommand(command, this.options.environment)
  }

  setEnvironment(environment: NodeJS.ProcessEnv): void {
    this.options.environment = environment
  }

  private async performStart(
    command: unknown,
    cols: number,
    rows: number
  ): Promise<ResolvedAssistantCommand> {
    await this.performClose()
    this.setStatus({ state: 'starting' })
    const generation = ++this.generation
    let bridge: AssistantBridgeSession | null = null
    let startedTerminal: IPty | null = null
    let shell: ResolvedExecutionTarget | null = null
    let stage = t('errors:assistantTerminal.stageParse')

    try {
      stage = t('errors:assistantTerminal.stageSync')
      this.options.workspace.synchronize()
      stage = t('errors:assistantTerminal.stageDetect')
      shell = await this.resolveEffectiveTarget()
      const resolved = resolveAssistantCommand(command, this.options.environment)
      stage = t('errors:assistantTerminal.stageStart')
      bridge = await startAssistantCommandBridge(this.options.commandHandler)
      if (generation !== this.generation) {
        await bridge.close()
        throw new Error(t('errors:assistantTerminal.startCancelled'))
      }
      this.bridge = bridge
      this.redactor = new StreamingSecretRedactor(bridge.token)
      const requestEnvironment = {
        [ASSISTANT_BRIDGE_PORT_ENV]: String(bridge.port),
        [ASSISTANT_BRIDGE_TOKEN_ENV]: bridge.token
      }
      const platform = this.options.platform ?? process.platform
      stage = t('errors:assistantTerminal.stageParse')
      const bootstrap = buildAssistantBootstrapCommand(
        shell.family,
        resolved.executablePath,
        resolved.args,
        this.options.workspace.binPath
      )
      const nativeInvocation = shell.family === 'posix'
        ? { executable: shell.executablePath, args: ['-ilc', bootstrap] }
        : shell.family === 'cmd'
          ? { executable: shell.executablePath, args: ['/d', '/v:off', '/s', '/c', bootstrap] }
          : buildNonInteractiveInvocation(shell, bootstrap)
      const invocation = {
        ...nativeInvocation,
        cwd: this.options.workspace.rootPath,
        env: buildShellEnvironment({
          base: this.options.environment,
          overlay: {
            PATH: prependPath(
              this.options.workspace.binPath,
              this.options.environment.PATH ?? this.options.environment.Path ?? '',
              platform
            ),
            ...requestEnvironment
          },
          family: shell.family,
          platform
        })
      }

      stage = t('errors:assistantTerminal.stageStart')
      const terminal = ptySpawn(invocation.executable, invocation.args, {
        name: 'xterm-256color',
        cols: clampDimension(cols),
        rows: clampDimension(rows),
        cwd: invocation.cwd,
        env: invocation.env
      })
      startedTerminal = terminal
      this.terminal = terminal
      terminal.onData((content) => {
        if (generation !== this.generation || terminal !== this.terminal) return
        this.emitSanitized(this.redactor?.push(content) ?? content)
      })
      terminal.onExit(({ exitCode, signal }) => {
        void this.enqueue(() => this.performNaturalExit(
          generation,
          terminal,
          exitCode,
          signal
        ))
      })
      this.setStatus({ state: 'running', pid: terminal.pid })
      return resolved
    } catch (error) {
      await Promise.allSettled([
        ...(startedTerminal ? [this.terminateTerminal(startedTerminal)] : []),
        ...(bridge ? [bridge.close()] : [])
      ])
      this.bridge = null
      this.redactor = null
      this.terminal = null
      const message = this.formatStartError(stage, error, shell)
      this.setStatus({ state: 'failed', message })
      throw new Error(message, { cause: error })
    }
  }

  async restart(command: unknown, cols = 100, rows = 30): Promise<ResolvedAssistantCommand> {
    return this.start(command, cols, rows)
  }

  write(input: unknown): boolean {
    if (!this.terminal || typeof input !== 'string' || input.length > 100_000 || input.includes('\0')) {
      return false
    }
    this.terminal.write(input)
    return true
  }

  resize(cols: unknown, rows: unknown): boolean {
    if (!this.terminal || !Number.isInteger(cols) || !Number.isInteger(rows)) return false
    const width = cols as number
    const height = rows as number
    if (width < 1 || width > 500 || height < 1 || height > 500) return false
    this.terminal.resize(width, height)
    return true
  }

  getStatus(): AssistantTerminalStatus {
    return this.status
  }

  getTranscript(): string {
    return this.transcript
  }

  onData(listener: (content: string) => void): () => void {
    this.dataListeners.add(listener)
    return () => this.dataListeners.delete(listener)
  }

  onStatus(listener: (status: AssistantTerminalStatus) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  close(): Promise<void> {
    return this.enqueue(() => this.performClose())
  }

  private async performClose(): Promise<void> {
    this.generation += 1
    const bridge = this.bridge ?? this.cleanupBridge
    const terminal = this.terminal ?? this.cleanupTerminal
    this.bridge = null
    this.terminal = null
    this.cleanupBridge = null
    this.cleanupTerminal = null
    this.redactor = null
    const [bridgeResult, terminalResult] = await Promise.allSettled([
      bridge?.close(),
      terminal ? this.terminateTerminal(terminal) : undefined
    ])
    const failures: string[] = []
    if (bridge && bridgeResult.status === 'rejected') {
      this.cleanupBridge = bridge
      failures.push(bridgeResult.reason instanceof Error
        ? bridgeResult.reason.message
        : String(bridgeResult.reason))
    }
    if (terminal) {
      if (terminalResult.status === 'rejected') {
        this.cleanupTerminal = terminal
        failures.push(terminalResult.reason instanceof Error
          ? terminalResult.reason.message
          : String(terminalResult.reason))
      } else if (terminalResult.value && !terminalResult.value.terminated) {
        this.cleanupTerminal = terminal
        failures.push(terminalResult.value.error ?? t('errors:assistantTerminal.treeNotTerminated'))
      }
    }
    if (failures.length > 0) {
      const message = t('errors:assistantTerminal.cleanupFailed', { detail: failures.join('; ') })
      this.setStatus({ state: 'failed', message })
      throw new Error(message)
    }
    this.transcript = ''
    this.setStatus({ state: 'idle' })
  }

  private async performNaturalExit(
    generation: number,
    terminal: IPty,
    exitCode: number,
    signal?: number
  ): Promise<void> {
    if (generation !== this.generation || terminal !== this.terminal) return
    this.emitSanitized(this.redactor?.flush() ?? '')
    const activeBridge = this.bridge
    this.terminal = null
    this.bridge = null
    this.redactor = null

    const bridgeResult = await Promise.resolve(activeBridge?.close()).then(
      () => ({ status: 'fulfilled' as const }),
      (reason: unknown) => ({ status: 'rejected' as const, reason })
    )
    const failures: string[] = []
    if (activeBridge && bridgeResult.status === 'rejected') {
      this.cleanupBridge = activeBridge
      failures.push(bridgeResult.reason instanceof Error
        ? bridgeResult.reason.message
        : String(bridgeResult.reason))
    }
    if (failures.length > 0) {
      this.setStatus({
        state: 'failed',
        message: t('errors:assistantTerminal.cleanupFailed', { detail: failures.join('; ') })
      })
      return
    }
    this.setStatus({ state: 'exited', exitCode, ...(signal ? { signal } : {}) })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.lifecycle.then(operation, operation)
    this.lifecycle = queued.then(() => undefined, () => undefined)
    return queued
  }

  private emitSanitized(content: string): void {
    if (!content) return
    this.transcript = tailText(this.transcript + content, MAX_ASSISTANT_TRANSCRIPT_CHARS)
    for (const listener of this.dataListeners) listener(content)
  }

  private setStatus(status: AssistantTerminalStatus): void {
    this.status = status
    for (const listener of this.statusListeners) listener(status)
  }

  private formatStartError(
    stage: string,
    error: unknown,
    activeShell: ResolvedExecutionTarget | null
  ): string {
    let configuredShell: ExecutionTargetDescriptor | ResolvedExecutionTarget | null = activeShell
    try {
      const snapshot = this.options.shellService.getSnapshot()
      if (!configuredShell && snapshot.preferences.selection.mode === 'explicit') {
        configuredShell = snapshot.preferences.selection.shell
      }
    } catch {
      // Keep the original launch error actionable even if snapshot generation fails.
    }
    const shellDescription = configuredShell
      ? `${configuredShell.displayName} (${configuredShell.executablePath}, ${configuredShell.family})`
      : t('errors:assistantTerminal.autoRecommendedUnparsed')
    const detail = error instanceof Error ? error.message : String(error)
    return t('errors:assistantTerminal.stageFailed', {
      platform: this.options.platform ?? process.platform,
      shell: shellDescription,
      stage,
      detail
    })
  }

  private async terminateTerminal(terminal: IPty): Promise<ProcessTerminationResult> {
    return terminateProcessTree(terminal)
  }

  private resolveEffectiveTarget(): Promise<ResolvedExecutionTarget> {
    const service = this.options.shellService as ShellService & {
      resolveEffectiveTarget?: () => Promise<ResolvedExecutionTarget>
    }
    return service.resolveEffectiveTarget
      ? service.resolveEffectiveTarget()
      : Promise.resolve(service.resolveEffectiveShell())
  }
}

function prependPath(
  directory: string,
  currentPath: string,
  platform: NodeJS.Platform
): string {
  const delimiter = platform === 'win32' ? path.win32.delimiter : path.posix.delimiter
  return `${directory}${delimiter}${currentPath}`
}

function clampDimension(value: number): number {
  return Number.isInteger(value) ? Math.min(500, Math.max(1, value)) : 80
}
