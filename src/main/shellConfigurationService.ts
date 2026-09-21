import type { ShellSnapshot } from '../shared/shell'
import { t } from './i18n'

/**
 * Coordinates shell refresh and selection between the settings UI IPC and the
 * assistant command bridge. Mutating operations run through the same promise
 * queue so UI- and assistant-initiated changes cannot interleave; read-only
 * listings are never queued. A failure never blocks later operations.
 */
/** Shell service surface required by the coordination service itself. */
type CoordinatedShellService = {
  getSnapshot: () => ShellSnapshot
  refresh: () => Promise<ShellSnapshot>
  select: (value: unknown) => ShellSnapshot
  resolveEffectiveTarget: () => Promise<unknown>
}

/** Handler-facing surface implemented by {@link ShellConfigurationService}. */
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
    /** Runs the full runtime environment refresh chain used by the UI. */
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
      // Refresh candidates first so validation runs against the latest
      // detection, then save. ShellService.select rejects invalid values
      // before writing any preference.
      await this.options.shellService.refresh()
      this.options.shellService.select(value)
      try {
        await this.options.refreshRuntimeEnvironment()
        await this.options.shellService.resolveEffectiveTarget()
      } catch (error) {
        // The selection is already persisted; report the post-save failure
        // without pretending the previous selection was restored.
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
