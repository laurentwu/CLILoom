import { describe, expect, it, vi } from 'vitest'
import type { ApplicationBuildIdentity } from './buildIdentity'
import {
  InstanceHandoffCoordinator,
  type InstanceHandoffCoordinatorOptions
} from './instanceHandoffCoordinator'

const currentBuildId = `sha256:${'a'.repeat(64)}`
const incomingBuildId = `sha256:${'b'.repeat(64)}`
const thirdBuildId = `sha256:${'c'.repeat(64)}`

const currentIdentity: ApplicationBuildIdentity = {
  version: 1,
  appVersion: '0.1.0',
  sourceHash: 'd'.repeat(64),
  buildId: currentBuildId,
  platform: 'win32',
  architecture: 'x64'
}

function createLaunchData(buildId: string, portableExecutablePath: string | null) {
  return {
    kind: 'cliloom-desktop-instance',
    protocolVersion: 1,
    appVersion: '0.1.0',
    buildId,
    platform: 'win32',
    architecture: 'x64',
    portableExecutablePath
  }
}

function createOptions(
  overrides: Partial<InstanceHandoffCoordinatorOptions> = {}
): InstanceHandoffCoordinatorOptions {
  return {
    getCurrentIdentity: () => currentIdentity,
    focusCurrent: vi.fn(),
    confirmSwitch: vi.fn(async () => true),
    showUnavailable: vi.fn(async () => undefined),
    resolveExecutablePath: vi.fn((candidate) => candidate),
    cleanupCurrent: vi.fn(async () => undefined),
    onCleanupFailed: vi.fn(),
    releaseSingleInstanceLock: vi.fn(),
    launchReplacement: vi.fn(async () => undefined),
    onLaunchFailed: vi.fn(),
    quitCurrent: vi.fn(),
    onUnexpectedError: vi.fn(),
    ...overrides
  }
}

