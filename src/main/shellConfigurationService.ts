import type { ShellSnapshot } from '../shared/shell'
import { t } from './i18n'

type CoordinatedShellService = {
  getSnapshot: () => ShellSnapshot
  refresh: () => Promise<ShellSnapshot>
  select: (value: unknown) => ShellSnapshot
  resolveEffectiveTarget: () => Promise<unknown>
}

export type ShellConfigurationShellService = {
  list: () => ShellSnapshot
  refresh: () => Promise<ShellSnapshot>
  select: (value: unknown) => Promise<ShellSnapshot>
}
export class ShellSelectionAppliedButUnavailableError extends Error {
  readonly code = 'SHELL_SELECTION_APPLIED_BUT_UNAVAILABLE'
  readonly exitCode = 2

  constructor(cause: unknown) {
    super(t('errors:shell.selectionAppliedButUnavailable'))
    this.name = 'ShellSelectionAppliedButUnavailableError'
    this.cause = cause
  }
}

export class ShellConfigurationService {
  private queue: Promise<void> = Promise.resolve()

  constructor(private readonly options: {
    shellService: CoordinatedShellService
    refreshRuntimeEnvironment: () => Promise<unknown>
  }) {}

  list(): ShellSnapshot {
    return this.options.shellService.getSnapshot()
  }

  refresh(): Promise<ShellSnapshot> {
    return this.enqueue(async () => {
      await this.options.refreshRuntimeEnvironment()
      return this.options.shellService.getSnapshot()
    })
  }

  select(value: unknown): Promise<ShellSnapshot> {
    return this.enqueue(async () => {
      await this.options.shellService.refresh()
      this.options.shellService.select(value)
      try {
        await this.options.refreshRuntimeEnvironment()
        await this.options.shellService.resolveEffectiveTarget()
      } catch (error) {
        throw new ShellSelectionAppliedButUnavailableError(error)
      }
      return this.options.shellService.getSnapshot()
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation)
    this.queue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }
}
