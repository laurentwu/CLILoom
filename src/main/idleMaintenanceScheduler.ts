export type IdleMaintenanceSchedulerOptions = {
  idleDelayMs: number
  retryDelayMs: number
  isIdle: () => boolean
  run: () => Promise<boolean>
  onError: (error: unknown) => void
}

export class IdleMaintenanceScheduler {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private requested = false
  private stopped = false

  constructor(private readonly options: IdleMaintenanceSchedulerOptions) {}

  request(delayMs = this.options.idleDelayMs): void {
    if (this.stopped) return
    this.requested = true
    if (this.timer || this.running) return

    this.timer = setTimeout(() => {
      this.timer = null
      void this.runScheduled()
    }, delayMs)
  }

  stop(): void {
    this.stopped = true
    this.requested = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private async runScheduled(): Promise<void> {
    if (this.stopped) return
    if (!this.options.isIdle()) {
      this.requested = false
      this.request(this.options.retryDelayMs)
      return
    }

    this.running = true
    this.requested = false
    try {
      const completed = await this.options.run()
      if (!completed || !this.options.isIdle()) this.requested = true
    } catch (error) {
      this.options.onError(error)
      this.requested = true
    } finally {
      this.running = false
      if (this.requested) {
        this.requested = false
        this.request(this.options.retryDelayMs)
      }
    }
  }
}