describe('InstanceHandoffCoordinator', () => {
  it('queues pre-initialization events and processes all events serially', async () => {
    let unblockFirst: (() => void) | undefined
    const firstBlocked = new Promise<void>((resolve) => {
      unblockFirst = resolve
    })
    const handledBuildIds: string[] = []
    const showUnavailable = vi.fn(async (incoming: { buildId: string }) => {
      handledBuildIds.push(incoming.buildId)
      if (incoming.buildId === incomingBuildId) await firstBlocked
    })
    const options = createOptions({ showUnavailable })
    const coordinator = new InstanceHandoffCoordinator(options)

    coordinator.enqueue(createLaunchData(incomingBuildId, null))
    coordinator.enqueue(createLaunchData(thirdBuildId, null))
    expect(showUnavailable).not.toHaveBeenCalled()

    coordinator.markInitialized()
    await vi.waitFor(() => expect(showUnavailable).toHaveBeenCalledTimes(1))
    coordinator.enqueue(createLaunchData(`sha256:${'e'.repeat(64)}`, null))
    expect(handledBuildIds).toEqual([incomingBuildId])

    unblockFirst?.()
    await coordinator.waitForIdle()

    expect(handledBuildIds).toEqual([
      incomingBuildId,
      thirdBuildId,
      `sha256:${'e'.repeat(64)}`
    ])
  })

  it('focuses the current build without prompting', async () => {
    const options = createOptions()
    const coordinator = new InstanceHandoffCoordinator(options)
    coordinator.markInitialized()

    coordinator.enqueue(createLaunchData(currentBuildId, 'C:\\CLILoom.exe'))
    await coordinator.waitForIdle()

    expect(options.focusCurrent).toHaveBeenCalledOnce()
    expect(options.confirmSwitch).not.toHaveBeenCalled()
    expect(options.cleanupCurrent).not.toHaveBeenCalled()
  })

  it('keeps the current build running when the user cancels', async () => {
    const timeline: string[] = []
    const options = createOptions({
      focusCurrent: vi.fn(() => timeline.push('focus')),
      confirmSwitch: vi.fn(async () => {
        timeline.push('confirm')
        return false
      })
    })
    const coordinator = new InstanceHandoffCoordinator(options)
    coordinator.markInitialized()

    coordinator.enqueue(createLaunchData(incomingBuildId, 'C:\\New CLILoom.exe'))
    await coordinator.waitForIdle()

    expect(timeline).toEqual(['focus', 'confirm', 'focus'])
    expect(options.cleanupCurrent).not.toHaveBeenCalled()
    expect(options.releaseSingleInstanceLock).not.toHaveBeenCalled()
    expect(options.quitCurrent).not.toHaveBeenCalled()
  })

  it('cleans up before releasing the lock, launching the replacement, and quitting', async () => {
    const timeline: string[] = []
    const options = createOptions({
      focusCurrent: vi.fn(() => timeline.push('focus')),
      confirmSwitch: vi.fn(async () => {
        timeline.push('confirm')
        return true
      }),
      resolveExecutablePath: vi.fn(() => {
        timeline.push('resolve')
        return 'C:\\Resolved CLILoom.exe'
      }),
      cleanupCurrent: vi.fn(async () => {
        timeline.push('cleanup')
      }),
      releaseSingleInstanceLock: vi.fn(() => timeline.push('release-lock')),
      launchReplacement: vi.fn(async () => {
        timeline.push('launch')
      }),
      quitCurrent: vi.fn(() => timeline.push('quit'))
    })
    const coordinator = new InstanceHandoffCoordinator(options)
    coordinator.markInitialized()

    coordinator.enqueue(createLaunchData(incomingBuildId, 'C:\\New CLILoom.exe'))
    await coordinator.waitForIdle()

    expect(timeline).toEqual([
      'focus',
      'confirm',
      'resolve',
      'cleanup',
      'release-lock',
      'launch',
      'quit'
    ])
    expect(options.launchReplacement).toHaveBeenCalledWith('C:\\Resolved CLILoom.exe')
  })

  it('keeps the current build available after cleanup fails and allows a retry', async () => {
    const cleanupError = new Error('cleanup blocked')
    const cleanupCurrent = vi.fn()
      .mockRejectedValueOnce(cleanupError)
      .mockResolvedValueOnce(undefined)
    const options = createOptions({ cleanupCurrent })
    const coordinator = new InstanceHandoffCoordinator(options)
    coordinator.markInitialized()

    coordinator.enqueue(createLaunchData(incomingBuildId, 'C:\\New CLILoom.exe'))
    await coordinator.waitForIdle()

    expect(options.onCleanupFailed).toHaveBeenCalledWith(cleanupError)
    expect(options.focusCurrent).toHaveBeenCalledTimes(2)
    expect(options.releaseSingleInstanceLock).not.toHaveBeenCalled()
    expect(options.launchReplacement).not.toHaveBeenCalled()
    expect(options.quitCurrent).not.toHaveBeenCalled()

    coordinator.enqueue(createLaunchData(incomingBuildId, 'C:\\New CLILoom.exe'))
    await coordinator.waitForIdle()

    expect(cleanupCurrent).toHaveBeenCalledTimes(2)
    expect(options.releaseSingleInstanceLock).toHaveBeenCalledOnce()
    expect(options.launchReplacement).toHaveBeenCalledOnce()
    expect(options.quitCurrent).toHaveBeenCalledOnce()
  })

  it('reports a launch failure but still quits after safe cleanup', async () => {
    const launchError = new Error('spawn denied')
    const options = createOptions({
      launchReplacement: vi.fn(async () => {
        throw launchError
      })
    })
    const coordinator = new InstanceHandoffCoordinator(options)
    coordinator.markInitialized()

    coordinator.enqueue(createLaunchData(incomingBuildId, 'C:\\New CLILoom.exe'))
    await coordinator.waitForIdle()

    expect(options.onLaunchFailed).toHaveBeenCalledWith(launchError)
    expect(options.quitCurrent).toHaveBeenCalledOnce()
    expect(options.onUnexpectedError).not.toHaveBeenCalled()
  })
})
