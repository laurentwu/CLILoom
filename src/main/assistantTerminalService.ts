import path from 'node:path'
import { randomUUID } from 'node:crypto'
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
  isWslExecutionTarget,
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
import {
  ensureWslAssistantLauncher,
  type AssistantWorkspace
} from './assistantWorkspace'
import { t } from './i18n'
import type { ShellService } from './shellService'
import { buildNonInteractiveInvocation, buildShellEnvironment } from './shellExecution'
import { terminateProcessTree, type ProcessTerminationResult } from './processTermination'
import { prepareExecutionInvocation } from './executionInvocation'
import type { WslSessionHandle } from './wslService'

export class AssistantTerminalService {
  private terminal: IPty | null = null
  private bridge: AssistantBridgeSession | null = null
  private cleanupTerminal: IPty | null = null
  private cleanupBridge: AssistantBridgeSession | null = null
  private wslSession: WslSessionHandle | null = null
  private cleanupWslSession: WslSessionHandle | null = null
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
    const target = await this.resolveEffectiveTarget()
    return isWslExecutionTarget(target)
      ? this.options.shellService.resolveAssistantCommand(target, command)
      : resolveAssistantCommand(command, this.options.environment)
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
    let wslSession: WslSessionHandle | undefined
    let stage = t('errors:assistantTerminal.stageParse')

