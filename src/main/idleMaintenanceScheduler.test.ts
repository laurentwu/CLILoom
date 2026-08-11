import { afterEach, describe, expect, it, vi } from 'vitest'
import { IdleMaintenanceScheduler } from './idleMaintenanceScheduler'

afterEach(() => {
  vi.useRealTimers()
})

describe('IdleMaintenanceScheduler', () => {
  it('automatically retries after a transient maintenance failure', async () => {
    vi.useFakeTimers()
    const error = new Error('temporary failure')
    const run = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(true)
    const onError = vi.fn()
    const scheduler = new IdleMaintenanceScheduler({
      idleDelayMs: 5_000,
      retryDelayMs: 30_000,
      isIdle: () => true,
      run,
      onError
    })

    scheduler.request()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(error)

    await vi.advanceTimersByTimeAsync(29_999)
    expect(run).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('defers requested work until the application becomes idle', async () => {
    vi.useFakeTimers()
    let idle = false
    const run = vi.fn().mockResolvedValue(true)
    const scheduler = new IdleMaintenanceScheduler({
      idleDelayMs: 5_000,
      retryDelayMs: 30_000,
      isIdle: () => idle,
      run,
      onError: vi.fn()
    })

    scheduler.request()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run).not.toHaveBeenCalled()

    idle = true
    await vi.advanceTimersByTimeAsync(30_000)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
