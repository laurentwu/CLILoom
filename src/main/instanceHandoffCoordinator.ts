import type { ApplicationBuildIdentity } from './buildIdentity'
import {
  classifyInstanceLaunch,
  type DesktopInstanceLaunchData
} from './instanceHandoff'

export type InstanceHandoffCoordinatorOptions = {
  getCurrentIdentity: () => ApplicationBuildIdentity | null
  focusCurrent: () => void
  confirmSwitch: (
    current: ApplicationBuildIdentity,
    incoming: DesktopInstanceLaunchData
  ) => Promise<boolean>
  showUnavailable: (incoming: DesktopInstanceLaunchData) => Promise<void>
  resolveExecutablePath: (candidate: string) => string | null
  cleanupCurrent: () => Promise<void>
  onCleanupFailed: (error: unknown) => void
  releaseSingleInstanceLock: () => void
  launchReplacement: (executablePath: string) => Promise<void>
  onLaunchFailed: (error: unknown) => void
  quitCurrent: () => void
  onUnexpectedError: (error: unknown) => void
}

export class InstanceHandoffCoordinator {
  private initialized = false
  private handoffInProgress = false
  private handling: Promise<void> = Promise.resolve()
  private readonly pending: unknown[] = []

  constructor(private readonly options: InstanceHandoffCoordinatorOptions) {}

  enqueue(additionalData: unknown): void {
    if (!this.initialized) {
      this.pending.push(additionalData)
      return
    }
    this.schedule(additionalData)
  }

  markInitialized(): void {
    if (this.initialized) return
    this.initialized = true
    for (const additionalData of this.pending.splice(0)) {
      this.schedule(additionalData)
    }
  }

  waitForIdle(): Promise<void> {
    return this.handling
  }

  private schedule(additionalData: unknown): void {
    this.handling = this.handling
      .then(() => this.handle(additionalData))
      .catch((error) => {
        this.options.onUnexpectedError(error)
        this.options.focusCurrent()
      })
  }

  private async handle(additionalData: unknown): Promise<void> {
    if (this.handoffInProgress) return
    const currentIdentity = this.options.getCurrentIdentity()
    if (!currentIdentity) {
      this.options.focusCurrent()
      return
    }
    const launch = classifyInstanceLaunch(currentIdentity.buildId, additionalData)
    if (launch.action === 'focus') {
      this.options.focusCurrent()
      return
    }

    this.options.focusCurrent()
    if (launch.action === 'handoff-unavailable') {
      await this.options.showUnavailable(launch.incoming)
      return
    }
    if (!await this.options.confirmSwitch(currentIdentity, launch.incoming)) {
      this.options.focusCurrent()
      return
    }

    const replacementExecutablePath = this.options.resolveExecutablePath(launch.executablePath)
    if (!replacementExecutablePath) {
      await this.options.showUnavailable(launch.incoming)
      return
    }

    this.handoffInProgress = true
    try {
      await this.options.cleanupCurrent()
    } catch (error) {
      this.handoffInProgress = false
      this.options.onCleanupFailed(error)
      this.options.focusCurrent()
      return
    }

    this.options.releaseSingleInstanceLock()
    try {
      await this.options.launchReplacement(replacementExecutablePath)
    } catch (error) {
      this.options.onLaunchFailed(error)
    }
    this.options.quitCurrent()
  }
}