    try {
      stage = t('errors:assistantTerminal.stageDetect')
      shell = await this.resolveEffectiveTarget()
      const resolved = isWslExecutionTarget(shell)
        ? await this.options.shellService.resolveAssistantCommand(shell, command)
        : resolveAssistantCommand(command, this.options.environment)
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
      stage = t('errors:assistantTerminal.stageParse')
      let invocation: {
        executable: string
        args: string[]
        cwd: string
        env: Record<string, string>
      }
      if (isWslExecutionTarget(shell)) {
        const linuxWorkspace = await this.options.shellService.resolveTargetPath(shell, this.options.workspace.rootPath)
        const hostWslBin = this.options.workspace.wslBinPath
        if (!hostWslBin) throw new Error(t('errors:assistantWorkspace.unsafeLauncherPath'))
        const linuxBin = await this.options.shellService.resolveTargetPath(shell, hostWslBin)
        const hostLauncherArguments = this.options.workspace.hostLauncherArguments
        if (!hostLauncherArguments?.length) throw new Error(t('errors:assistantWorkspace.unsafeLauncherPath'))
        const linuxExecutable = await this.options.shellService.resolveTargetPath(
          shell,
          hostLauncherArguments[0]
        )
        // The shim command itself is launched by Linux and therefore needs a
        // WSL path. Its remaining arguments, including the GUI Electron path
        // behind the Console launcher, are consumed by Windows processes and
        // must retain Win32 path semantics.
        const linuxLauncherArguments = [linuxExecutable, ...hostLauncherArguments.slice(1)]
        const hostWslLauncher = ensureWslAssistantLauncher(
          this.options.workspace,
          linuxLauncherArguments
        )
        const linuxWslLauncher = await this.options.shellService.resolveTargetPath(shell, hostWslLauncher)
        await this.options.shellService.makeWslExecutable(shell, linuxWslLauncher)
        await this.options.shellService.validateWslAssistantInterop(
          shell,
          linuxWslLauncher,
          requestEnvironment
        )
        const bootstrap = buildAssistantBootstrapCommand(
          'posix',
          resolved.executablePath,
          resolved.args,
          linuxBin
        )
        const prepared = prepareExecutionInvocation({
          target: shell,
          mode: 'assistant',
          command: bootstrap,
          targetCwd: linuxWorkspace,
          hostCwd: this.options.workspace.rootPath,
          sessionId: randomUUID(),
          baseEnvironment: this.options.environment,
          requestEnvironment,
          allowInternalEnvironment: true,
          platform: this.options.platform
        })
        wslSession = prepared.wslSession
        invocation = {
          executable: prepared.executable,
          args: prepared.args,
          cwd: prepared.hostCwd,
          env: prepared.env
        }
      } else {
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
        const env = buildShellEnvironment({
          base: this.options.environment,
          overlay: {
            PATH: prependPath(
              this.options.workspace.binPath,
              this.options.environment.PATH ?? this.options.environment.Path ?? ''
            ),
            ...requestEnvironment
          },
          family: shell.family
        })
        invocation = {
          ...nativeInvocation,
          cwd: this.options.workspace.rootPath,
          env
        }
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
      this.wslSession = wslSession ?? null
      terminal.onData((content) => {
        if (generation !== this.generation || terminal !== this.terminal) return
        this.emitSanitized(this.redactor?.push(content) ?? content)
      })
      terminal.onExit(({ exitCode, signal }) => {
        void this.enqueue(() => this.performNaturalExit(
          generation,
          terminal,
          wslSession,
          exitCode,
          signal
        ))
      })
      this.setStatus({ state: 'running', pid: terminal.pid })
      return resolved
    } catch (error) {
      await Promise.allSettled([
        ...(startedTerminal ? [this.terminateTerminal(startedTerminal, wslSession)] : []),
        ...(bridge ? [bridge.close()] : [])
      ])
      this.bridge = null
      this.redactor = null
      this.terminal = null
      this.wslSession = null
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
    const wslSession = this.wslSession ?? this.cleanupWslSession ?? undefined
    this.bridge = null
    this.terminal = null
    this.wslSession = null
    this.cleanupBridge = null
    this.cleanupTerminal = null
    this.cleanupWslSession = null
    this.redactor = null
    const [bridgeResult, terminalResult] = await Promise.allSettled([
      bridge?.close(),
      terminal ? this.terminateTerminal(terminal, wslSession) : undefined
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
        this.cleanupWslSession = wslSession ?? null
        failures.push(terminalResult.reason instanceof Error
          ? terminalResult.reason.message
          : String(terminalResult.reason))
      } else if (terminalResult.value && !terminalResult.value.terminated) {
        this.cleanupTerminal = terminal
        this.cleanupWslSession = wslSession ?? null
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
    wslSession: WslSessionHandle | undefined,
    exitCode: number,
    signal?: number
  ): Promise<void> {
    if (generation !== this.generation || terminal !== this.terminal) return
    this.emitSanitized(this.redactor?.flush() ?? '')
    const activeBridge = this.bridge
    this.terminal = null
    this.wslSession = null
    this.bridge = null
    this.redactor = null

    const [linuxResult, bridgeResult] = await Promise.allSettled([
      wslSession
        ? this.finalizeWslTerminal(wslSession)
        : Promise.resolve<ProcessTerminationResult>({ terminated: true }),
      activeBridge?.close()
    ])
    const failures: string[] = []
    if (linuxResult.status === 'rejected') {
      this.cleanupTerminal = terminal
      this.cleanupWslSession = wslSession ?? null
      failures.push(linuxResult.reason instanceof Error
        ? linuxResult.reason.message
        : String(linuxResult.reason))
    } else if (!linuxResult.value.terminated) {
      this.cleanupTerminal = terminal
      this.cleanupWslSession = wslSession ?? null
      failures.push(linuxResult.value.error ?? t('errors:assistantTerminal.treeNotTerminated'))
    }
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
      ? isWslExecutionTarget(configuredShell)
        ? `${configuredShell.displayName} (${configuredShell.distributionName}, ${configuredShell.family})`
        : `${configuredShell.displayName} (${configuredShell.executablePath}, ${configuredShell.family})`
      : t('errors:assistantTerminal.autoRecommendedUnparsed')
    const detail = error instanceof Error ? error.message : String(error)
    return t('errors:assistantTerminal.stageFailed', { platform: process.platform, shell: shellDescription, stage, detail })
  }

  private async terminateTerminal(
    terminal: IPty,
    wslSession: WslSessionHandle | undefined
  ): Promise<ProcessTerminationResult> {
    if (wslSession) {
      const linux = await this.options.shellService.terminateWslSession(wslSession)
      if (!linux.terminated) return linux
    }
    return terminateProcessTree(terminal)
  }

  private finalizeWslTerminal(handle: WslSessionHandle): Promise<ProcessTerminationResult> {
    const service = this.options.shellService as ShellService & {
      finalizeWslSession?: (session: WslSessionHandle) => Promise<ProcessTerminationResult>
    }
    return service.finalizeWslSession
      ? service.finalizeWslSession(handle)
      : service.terminateWslSession(handle)
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

function prependPath(directory: string, currentPath: string): string {
  return `${directory}${path.delimiter}${currentPath}`
}

function clampDimension(value: number): number {
  return Number.isInteger(value) ? Math.min(500, Math.max(1, value)) : 80
}
