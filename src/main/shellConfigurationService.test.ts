import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SHELL_PREFERENCES, type ShellSnapshot } from '../shared/shell'
import {
  ShellConfigurationService,
  ShellSelectionAppliedButUnavailableError
} from './shellConfigurationService'

const bash = {
  id: 'posix:%2Fbin%2Fbash',
  displayName: 'bash',
  family: 'posix' as const,
  executablePath: '/bin/bash',
  source: 'system' as const
}

function createSnapshot(): ShellSnapshot {
  return {
    platform: 'linux',
    preferences: DEFAULT_SHELL_PREFERENCES,
    candidates: [bash],
    effectiveShell: bash
  }
}

type Calls = string[]

function createFixture(options?: {
  selectImpl?: (value: unknown) => ShellSnapshot
  refreshRuntimeEnvironment?: () => Promise<unknown>
}) {
  const calls: Calls = []
  const snapshot = createSnapshot()
  const shellService = {
    list: vi.fn((): ShellSnapshot => snapshot),
    getSnapshot: vi.fn((): ShellSnapshot => snapshot),
    refresh: vi.fn(async (): Promise<ShellSnapshot> => {
      calls.push('shell.refresh')
      return snapshot
    }),
    select: vi.fn((value: unknown): ShellSnapshot => {
      calls.push('shell.select')
      if (options?.selectImpl) return options.selectImpl(value)
      return snapshot
    }),
    resolveEffectiveTarget: vi.fn(async (): Promise<typeof bash> => {
      calls.push('shell.resolveEffectiveTarget')
      return bash
    })
  }
  const refreshRuntimeEnvironment = vi.fn(options?.refreshRuntimeEnvironment ?? (async () => {
    calls.push('refreshRuntimeEnvironment')
    return snapshot
  }))
  const service = new ShellConfigurationService({
    shellService: shellService as never,
    refreshRuntimeEnvironment
  })
  return { service, shellService, refreshRuntimeEnvironment, calls, snapshot }
}

describe('ShellConfigurationService', () => {
  it('lists without refreshing the environment', () => {
    const { service, refreshRuntimeEnvironment, snapshot } = createFixture()
    expect(service.list()).toBe(snapshot)
    expect(refreshRuntimeEnvironment).not.toHaveBeenCalled()
  })

  it('refresh runs the full runtime environment chain and returns the snapshot', async () => {
    const { service, refreshRuntimeEnvironment, snapshot } = createFixture()
    const result = await service.refresh()
    expect(result).toBe(snapshot)
    expect(refreshRuntimeEnvironment).toHaveBeenCalledOnce()
  })

  it('select refreshes candidates, saves, rebuilds the environment, and verifies the target', async () => {
    const { service, shellService, refreshRuntimeEnvironment, calls } = createFixture()
    const result = await service.select(bash.id)
    expect(result.preferences).toEqual(DEFAULT_SHELL_PREFERENCES)
    expect(shellService.select).toHaveBeenCalledWith(bash.id)
    expect(refreshRuntimeEnvironment).toHaveBeenCalledOnce()
    expect(calls).toEqual([
      'shell.refresh',
      'shell.select',
      'refreshRuntimeEnvironment',
      'shell.resolveEffectiveTarget'
    ])
  })

  it('rejects values the shell service refuses before saving', async () => {
    const { service, refreshRuntimeEnvironment, calls } = createFixture({
      selectImpl: () => {
        throw new Error('Only currently detected and supported shells can be selected')
      }
    })
    await expect(service.select('posix:%2Fbin%2Fmade-up')).rejects.toThrow(/detected/i)
    expect(refreshRuntimeEnvironment).not.toHaveBeenCalled()
    expect(calls).toEqual(['shell.refresh', 'shell.select'])
  })

  it('reports saved-but-unavailable selections with a stable code and exit status', async () => {
    const { service } = createFixture({
      refreshRuntimeEnvironment: async () => {
        throw new Error('PATH rebuild failed')
      }
    })
    const error = await service.select(bash.id).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ShellSelectionAppliedButUnavailableError)
    expect((error as ShellSelectionAppliedButUnavailableError).code)
      .toBe('SHELL_SELECTION_APPLIED_BUT_UNAVAILABLE')
    expect((error as ShellSelectionAppliedButUnavailableError).exitCode).toBe(2)
    expect((error as ShellSelectionAppliedButUnavailableError).message).toContain('shell list')
  })

  it('serializes mutating operations and never lets a failure block later ones', async () => {
    const order: string[] = []
    const snapshot = createSnapshot()
    let firstSelect = true
    const shellService = {
      getSnapshot: () => snapshot,
      refresh: async () => snapshot,
      select: (value: unknown) => {
        order.push(`select:${String(value)}`)
        if (firstSelect) {
          firstSelect = false
          throw new Error('rejected before save')
        }
        return snapshot
      },
      resolveEffectiveTarget: async () => bash
    }
    const refreshRuntimeEnvironment = vi.fn(async () => {
      order.push('refresh-env')
      return snapshot
    })
    const service = new ShellConfigurationService({ shellService, refreshRuntimeEnvironment })

    const first = service.select('bad-id')
    const second = service.select('good-id')
    const refresh = service.refresh()
    await expect(first).rejects.toThrow(/rejected before save/)
    await expect(second).resolves.toBe(snapshot)
    await expect(refresh).resolves.toBe(snapshot)
    expect(order).toEqual([
      'select:bad-id',
      'select:good-id',
      'refresh-env',
      'refresh-env'
    ])
  })

  it('queues concurrent select operations in submission order', async () => {
    const snapshot = createSnapshot()
    const order: string[] = []
    const shellService = {
      getSnapshot: () => snapshot,
      refresh: async () => snapshot,
      select: (value: unknown) => {
        order.push(`select:${String(value)}`)
        return snapshot
      },
      resolveEffectiveTarget: async () => {
        order.push('verify')
        return bash
      }
    }
    const refreshRuntimeEnvironment = async (): Promise<unknown> => {
      order.push('refresh-env')
      await Promise.resolve()
      return snapshot
    }
    const service = new ShellConfigurationService({ shellService, refreshRuntimeEnvironment })
    await Promise.all([service.select('a'), service.select('b')])
    expect(order).toEqual([
      'select:a', 'refresh-env', 'verify',
      'select:b', 'refresh-env', 'verify'
    ])
  })
})
